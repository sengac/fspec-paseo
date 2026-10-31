/**
 * Feature: spec/features/fspec-prompt-queue.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { disposeHarnesses, harness } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

const DAEMON = "fspec-sess-42";

async function running() {
  const h = await harness();
  await h.open("paseo-1");
  await h.send(h.prompt("paseo-1", "a", "client-a"));
  await h.waitFor("session.turn", (event) => event.turnId === "turn-1" && event.state === "started");
  return h;
}

const turns = (h: Awaited<ReturnType<typeof running>>) =>
  h.ofType("session.turn").map((event) => `${event.turnId}:${event.state}`);

describe("Feature: Queue overlapping prompts as ordered turns", () => {
  describe("Scenario: A follow-up prompt becomes the next turn without interleaving", () => {
    it("defers turn-2 until turn-1 settles", async () => {
      // @step Given an open fspec session whose turn "turn-1" is running
      const h = await running();
      // @step When Paseo sends a second prompt "b"
      await h.send(h.prompt("paseo-1", "b", "client-b"));
      // @step Then the provider answered it with session.prompt_result turn "turn-2" and sent it to the daemon immediately
      await h.waitFor("session.prompt_result", (event) => event.clientMessageId === "client-b");
      expect(h.ofType("session.prompt_result").at(-1)!.result).toEqual({ type: "turn", turnId: "turn-2" });
      await vi.waitFor(() => expect(h.daemon.sent("sendInput").map((request) => request.text)).toEqual(["a", "b"]));
      // @step And it emitted no session.turn started for "turn-2" while "turn-1" was running
      expect(turns(h)).toEqual(["turn-1:started"]);
      // @step And a Done chunk emitted completed for "turn-1" then started for "turn-2", and the next Done emitted completed for "turn-2"
      await h.stream(DAEMON, { type: "done" });
      expect(turns(h)).toEqual(["turn-1:started", "turn-1:completed", "turn-2:started"]);
      await h.stream(DAEMON, { type: "done" });
      expect(turns(h)).toEqual(["turn-1:started", "turn-1:completed", "turn-2:started", "turn-2:completed"]);
    });
  });

  describe("Scenario: Stopping cancels the running turn and the inputs the daemon dropped", () => {
    it("cancels turn-1 and the dropped turn-2", async () => {
      // @step Given an open fspec session with "turn-1" running and "turn-2" queued
      const h = await running();
      await h.send(h.prompt("paseo-1", "b", "client-b"));
      await h.waitFor("session.prompt_result", (event) => event.clientMessageId === "client-b");
      // @step When the daemon sends InterruptedWithReason with queuedInputs ["b"]
      await h.stream(DAEMON, { type: "interruptedWithReason", queuedInputs: ["b"], reason: "user" });
      // @step Then the provider emitted canceled for "turn-1", then started and canceled for "turn-2"
      expect(turns(h)).toEqual(["turn-1:started", "turn-1:canceled", "turn-2:started", "turn-2:canceled"]);
      // @step And a later Done chunk emitted no further turn terminal
      await h.stream(DAEMON, { type: "done" });
      expect(turns(h)).toHaveLength(4);
    });
  });

  describe("Scenario: A queued prompt that cannot be sent fails in its turn", () => {
    it("fails turn-2 after turn-1 completes", async () => {
      // @step Given an open fspec session whose turn "turn-1" is running
      const h = await running();
      // @step When a second prompt is queued and its send_input fails with "connection reset"
      h.daemon.handlers.sendInput = () => {
        throw new Error("connection reset");
      };
      await h.send(h.prompt("paseo-1", "b", "client-b"));
      await vi.waitFor(() => expect(h.daemon.sent("sendInput")).toHaveLength(2));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(turns(h)).toEqual(["turn-1:started"]);
      // @step Then after "turn-1" completes, "turn-2" emits started and then failed with "connection reset"
      await h.stream(DAEMON, { type: "done" });
      expect(turns(h)).toEqual(["turn-1:started", "turn-1:completed", "turn-2:started", "turn-2:failed"]);
      const failed = h.ofType("session.turn").at(-1)!;
      expect(failed.error?.message).toContain("connection reset");
    });
  });
});
