/**
 * Feature: spec/features/fspec-session-resume.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
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
      const opened = await h.open("paseo-1", {}, { version: 1, data: { sessionId: "fspec-sess-42" } });
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

  describe("Scenario: A session the daemon cannot resume starts fresh with a notice", () => {
    it("falls back to a new daemon session", async () => {
      // @step Given a saved persistence { sessionId: "gone-1" } whose resume_session fails with "Failed to load session manifest: not found"
      const h = await harness();
      h.daemon.handlers.resumeSession = () => ({ ok: false, error: "Failed to load session manifest: not found" });
      // @step When Paseo reopens it with history "replay"
      const opened = await h.open("paseo-1", {}, { version: 1, data: { sessionId: "gone-1" } }, "replay");
      // @step Then the provider created a new daemon session "fspec-sess-42" and session.opened carries persistence data.sessionId "fspec-sess-42"
      expect(h.daemon.sent("createSessionChecked")).toHaveLength(1);
      expect(h.ofType("session.opened", opened)[0]!.persistence).toMatchObject({ data: { sessionId: "fspec-sess-42" } });
      expect(h.daemon.sent("setSessionModel")[0]!.sessionId).toBe("fspec-sess-42");
      // @step And it emitted a warning session.notice naming the resume error
      const notice = h.ofType("session.notice", opened)[0]!;
      expect(notice.notice.severity).toBe("warning");
      expect(notice.notice.description).toContain("Failed to load session manifest: not found");
      // @step And it requested no transcript pages and still reached session.ready
      expect(h.daemon.sent("getTranscriptPage")).toEqual([]);
      expect(opened.at(-1)).toMatchObject({ type: "session.ready", sessionId: "paseo-1" });
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
});
