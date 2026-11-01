/**
 * Feature: spec/features/fspec-interaction-api.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { interactionReply, type Interaction } from "../server/interactions.js";
import * as wire from "../server/wire.js";
import { interactionSnapshot, type SnapshotHitl, type SnapshotPause } from "./support/fake-daemon.js";
import { disposeHarnesses, harness, toolCall } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

const DAEMON = "fspec-sess-42";

async function pausedWith(parts: { pause?: SnapshotPause; hitl?: SnapshotHitl }) {
  const h = await harness();
  await h.open("paseo-1");
  await h.send(h.prompt("paseo-1", "go"));
  await h.waitFor("session.turn", (event) => event.state === "started");
  h.daemon.handlers.getInteractionSnapshot = () => interactionSnapshot(parts);
  await h.stream(DAEMON, toolCall("call-1", "Bash", { command: "ps" }), { type: "sessionStateChange", state: "paused" });
  const request = await h.waitFor("session.permission");
  return { h, request };
}

function vector(name: string): string {
  const text = readFileSync(fileURLToPath(new URL("./golden/golden-vectors.txt", import.meta.url)), "utf8");
  return text.split("\n").find((line) => line.startsWith(`${name} `))!.slice(name.length + 1).trim();
}

describe("Feature: Answer fspec interactions with the request-bound interaction API", () => {
  describe("Scenario: A paused session is read from the interaction snapshot", () => {
    it("builds the request from the snapshot's separate fields", async () => {
      // @step Given an fspec session whose running Bash tool call pauses
      // @step When get_interaction_snapshot returns pause request "p-7" with kind Triple, tool_name "Bash", message "RLCD security: P(risk)=0.46" and details "about to run ps"
      const { h, request } = await pausedWith({
        pause: { requestId: "p-7", kind: "Triple", toolName: "Bash", message: "RLCD security: P(risk)=0.46", details: "about to run ps" },
      });
      // @step Then the provider emitted one session.permission named "Bash" whose description holds the message and the details
      expect(h.ofType("session.permission")).toHaveLength(1);
      expect(request.request).toMatchObject({ name: "Bash", description: "RLCD security: P(risk)=0.46\n\nabout to run ps" });
      // @step And it read get_pause_state only for the gated tool call's id and never called get_hitl_request
      expect(h.daemon.sent("getPauseState")).toEqual([{ method: "getPauseState", sessionId: DAEMON }]);
      expect(h.daemon.sent("getHitlRequest")).toEqual([]);
    });
  });

  describe("Scenario: An approval is answered against its request id", () => {
    it("replies with pause_triple for the shown request id", async () => {
      // @step Given a permission request built from snapshot pause request "p-7" of kind Triple
      const { h, request } = await pausedWith({ pause: { requestId: "p-7", kind: "Triple", toolName: "Bash", message: "risky" } });
      // @step When Paseo answers it with selectedActionId "approve_session"
      await h.send({ type: "session.permission", sessionId: "paseo-1", permissionId: request.request.id, response: { behavior: "allow", selectedActionId: "approve_session" } });
      // @step Then the provider called reply_interaction_checked(session, "pause_triple", "p-7", {"choice":"ApproveSession"}) and emitted session.permission_resolved
      await h.waitFor("session.permission_resolved");
      expect(h.daemon.sent("replyInteractionChecked")).toEqual([
        { method: "replyInteractionChecked", sessionId: DAEMON, interaction: "pause_triple", requestId: "p-7", arguments: '{"choice":"ApproveSession"}' },
      ]);
    });
  });

  describe("Scenario: A continue pause resumes with pause_resume", () => {
    it("offers one Continue action and resumes", async () => {
      // @step Given a snapshot pause request "p-9" of kind Continue
      const { h, request } = await pausedWith({ pause: { requestId: "p-9", kind: "Continue", toolName: "", message: "Paused by the agent" } });
      expect(request.request.actions).toEqual([{ id: "continue", label: "Continue", behavior: "allow", variant: "primary" }]);
      // @step When Paseo answers its single Continue action
      await h.send({ type: "session.permission", sessionId: "paseo-1", permissionId: request.request.id, response: { behavior: "allow", selectedActionId: "continue" } });
      // @step Then the provider called reply_interaction_checked(session, "pause_resume", "p-9", {})
      await h.waitFor("session.permission_resolved");
      expect(h.daemon.sent("replyInteractionChecked")).toMatchObject([{ interaction: "pause_resume", requestId: "p-9", arguments: "{}" }]);
    });
  });

  describe("Scenario: A HITL question is answered against its request id", () => {
    it("replies with send_hitl_response for the shown request id", async () => {
      // @step Given a snapshot hitl request "h-2" asking question "q1" with header "Env" and options dev and prod
      const { h, request } = await pausedWith({
        hitl: {
          requestId: "h-2",
          questions: [{ id: "q1", header: "Env", question: "Which?", options: [{ label: "dev", description: "" }, { label: "prod", description: "" }] }],
        },
      });
      // @step When Paseo answers with answers { "Env": "dev" }
      await h.send({ type: "session.permission", sessionId: "paseo-1", permissionId: request.request.id, response: { behavior: "allow", updatedInput: { answers: { Env: "dev" } } } });
      // @step Then the provider called reply_interaction_checked(session, "send_hitl_response", "h-2", {"response":{"cancelled":false,"answers":[{"id":"q1","selected":["dev"],"other":null}]}})
      await h.waitFor("session.permission_resolved");
      expect(h.daemon.sent("replyInteractionChecked")).toEqual([
        {
          method: "replyInteractionChecked",
          sessionId: DAEMON,
          interaction: "send_hitl_response",
          requestId: "h-2",
          arguments: '{"response":{"cancelled":false,"answers":[{"id":"q1","selected":["dev"],"other":null}]}}',
        },
      ]);
    });
  });

  describe("Scenario: A stale answer is not applied to a newer request", () => {
    it("resolves the stale request and shows the current one", async () => {
      // @step Given a permission request for snapshot pause request "p-7" while the daemon has moved on to pause request "p-8"
      const { h, request } = await pausedWith({ pause: { requestId: "p-7", kind: "Triple", toolName: "Bash", message: "first" } });
      h.daemon.handlers.getInteractionSnapshot = () =>
        interactionSnapshot({ pause: { requestId: "p-8", kind: "Triple", toolName: "Bash", message: "second" } });
      h.daemon.handlers.replyInteractionChecked = () => ({ ok: false, error: "Interaction request changed" });
      // @step When Paseo approves the request for "p-7" and reply_interaction_checked rejects it
      await h.send({ type: "session.permission", sessionId: "paseo-1", permissionId: request.request.id, response: { behavior: "allow" } });
      // @step Then the provider resolved the request for "p-7", read the snapshot again and emitted a new permission request for "p-8"
      await vi.waitFor(() => expect(h.ofType("session.permission")).toHaveLength(2));
      const resolved = h.ofType("session.permission_resolved");
      expect(resolved.map((event) => event.permissionId)).toEqual([request.request.id]);
      expect(h.ofType("session.permission")[1]!.request.description).toBe("second");
      expect(h.ofType("session.permission")[1]!.request.id).not.toBe(request.request.id);
    });
  });

  describe("Scenario: Interaction RPCs match the live daemon", () => {
    it("decodes the live snapshot reply and encodes a checked reply", () => {
      // @step Given the reply bytes the live fspec 0.10.9 daemon returned for get_interaction_snapshot on an idle session
      const live = new Uint8Array(Buffer.from(vector("interaction_snapshot_live"), "hex"));
      // @step When the codec decodes them and encodes a reply_interaction_checked request
      const decoded = wire.decodeResponseFrame(live);
      const frame = wire.encodeRequestFrame({
        id: 0,
        message: { method: "replyInteractionChecked", sessionId: "s", interaction: "pause_resume", requestId: "r", arguments: "{}" },
      });
      // @step Then the snapshot decodes to the idle pause and hitl JSON and the request carries method index 120 with the four string arguments
      expect(decoded).toMatchObject({
        requestId: 1,
        method: "getInteractionSnapshot",
        result: { ok: true, value: '{"pause":{"request_id":"","state":null},"hitl":{"request_id":"","state":null}}' },
      });
      const hex = Buffer.from(frame).toString("hex");
      const str = (value: string) => Buffer.from(new Uint8Array(new BigUint64Array([BigInt(value.length)]).buffer)).toString("hex") + Buffer.from(value).toString("hex");
      expect(hex.endsWith("78000000" + str("s") + str("pause_resume") + str("r") + str("{}"))).toBe(true);
    });
  });

  describe("Scenario: A malformed interaction snapshot is shown as unreadable", () => {
    it("shows the unreadable-pause notice naming the field", async () => {
      // @step Given a paused session whose interaction snapshot pause state has message 7
      const h = await harness();
      await h.open("paseo-1");
      await h.send(h.prompt("paseo-1", "go"));
      await h.waitFor("session.turn", (event) => event.state === "started");
      h.daemon.handlers.getInteractionSnapshot = () => ({
        ok: true,
        value: JSON.stringify({
          pause: { request_id: "p-1", state: { kind: "Triple", tool_name: "Bash", message: 7, details: null } },
          hitl: { request_id: "", state: null },
        }),
      });
      // @step When the provider reads the snapshot
      await h.stream(DAEMON, toolCall("call-1", "Bash", { command: "ps" }), { type: "sessionStateChange", state: "paused" });
      // @step Then the session shows the error notice "fspec paused this session but the pause could not be read" naming "interaction snapshot pause.state.message is not a string"
      const notice = await h.waitFor("session.notice", (event) => event.notice.title === "fspec paused this session but the pause could not be read");
      expect(notice.notice).toMatchObject({ severity: "error", description: "interaction snapshot pause.state.message is not a string" });
      // @step And no permission request is emitted
      expect(h.ofType("session.permission")).toEqual([]);
    });
  });

  describe("Scenario: Answers that do not fit the request are refused", () => {
    it("refuses an unknown action and a question answer without answers", () => {
      // @step Given a Triple approval request and a HITL question request
      const approval: Interaction = { kind: "pause", requestId: "p-1", pauseKind: "triple", toolName: "Bash", message: "risky", details: null };
      const question: Interaction = {
        kind: "hitl",
        requestId: "h-1",
        questions: [{ id: "q1", header: "Env", question: "Which?", options: [{ label: "dev", description: "" }] }],
      };
      // @step When Paseo answers the approval with action "maybe" and allows the question without an answers object
      const approve = () => interactionReply(approval, { behavior: "allow", selectedActionId: "maybe" });
      const answer = () => interactionReply(question, { behavior: "allow" });
      // @step Then mapping the approval fails with "unknown fspec approval action maybe"
      expect(approve).toThrow("unknown fspec approval action maybe");
      // @step And mapping the question fails with "the answer to the fspec question carries no answers"
      expect(answer).toThrow("the answer to the fspec question carries no answers");
      expect(interactionReply(approval, { behavior: "deny" })).toEqual({ method: "pause_triple", arguments: '{"choice":"Deny"}' });
    });
  });

  describe("Scenario: An answer the provider cannot apply is shown on the session", () => {
    it("shows an error notice and keeps the approval", async () => {
      // @step Given a permission request for a Triple approval
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const { h, request } = await pausedWith({ pause: { requestId: "p-7", kind: "Triple", toolName: "Bash", message: "risky" } });
      // @step When Paseo answers it with action "maybe"
      await h.send({ type: "session.permission", sessionId: "paseo-1", permissionId: request.request.id, response: { behavior: "allow", selectedActionId: "maybe" } });
      // @step Then the session shows the error notice "fspec could not apply your answer" naming "unknown fspec approval action maybe"
      const notice = await h.waitFor("session.notice", (event) => event.notice.title === "fspec could not apply your answer");
      expect(notice.notice).toMatchObject({ severity: "error", description: "unknown fspec approval action maybe" });
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("unknown fspec approval action maybe"));
      // @step And the approval is not resolved and no reply was sent
      expect(h.ofType("session.permission_resolved")).toEqual([]);
      expect(h.daemon.sent("replyInteractionChecked")).toEqual([]);
      logged.mockRestore();
    });
  });
});
