/**
 * Feature: spec/features/fspec-session-creation.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it } from "vitest";
import { disposeHarnesses, harness } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

describe("Feature: Report why fspec could not create a session instead of 'Session not found'", () => {
  describe("Scenario: A daemon session that cannot be created fails the open with its cause", () => {
    it("fails the open with create_session_checked's error", async () => {
      // @step Given create_session_checked answers the error "no credentials for provider openai"
      const h = await harness();
      h.daemon.handlers.createSessionChecked = () => ({ ok: false, error: "no credentials for provider openai" });
      // @step When Paseo opens an fspec session
      await h.connection.send({
        type: "session.open",
        requestId: "o-1",
        sessionId: "paseo-1",
        config: { cwd: "/work", env: {}, mcpServers: {}, settings: {}, persist: true },
        history: "skip",
      });
      const failed = await h.waitFor("request.failed", (event) => event.requestId === "o-1");
      // @step Then the open fails with "fspec could not create a session: no credentials for provider openai"
      expect(failed.error.message).toBe("fspec could not create a session: no credentials for provider openai");
      expect(h.ofType("session.opened")).toEqual([]);
      // @step And the provider sent no set_session_model or set_thinking_level
      expect(h.daemon.sent("setSessionModel")).toEqual([]);
      expect(h.daemon.sent("setThinkingLevel")).toEqual([]);
      expect(h.daemon.sent("createSession")).toEqual([]);
    });
  });

  describe("Scenario: A created daemon session opens as before", () => {
    it("opens on the checked session id", async () => {
      // @step Given create_session_checked answers the session id "fspec-sess-42"
      const h = await harness();
      // @step When Paseo opens an fspec session
      await h.open("paseo-1", { model: "anthropic/claude-sonnet-4", thinkingOption: "high" });
      // @step Then the provider applied the model and thinking level to "fspec-sess-42" and the open reached session.ready
      expect(h.daemon.sent("createSessionChecked")).toEqual([{ method: "createSessionChecked", role: null }]);
      expect(h.daemon.sent("setSessionModel")[0]).toMatchObject({ sessionId: "fspec-sess-42" });
      expect(h.daemon.sent("setThinkingLevel")[0]).toMatchObject({ sessionId: "fspec-sess-42" });
      // @step And the legacy create_session was never called
      expect(h.daemon.sent("createSession")).toEqual([]);
    });
  });
});
