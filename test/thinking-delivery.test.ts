/**
 * Feature: spec/features/fspec-thinking-delivery.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CATALOG, disposeHarnesses, harness } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

describe("Feature: Let the daemon derive provider thinking config from the session level", () => {
  describe("Scenario: A prompt at a non-off thinking level is sent with send_input", () => {
    it("sends send_input and never send_input_with_thinking", async () => {
      // @step Given an open fspec session on model "codex/gpt-6.1-terra" whose thinking level was set to High with set_thinking_level
      const h = await harness();
      h.daemon.handlers.listProviders = () => [
        ...CATALOG,
        {
          key: "codex",
          displayName: "Codex",
          models: [{ id: "gpt-6.1-terra", displayName: "GPT-6.1 Terra", contextWindow: 1050000, supportsReasoning: true, supportsVision: false, isCustom: false }],
          profileName: null,
          isUnreachable: false,
        },
      ];
      await h.open("paseo-1", { model: "codex/gpt-6.1-terra", thinkingOption: "high" });
      expect(h.daemon.sent("setThinkingLevel").at(-1)).toEqual({
        method: "setThinkingLevel",
        sessionId: "fspec-sess-42",
        level: "high",
      });
      // @step When Paseo sends the prompt "fix the login bug"
      await h.send(h.prompt("paseo-1", "fix the login bug"));
      // @step Then the provider sent send_input(session_id, "fix the login bug")
      await vi.waitFor(() =>
        expect(h.daemon.sent("sendInput")).toEqual([
          { method: "sendInput", sessionId: "fspec-sess-42", text: "fix the login bug" },
        ]),
      );
      // @step And it never called send_input_with_thinking
      expect(h.daemon.sent("sendInputWithThinking")).toEqual([]);
    });
  });

  describe("Scenario: Changing the thinking level only calls set_thinking_level", () => {
    it("sets the level, then sends the prompt with send_input", async () => {
      // @step Given an open fspec session whose thinking level is Off
      const h = await harness();
      await h.open("paseo-1", { thinkingOption: "off" });
      const before = h.daemon.requests.length;
      // @step When Paseo configures thinkingOption "medium" and sends a prompt
      await h.send({ type: "session.configure", requestId: h.next(), sessionId: "paseo-1", changes: { thinkingOption: "medium" } });
      await h.send(h.prompt("paseo-1", "plan it"));
      await vi.waitFor(() => expect(h.daemon.sent("sendInput")).toHaveLength(1));
      // @step Then the provider called set_thinking_level(session_id, Medium) and then send_input for the prompt
      expect(h.daemon.requests.slice(before).filter((request) => request.method !== "setActiveSession")).toEqual([
        { method: "setThinkingLevel", sessionId: "fspec-sess-42", level: "medium" },
        { method: "sendInput", sessionId: "fspec-sess-42", text: "plan it" },
      ]);
    });
  });
});
