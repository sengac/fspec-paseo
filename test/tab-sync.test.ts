/**
 * Feature: spec/features/fspec-tab-sync.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { disposeHarnesses, harness, text, toolCall, toolResult } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

describe("Feature: Keep Paseo agents and fspec agent tabs in sync", () => {
  describe("Scenario: Opening a Paseo agent marks it active in fspec", () => {
    it("calls set_active_session on open", async () => {
      // @step Given the fspec daemon is reachable
      const h = await harness();
      // @step When Paseo opens session "paseo-1" and the daemon creates "fspec-sess-42"
      await h.open("paseo-1");
      // @step Then the provider called set_active_session("fspec-sess-42")
      await vi.waitFor(() => expect(h.daemon.sent("setActiveSession")).toEqual([{ method: "setActiveSession", sessionId: "fspec-sess-42" }]));
    });
  });

  describe("Scenario: Prompting a Paseo agent makes it the active one", () => {
    it("re-marks the prompted session", async () => {
      // @step Given Paseo sessions "paseo-1" ("fspec-sess-42") and "paseo-2" ("fspec-sess-43") are open
      const h = await harness();
      await h.open("paseo-1");
      await h.open("paseo-2");
      // @step When Paseo prompts "paseo-1"
      await h.send(h.prompt("paseo-1", "hi"));
      // @step Then the provider's latest set_active_session call names "fspec-sess-42"
      await vi.waitFor(() => expect(h.daemon.sent("setActiveSession").at(-1)).toEqual({ method: "setActiveSession", sessionId: "fspec-sess-42" }));
      expect(h.daemon.sent("setActiveSession").map((request) => request.sessionId)).toEqual(["fspec-sess-42", "fspec-sess-43", "fspec-sess-42"]);
    });
  });

  describe("Scenario: Closing the agent in fspec closes it in Paseo", () => {
    it("closes the Paseo session without destroying", async () => {
      // @step Given an open Paseo session "paseo-1" backed by "fspec-sess-42"
      const h = await harness();
      await h.open("paseo-1");
      // @step When the daemon reports session event removed for "fspec-sess-42"
      h.daemon.pushEnvelope({ kind: "sessionEvent", event: { type: "removed", sessionId: "fspec-sess-42" } });
      // @step Then the provider emitted session.closed for "paseo-1" and sent no destroy_session
      await h.waitFor("session.closed", (event) => event.sessionId === "paseo-1");
      expect(h.daemon.sent("destroySession")).toEqual([]);
      // @step And a later prompt to "paseo-1" is rejected with Unknown session
      await expect(h.connection.send(h.prompt("paseo-1", "hi"))).rejects.toThrow("Unknown session: paseo-1");
    });
  });

  describe("Scenario: Closing a sub-agent clears only its own active mark", () => {
    it("clears the mark only when it still names the child", async () => {
      // @step Given an open sub-agent child for daemon session "sub-9"
      const h = await harness();
      await h.open("paseo-1");
      await h.send(h.prompt("paseo-1", "delegate"));
      h.daemon.handlers.getSupervisors = (request) => (request.method === "getSupervisors" && request.sessionId.startsWith("sub-") ? ["fspec-sess-42"] : []);
      await h.stream("fspec-sess-42", toolCall("call-9", "AgentManager", {}), toolResult("call-9", "sub-9 sub-10"));
      await h.stream("sub-9", text("a"));
      await h.stream("sub-10", text("b"));
      await h.waitFor("session.opened", (event) => event.sessionId === "paseo-1:sub:sub-10");
      // @step When the daemon removes "sub-9" while get_active_session names "sub-9"
      h.daemon.handlers.getActiveSession = () => "sub-9";
      h.daemon.pushEnvelope({ kind: "sessionEvent", event: { type: "removed", sessionId: "sub-9" } });
      // @step Then the provider called clear_active_session
      await vi.waitFor(() => expect(h.daemon.sent("clearActiveSession")).toHaveLength(1));
      // @step And when get_active_session names another session the provider does not call clear_active_session
      h.daemon.handlers.getActiveSession = () => "fspec-sess-42";
      h.daemon.pushEnvelope({ kind: "sessionEvent", event: { type: "removed", sessionId: "sub-10" } });
      await h.waitFor("session.closed", (event) => event.sessionId === "paseo-1:sub:sub-10");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(h.daemon.sent("clearActiveSession")).toHaveLength(1);
    });
  });

  describe("Scenario: A failing active-session call does not fail the open", () => {
    it("still reaches session.ready", async () => {
      // @step Given set_active_session fails on the daemon
      const h = await harness();
      h.daemon.handlers.setActiveSession = () => {
        throw new Error("boom");
      };
      // @step When Paseo opens session "paseo-1"
      const opened = await h.open("paseo-1");
      // @step Then the open still reaches session.ready
      expect(opened.at(-1)).toMatchObject({ type: "session.ready", sessionId: "paseo-1" });
    });
  });
});
