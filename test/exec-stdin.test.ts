/**
 * Feature: spec/features/fspec-exec-stdin.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it } from "vitest";
import * as wire from "../server/wire.js";
import { disposeHarnesses, harness, toolCall } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

const DAEMON = "fspec-sess-42";
const STDIN: wire.StreamChunk = {
  type: "execStdinRequest",
  request: { execSessionId: "exec-3", command: "python3 -c input()", quietSeconds: 5, tsMs: 1793315114548 },
};

async function waitingForInput() {
  const h = await harness();
  await h.open("paseo-1");
  await h.send(h.prompt("paseo-1", "run it"));
  await h.waitFor("session.turn", (event) => event.state === "started");
  await h.stream(DAEMON, toolCall("call-1", "Bash", { command: "python3 -c input()" }), STDIN);
  const request = await h.waitFor("session.permission");
  return { h, request };
}

describe("Feature: Surface exec stdin requests so interactive commands do not hang", () => {
  describe("Scenario: A quiet interactive command asks Paseo for input", () => {
    it("emits a free-text question for the command", async () => {
      // @step Given an fspec session whose running Bash call started exec session "exec-3"
      // @step When the daemon streams ExecStdinRequest for "exec-3" with command "python3 -c input()" quiet for 5 seconds
      const { h, request } = await waitingForInput();
      // @step Then the provider emitted one session.permission with kind question titled "Input for python3 -c input()" holding one free-text question
      expect(h.ofType("session.permission")).toHaveLength(1);
      expect(request.request).toMatchObject({
        kind: "question",
        name: "stdin",
        title: "Input for python3 -c input()",
        input: {
          questions: [
            {
              header: "Input",
              question: "python3 -c input() has been quiet for 5s and may be waiting for input. What should be typed?",
              options: [],
              multiSelect: false,
              allowOther: true,
              allowEmpty: true,
            },
          ],
        },
      });
    });
  });

  describe("Scenario: Typed input is written to the command's stdin", () => {
    it("writes the answer with write_exec_stdin", async () => {
      // @step Given an open stdin request for exec session "exec-3"
      const { h, request } = await waitingForInput();
      // @step When Paseo answers it with answers { "Input": "hello" }
      await h.send({ type: "session.permission", sessionId: "paseo-1", permissionId: request.request.id, response: { behavior: "allow", updatedInput: { answers: { Input: "hello" } } } });
      // @step Then the provider called write_exec_stdin(session, "exec-3", "hello") and emitted session.permission_resolved
      const resolved = await h.waitFor("session.permission_resolved");
      expect(h.daemon.sent("writeExecStdin")).toEqual([{ method: "writeExecStdin", sessionId: DAEMON, execSessionId: "exec-3", text: "hello" }]);
      expect(resolved.permissionId).toBe(request.request.id);
    });
  });

  describe("Scenario: A cleared request resolves without writing", () => {
    it("resolves on ExecStdinRequestCleared and ignores late answers", async () => {
      // @step Given an open stdin request for exec session "exec-3"
      const { h, request } = await waitingForInput();
      // @step When the daemon streams ExecStdinRequestCleared
      await h.stream(DAEMON, { type: "execStdinRequestCleared" });
      // @step Then the provider emitted session.permission_resolved
      const resolved = await h.waitFor("session.permission_resolved");
      expect(resolved.permissionId).toBe(request.request.id);
      // @step And a late answer for that request calls no write_exec_stdin
      await h.send({ type: "session.permission", sessionId: "paseo-1", permissionId: request.request.id, response: { behavior: "allow", updatedInput: { answers: { Input: "late" } } } });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(h.daemon.sent("writeExecStdin")).toEqual([]);
    });
  });

  describe("Scenario: Dismissing the stdin request writes nothing", () => {
    it("resolves without writing", async () => {
      // @step Given an open stdin request for exec session "exec-3"
      const { h, request } = await waitingForInput();
      // @step When Paseo answers it with behavior deny
      await h.send({ type: "session.permission", sessionId: "paseo-1", permissionId: request.request.id, response: { behavior: "deny" } });
      // @step Then the provider emitted session.permission_resolved and called no write_exec_stdin
      await h.waitFor("session.permission_resolved");
      expect(h.daemon.sent("writeExecStdin")).toEqual([]);
    });
  });

  describe("Scenario: Exec stdin chunks round-trip through the codec", () => {
    it("encodes and decodes both chunks", () => {
      // @step Given an ExecStdinRequest chunk for "exec-3" and an ExecStdinRequestCleared chunk
      const cleared: wire.StreamChunk = { type: "execStdinRequestCleared" };
      // @step When the codec encodes and decodes them inside Event envelopes
      const decode = (chunk: wire.StreamChunk) =>
        wire.decodeEnvelope(wire.encodeEnvelope({ kind: "event", sessionId: DAEMON, chunk }));
      // @step Then they decode to execStdinRequest with all four fields and to execStdinRequestCleared
      expect(decode(STDIN)).toEqual({ kind: "event", sessionId: DAEMON, chunk: STDIN });
      expect(decode(cleared)).toEqual({ kind: "event", sessionId: DAEMON, chunk: cleared });
    });
  });
});
