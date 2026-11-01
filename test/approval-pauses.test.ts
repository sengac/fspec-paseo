/**
 * Feature: spec/features/fspec-approval-pauses.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as wire from "../server/wire.js";
import { interactionSnapshot, type SnapshotPause } from "./support/fake-daemon.js";
import { disposeHarnesses, harness, toolCall, type Event } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

const DAEMON = "fspec-sess-42";
const MESSAGE = "RLCD security: P(risk)=0.46 >= promptThreshold 0.45";
const DETAILS = "An AI coding agent is about to run this shell command";
const TRIPLE: SnapshotPause = { requestId: "p-1", kind: "Triple", toolName: "Bash", message: MESSAGE, details: DETAILS };

/** An open session whose running turn is paused on Bash call-1. */
async function paused(pause: SnapshotPause, toolCallId: string | null = "call-1") {
  const h = await harness();
  await h.open("paseo-1");
  await h.send(h.prompt("paseo-1", "check processes"));
  await h.waitFor("session.turn", (event) => event.state === "started");
  h.daemon.handlers.getInteractionSnapshot = () => interactionSnapshot({ pause });
  h.daemon.handlers.getPauseState = () => ({ kind: "triple", prompt: `${pause.toolName}: ${pause.message}`, details: null, toolCallId });
  await h.stream(DAEMON, toolCall("call-1", "Bash", { command: "ps -axo pid" }), {
    type: "sessionStateChange",
    state: "paused",
  });
  const request = await h.waitFor("session.permission");
  return { h, request };
}

/** An open session whose turn is running, nothing paused yet. */
async function running() {
  const h = await harness();
  await h.open("paseo-1");
  await h.send(h.prompt("paseo-1", "check processes"));
  await h.waitFor("session.turn", (event) => event.state === "started");
  return h;
}

const answer = (permissionId: string, response: { behavior: "allow" | "deny"; selectedActionId?: string }) => ({
  type: "session.permission" as const,
  sessionId: "paseo-1",
  permissionId,
  response,
});

function vector(name: string): string {
  const text = readFileSync(fileURLToPath(new URL("./golden/golden-vectors.txt", import.meta.url)), "utf8");
  const line = text.split("\n").find((entry) => entry.startsWith(`${name} `))!;
  return line.slice(name.length + 1).trim();
}

describe("Feature: Surface fspec tool approval pauses as Paseo permission requests", () => {
  describe("Scenario: A paused tool call becomes a Paseo permission request", () => {
    it("emits one permission request with three actions", async () => {
      // @step Given an fspec session whose turn is running Bash tool call "call-1" with command "ps -axo pid"
      // @step When the daemon reports SessionStateChange Paused and the interaction snapshot holds a Triple pause with tool_name "Bash", message "RLCD security: P(risk)=0.46 >= promptThreshold 0.45" and details "An AI coding agent is about to run this shell command"
      const { h, request } = await paused(TRIPLE);
      expect(h.daemon.sent("getInteractionSnapshot")).toEqual([{ method: "getInteractionSnapshot", sessionId: DAEMON }]);
      // @step Then the provider emitted one session.permission with kind tool, name "Bash", a description holding the message and the details, and shell detail "ps -axo pid" from the tool call get_pause_state names
      expect(h.ofType("session.permission")).toHaveLength(1);
      expect(request.request).toMatchObject({
        kind: "tool",
        name: "Bash",
        title: "Allow Bash?",
        description: `${MESSAGE}\n\n${DETAILS}`,
        detail: { type: "shell", command: "ps -axo pid" },
      });
      // @step And its actions are Approve (allow), Approve for session (allow) and Deny (deny)
      expect(request.request.actions).toEqual([
        { id: "approve", label: "Approve", behavior: "allow", variant: "primary" },
        { id: "approve_session", label: "Approve for session", behavior: "allow", variant: "secondary" },
        { id: "deny", label: "Deny", behavior: "deny", variant: "danger" },
      ]);
    });
  });

  describe("Scenario: Approving a paused tool resumes it", () => {
    it("calls pause_triple and resolves the request", async () => {
      // @step Given an open permission request for a Triple pause
      const { h, request } = await paused(TRIPLE);
      // @step When Paseo answers it with selectedActionId "approve_session"
      await h.send(answer(request.request.id, { behavior: "allow", selectedActionId: "approve_session" }));
      // @step Then the provider answered the pause with pause_triple ApproveSession through reply_interaction_checked and then emitted session.permission_resolved for that request
      const resolved = await h.waitFor("session.permission_resolved");
      expect(h.daemon.sent("replyInteractionChecked")).toEqual([
        { method: "replyInteractionChecked", sessionId: DAEMON, interaction: "pause_triple", requestId: "p-1", arguments: '{"choice":"ApproveSession"}' },
      ]);
      expect(resolved).toEqual({ type: "session.permission_resolved", sessionId: "paseo-1", permissionId: request.request.id });
    });
  });

  describe("Scenario: Denying a confirm pause rejects it", () => {
    it("calls pause_confirm(false) and resolves the request", async () => {
      // @step Given an open permission request for a Confirm pause "Allow writing outside the workspace?" with actions accept and deny
      const { h, request } = await paused({ requestId: "p-2", kind: "Confirm", toolName: "Write", message: "Allow writing outside the workspace?" });
      expect(request.request.actions?.map((action) => [action.id, action.behavior])).toEqual([
        ["accept", "allow"],
        ["deny", "deny"],
      ]);
      // @step When Paseo answers it with behavior deny
      await h.send(answer(request.request.id, { behavior: "deny" }));
      // @step Then the provider answered the pause with pause_confirm accept false through reply_interaction_checked and emitted session.permission_resolved
      await h.waitFor("session.permission_resolved");
      expect(h.daemon.sent("replyInteractionChecked")).toEqual([
        { method: "replyInteractionChecked", sessionId: DAEMON, interaction: "pause_confirm", requestId: "p-2", arguments: '{"accept":false}' },
      ]);
    });
  });

  describe("Scenario: Stopping the turn resolves an open pause", () => {
    it("resolves before the canceled turn and ignores late answers", async () => {
      // @step Given an open permission request for a paused tool call
      const { h, request } = await paused(TRIPLE);
      // @step When the daemon reports Interrupted for the session
      await h.stream(DAEMON, { type: "interruptedWithReason", queuedInputs: [], reason: "user" });
      // @step Then the provider emitted session.permission_resolved for the request before the canceled turn event
      const resolved = await h.waitFor("session.permission_resolved");
      const canceled = await h.waitFor("session.turn", (event) => event.state === "canceled");
      expect(h.events.indexOf(resolved)).toBeLessThan(h.events.indexOf(canceled));
      expect(resolved.permissionId).toBe(request.request.id);
      // @step And a later answer for that request calls no pause RPC
      await h.send(answer(request.request.id, { behavior: "allow" }));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(h.daemon.sent("replyInteractionChecked")).toEqual([]);
      expect(h.ofType("session.permission_resolved")).toHaveLength(1);
    });
  });

  describe("Scenario: Pause RPCs match the daemon's encoding", () => {
    it("byte-matches the Rust golden vectors", () => {
      // @step Given Rust golden vectors for Option<PauseState> and the pause_confirm and pause_triple arguments
      const frame = (payload: string) =>
        new Uint8Array(Buffer.from("0000000000000000" + "00000000" + "50000000" + payload, "hex"));
      // @step When the codec encodes and decodes those values
      const some = wire.decodeResponseFrame(frame(vector("pause_state_v2_some")));
      const confirm = wire.decodeResponseFrame(frame(vector("pause_state_v2_confirm")));
      const none = wire.decodeResponseFrame(frame(vector("pause_state_none")));
      const value: wire.PauseState = { kind: "triple", prompt: "Bash: risky", details: "rm -rf build", toolCallId: "call-1" };
      const encoded = wire.encodeResponseFrame({ requestId: 0, message: "getPauseState", value });
      const hex = (message: wire.FspecServiceRequest) => Buffer.from(wire.encodeRequestFrame({ id: 0, message })).toString("hex");
      // @step Then the bytes match the golden vectors exactly
      expect(Buffer.from(encoded.subarray(16)).toString("hex")).toBe(vector("pause_state_v2_some"));
      expect(confirm).toMatchObject({ pause: { kind: "confirm", prompt: "ok?", details: null, toolCallId: null } });
      expect(none).toMatchObject({ pause: null });
      expect(hex({ method: "pauseConfirm", sessionId: "s", accept: true }).endsWith("4d000000" + vector("pause_confirm_args"))).toBe(true);
      expect(hex({ method: "pauseTriple", sessionId: "s", choice: "approveSession" }).endsWith("4e000000" + vector("pause_triple_args"))).toBe(true);
      // @step And the pause state carries the details "rm -rf build" and the tool call id "call-1" as separate fields
      expect(some).toMatchObject({ method: "getPauseState", pause: value });
    });
  });

  describe("Scenario: A paused tool call's approval is attached to the call it gates", () => {
    it("takes the name and detail from the tool call get_pause_state names", async () => {
      // @step Given an fspec session whose turn is running Bash tool call "call-1" with command "ps -axo pid" and then Read tool call "call-2"
      const h = await harness();
      await h.open("paseo-1");
      await h.send(h.prompt("paseo-1", "check processes"));
      await h.waitFor("session.turn", (event) => event.state === "started");
      await h.stream(DAEMON, toolCall("call-1", "Bash", { command: "ps -axo pid" }), toolCall("call-2", "Read", { file_path: "/work/a.txt" }));
      // @step When the daemon reports SessionStateChange Paused and get_pause_state names tool call "call-1"
      h.daemon.handlers.getInteractionSnapshot = () => interactionSnapshot({ pause: { ...TRIPLE, toolName: "" } });
      h.daemon.handlers.getPauseState = () => ({ kind: "triple", prompt: "Bash: risky", details: DETAILS, toolCallId: "call-1" });
      await h.stream(DAEMON, { type: "sessionStateChange", state: "paused" });
      const request = await h.waitFor("session.permission");
      // @step Then the provider emitted one session.permission named "Bash" with shell detail "ps -axo pid" and metadata toolCallId "call-1"
      expect(h.ofType("session.permission")).toHaveLength(1);
      expect(h.daemon.sent("getPauseState")).toEqual([{ method: "getPauseState", sessionId: DAEMON }]);
      expect(request.request).toMatchObject({
        name: "Bash",
        detail: { type: "shell", command: "ps -axo pid" },
        metadata: { toolCallId: "call-1" },
      });
    });
  });

  describe("Scenario: An approval without a known tool call id is shown unattached", () => {
    it("never attaches the approval to a guessed tool call", async () => {
      // @step Given an fspec session whose turn is running Bash tool call "call-1" with command "ps -axo pid"
      // @step When the daemon reports SessionStateChange Paused and get_pause_state names no tool call, and later names the unknown tool call "call-9"
      const { h, request } = await paused(TRIPLE, null);
      expect(h.daemon.sent("getPauseState")).toHaveLength(1);
      await h.stream(DAEMON, { type: "sessionStateChange", state: "running" });
      h.daemon.handlers.getPauseState = () => ({ kind: "triple", prompt: "Bash: risky", details: null, toolCallId: "call-9" });
      await h.stream(DAEMON, { type: "sessionStateChange", state: "paused" });
      await vi.waitFor(() => expect(h.ofType("session.permission")).toHaveLength(2));
      // @step Then each session.permission is named "Bash" with the snapshot's description, no detail and no toolCallId metadata
      for (const event of [request, h.ofType("session.permission")[1]!]) {
        expect(event.request).toMatchObject({ name: "Bash", description: `${MESSAGE}\n\n${DETAILS}` });
        expect(event.request.detail).toBeUndefined();
        expect(event.request.metadata).toBeUndefined();
      }
    });
  });

  describe("Scenario: A pause that cannot be read is reported", () => {
    it("emits an error notice instead of dropping the pause", async () => {
      // @step Given an fspec session whose turn is running
      const h = await running();
      // @step When the daemon reports SessionStateChange Paused and get_interaction_snapshot answers "interaction state unavailable"
      h.daemon.handlers.getInteractionSnapshot = () => ({ ok: false, error: "interaction state unavailable" });
      await h.stream(DAEMON, { type: "sessionStateChange", state: "paused" });
      const notice = await h.waitFor("session.notice", (event) => event.notice.severity === "error");
      // @step Then the provider emitted an error session.notice "fspec paused this session but the pause could not be read" with the description "fspec daemon get_interaction_snapshot failed: interaction state unavailable"
      expect(notice.notice).toMatchObject({
        title: "fspec paused this session but the pause could not be read",
        description: "fspec daemon get_interaction_snapshot failed: interaction state unavailable",
      });
      // @step And it emitted no session.permission
      expect(h.ofType("session.permission")).toEqual([]);
    });
  });

  describe("Scenario: An unknown pause kind is reported, not read as a confirm", () => {
    it("emits an error notice for an unknown kind", async () => {
      // @step Given an fspec session whose turn is running
      const h = await running();
      // @step When the daemon reports SessionStateChange Paused and the interaction snapshot holds a pause of kind "Quadruple"
      h.daemon.handlers.getInteractionSnapshot = () =>
        interactionSnapshot({ pause: { ...TRIPLE, kind: "Quadruple" as SnapshotPause["kind"] } });
      await h.stream(DAEMON, { type: "sessionStateChange", state: "paused" });
      const notice = await h.waitFor("session.notice", (event) => event.notice.severity === "error");
      // @step Then the provider emitted an error session.notice "fspec paused this session but the pause could not be read" with the description "unknown fspec pause kind Quadruple"
      expect(notice.notice).toMatchObject({
        title: "fspec paused this session but the pause could not be read",
        description: "unknown fspec pause kind Quadruple",
      });
      // @step And it emitted no session.permission
      expect(h.ofType("session.permission")).toEqual([]);
    });
  });

  describe("Scenario: A permission answer for an unknown session is rejected", () => {
    it("throws synchronously", async () => {
      // @step Given a sessionId the provider never opened
      const h = await harness();
      // @step When Paseo sends a session.permission for it
      const sent = h.connection.send({ type: "session.permission", sessionId: "ghost", permissionId: "p-1", response: { behavior: "allow" } });
      // @step Then the input is rejected synchronously with Unknown session
      await expect(sent).rejects.toThrow("Unknown session: ghost");
      expect((h.ofType("session.permission_resolved") as Event<"session.permission_resolved">[])).toEqual([]);
      void vi;
    });
  });
});
