/**
 * Feature: spec/features/fspec-idle-runtime.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { disposeHarnesses, harness } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

const ask = (requestId: string) => ({ type: "session.can_stop_runtime" as const, requestId, sessionId: "paseo-1" });

describe("Feature: Answer Paseo idle-runtime checks for fspec sessions", () => {
  describe("Scenario: An idle session can be stopped", () => {
    it("answers canStop true", async () => {
      // @step Given an open fspec session with no turn, request or child, whose daemon status is idle with no pending input
      const h = await harness();
      await h.open("paseo-1");
      // @step When Paseo asks session.can_stop_runtime
      const reply = await h.send(ask("q-1"));
      // @step Then the provider answered session.can_stop_runtime with canStop true and no request.completed
      expect(reply).toEqual({ type: "session.can_stop_runtime", requestId: "q-1", sessionId: "paseo-1", canStop: true });
      expect(h.ofType("request.completed").filter((event) => event.requestId === "q-1")).toEqual([]);
    });
  });

  describe("Scenario: Busy sessions keep their runtime", () => {
    it("answers canStop false while busy", async () => {
      // @step Given an open fspec session with a running turn
      const h = await harness();
      await h.open("paseo-1");
      await h.send(h.prompt("paseo-1", "work"));
      await h.waitFor("session.turn", (event) => event.state === "started");
      // @step When Paseo asks session.can_stop_runtime
      const busy = await h.send(ask("q-2"));
      // @step Then the provider answered canStop false
      expect(busy).toMatchObject({ canStop: false });
      // @step And a session with pending input on the daemon also answers canStop false
      await h.stream("fspec-sess-42", { type: "done" });
      h.daemon.handlers.getPendingInput = () => "queued text";
      const pending = await h.send(ask("q-3"));
      expect(pending).toMatchObject({ canStop: false });
    });
  });

  describe("Scenario: A failed check keeps the runtime", () => {
    it("answers canStop false when the daemon check fails", async () => {
      // @step Given an open idle fspec session whose get_session_status fails
      const h = await harness();
      await h.open("paseo-1");
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      h.daemon.handlers.getSessionStatus = () => {
        throw new Error("boom");
      };
      // @step When Paseo asks session.can_stop_runtime
      const reply = await h.send(ask("q-4"));
      // @step Then the provider answered canStop false
      expect(reply).toMatchObject({ type: "session.can_stop_runtime", canStop: false });
      // @step And the plugin log has the failed check
      expect(logged).toHaveBeenCalledWith(expect.stringMatching(/^\[fspec\] fspec could not check whether the runtime can stop \(paseo-1\): .*boom/));
      logged.mockRestore();
    });
  });
});
