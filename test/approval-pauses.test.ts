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
async function paused(pause: SnapshotPause) {
  const h = await harness();
  await h.open("paseo-1");
  await h.send(h.prompt("paseo-1", "check processes"));
  await h.waitFor("session.turn", (event) => event.state === "started");
  h.daemon.handlers.getInteractionSnapshot = () => interactionSnapshot({ pause });
  await h.stream(DAEMON, toolCall("call-1", "Bash", { command: "ps -axo pid" }), {
    type: "sessionStateChange",
    state: "paused",
  });
  const request = await h.waitFor("session.permission");
  return { h, request };
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
      // @step Then the provider emitted one session.permission with kind tool, name "Bash", a description holding the message and the details, and shell detail "ps -axo pid" from the running tool call
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
      const some = wire.decodeResponseFrame(frame(vector("pause_state_some")));
      const confirm = wire.decodeResponseFrame(frame(vector("pause_state_confirm")));
      const none = wire.decodeResponseFrame(frame(vector("pause_state_none")));
      // @step Then the bytes match the golden vectors exactly
      expect(some).toMatchObject({ method: "getPauseState", pause: { kind: "triple", prompt: "Bash: risky", toolCallId: "call-1" } });
      expect(confirm).toMatchObject({ pause: { kind: "confirm", prompt: "ok?", toolCallId: null } });
      expect(none).toMatchObject({ pause: null });
      const encoded = wire.encodeResponseFrame({
        requestId: 0,
        message: "getPauseState",
        value: { kind: "triple", prompt: "Bash: risky", toolCallId: "call-1" },
      });
      expect(Buffer.from(encoded.subarray(16)).toString("hex")).toBe(vector("pause_state_some"));
      const hex = (message: wire.FspecServiceRequest) => Buffer.from(wire.encodeRequestFrame({ id: 0, message })).toString("hex");
      expect(hex({ method: "pauseConfirm", sessionId: "s", accept: true }).endsWith("4d000000" + vector("pause_confirm_args"))).toBe(true);
      expect(hex({ method: "pauseTriple", sessionId: "s", choice: "approveSession" }).endsWith("4e000000" + vector("pause_triple_args"))).toBe(true);
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
