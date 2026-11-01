/**
 * Feature: spec/features/fspec-session-resume.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as wire from "../server/wire.js";
import { disposeHarnesses, harness } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

describe("Feature: Resume persisted fspec sessions on reopen", () => {
  describe("Scenario: Reopening a closed session resumes it on the daemon", () => {
    it("resumes before configuring and reuses the daemon id", async () => {
      // @step Given an fspec session mapped to daemon id "fspec-sess-42" that Paseo closed with session.close
      const h = await harness();
      await h.open("paseo-1");
      await h.send({ type: "session.close", requestId: h.next(), sessionId: "paseo-1" });
      const before = h.daemon.requests.length;
      // @step When Paseo reopens it with persistence { version: 1, data: { sessionId: "fspec-sess-42" } }
      // Paseo passes the agent's model; a resumed session keeps its own without one (FSPEC-061).
      const opened = await h.open("paseo-1", { model: "anthropic/claude-sonnet-4" }, { version: 1, data: { sessionId: "fspec-sess-42" } });
      // @step Then the provider called resume_session("fspec-sess-42") before set_session_model and set_thinking_level
      const methods = h.daemon.requests.slice(before).map((request) => request.method);
      expect(h.daemon.sent("resumeSession")).toEqual([{ method: "resumeSession", sessionId: "fspec-sess-42" }]);
      expect(methods.indexOf("resumeSession")).toBeLessThan(methods.indexOf("setSessionModel"));
      expect(methods.indexOf("setSessionModel")).toBeLessThan(methods.indexOf("setThinkingLevel"));
      // @step And it issued no create_session and the reopen reached session.ready with persistence data.sessionId "fspec-sess-42"
      expect(h.daemon.sent("createSessionChecked")).toHaveLength(1);
      expect(h.ofType("session.opened", opened)[0]!.persistence).toMatchObject({ data: { sessionId: "fspec-sess-42" } });
      // @step And a follow-up prompt is sent to daemon session "fspec-sess-42"
      await h.send(h.prompt("paseo-1", "still there?"));
      await vi.waitFor(() => expect(h.daemon.sent("sendInput")).toHaveLength(1));
      expect(h.daemon.sent("sendInput")[0]!.sessionId).toBe("fspec-sess-42");
    });
  });

  describe("Scenario: A session the daemon cannot resume fails the open", () => {
    it("fails the open and creates nothing", async () => {
      // @step Given a saved persistence { sessionId: "gone-1" } whose resume_session fails with "Failed to load session manifest: not found"
      const h = await harness();
      h.daemon.handlers.resumeSession = () => ({ ok: false, error: "Failed to load session manifest: not found" });
      // @step When Paseo reopens it with history "replay"
      await h.connection.send({
        type: "session.open",
        requestId: "o-1",
        sessionId: "paseo-1",
        config: { cwd: "/work", env: {}, mcpServers: {}, settings: {}, persist: true },
        history: "replay",
        persistence: { version: 1, data: { sessionId: "gone-1" } },
      });
      const failed = await h.waitFor("request.failed", (event) => event.requestId === "o-1");
      // @step Then the open fails with "fspec could not resume session gone-1: Failed to load session manifest: not found"
      expect(failed.error.message).toBe("fspec could not resume session gone-1: Failed to load session manifest: not found");
      expect(h.ofType("session.opened")).toEqual([]);
      // @step And the provider created no daemon session and requested no transcript pages
      expect(h.daemon.sent("createSessionChecked")).toEqual([]);
      expect(h.daemon.sent("createSessionInWorkspace")).toEqual([]);
      expect(h.daemon.sent("getTranscriptPage")).toEqual([]);
    });
  });

  describe("Scenario: A fresh open never resumes", () => {
    it("creates without resuming", async () => {
      // @step Given Paseo opens an fspec session without persistence
      const h = await harness();
      // @step When the provider completes the open
      await h.open("paseo-1");
      // @step Then it called create_session and never called resume_session
      expect(h.daemon.sent("createSessionChecked")).toHaveLength(1);
      expect(h.daemon.sent("resumeSession")).toEqual([]);
    });
  });

  describe("Scenario: send_input results match the daemon's encoding", () => {
    it("decodes and encodes Result<(), String> for both input methods", () => {
      // @step Given the Rust golden vectors for send_input answering Ok(()) and Err("Session not found: s-1")
      const ok = golden("send_input_ok");
      const err = golden("send_input_err");
      // @step When the codec decodes both replies for send_input and send_input_with_thinking
      const decoded = (["sendInput", "sendInputWithThinking"] as const).map((method) => [
        reply(method, ok),
        reply(method, err),
      ]);
      // @step Then they decode to an ok result and to the error "Session not found: s-1"
      for (const [okReply, errReply] of decoded) {
        expect(okReply).toMatchObject({ ok: true, result: { ok: true } });
        expect(errReply).toMatchObject({ ok: true, result: { ok: false, error: "Session not found: s-1" } });
      }
      // @step And encoding those results reproduces the golden bytes
      for (const method of ["sendInput", "sendInputWithThinking"] as const) {
        expect(encoded(method, { ok: true, value: undefined })).toBe(head(method) + ok);
        expect(encoded(method, { ok: false, error: "Session not found: s-1" })).toBe(head(method) + err);
      }
    });
  });

  describe("Scenario: A prompt the daemon refuses fails its turn with the reason", () => {
    it("fails the turn with send_input's error", async () => {
      // @step Given an open fspec session whose daemon session "fspec-sess-42" the daemon no longer holds
      const h = await harness();
      await h.open("paseo-1");
      const refusal = "Session not found: fspec-sess-42 (resume it with resume_session before sending input)";
      h.daemon.handlers.sendInput = () => ({ ok: false, error: refusal });
      // @step When Paseo prompts it and send_input answers "Session not found: fspec-sess-42 (resume it with resume_session before sending input)"
      await h.send(h.prompt("paseo-1", "hello?"));
      const failed = await h.waitFor("session.turn", (event) => event.state === "failed");
      // @step Then the turn fails with "fspec daemon send_input failed: Session not found: fspec-sess-42 (resume it with resume_session before sending input)"
      expect(failed.error?.message).toBe(`fspec daemon send_input failed: ${refusal}`);
      // @step And no turn stays running
      const states = h.ofType("session.turn").map((event) => `${event.turnId}:${event.state}`);
      expect(states).toEqual(["turn-1:started", "turn-1:failed"]);
    });
  });
});

const GOLDEN = new Map(
  readFileSync(fileURLToPath(new URL("./golden/golden-vectors.txt", import.meta.url)), "utf8")
    .trim()
    .split("\n")
    .map((line) => line.split(" ") as [string, string]),
);

function golden(name: string): string {
  const hex = GOLDEN.get(name);
  if (hex === undefined) throw new Error(`missing golden vector ${name}`);
  return hex;
}

/** A successful tarpc Response header for one method: request id 0, Ok, its variant index. */
function head(method: wire.FspecServiceRequest["method"]): string {
  return "0000000000000000" + "00000000" + Buffer.from(new Uint32Array([wire.FspecMethodIndex[method]]).buffer).toString("hex");
}

function reply(method: wire.FspecServiceRequest["method"], payload: string): wire.DecodedResponse {
  return wire.decodeResponseFrame(new Uint8Array(Buffer.from(head(method) + payload, "hex")));
}

function encoded(method: wire.FspecServiceRequest["method"], value: unknown): string {
  return Buffer.from(wire.encodeResponseFrame({ requestId: 0, message: method, value })).toString("hex");
}
