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
      // @step Then the provider answered it with session.prompt_result turn "turn-2" and handed it to the daemon immediately with submit_input Queue
      await h.waitFor("session.prompt_result", (event) => event.clientMessageId === "client-b");
      expect(h.ofType("session.prompt_result").at(-1)!.result).toEqual({ type: "turn", turnId: "turn-2" });
      await vi.waitFor(() =>
        expect(h.daemon.sent("submitInput")).toEqual([{ method: "submitInput", sessionId: DAEMON, text: "b", mode: "queue" }]),
      );
      expect(h.daemon.sent("sendInput").map((request) => request.text)).toEqual(["a"]);
      // @step And it emitted no session.turn started for "turn-2" while "turn-1" was running
      expect(turns(h)).toEqual(["turn-1:started"]);
      // @step And a Done chunk emitted completed for "turn-1" then started for "turn-2", and the next Done emitted completed for "turn-2"
      await h.stream(DAEMON, { type: "done" });
      expect(turns(h)).toEqual(["turn-1:started", "turn-1:completed", "turn-2:started"]);
      await h.stream(DAEMON, { type: "done" });
      expect(turns(h)).toEqual(["turn-1:started", "turn-1:completed", "turn-2:started", "turn-2:completed"]);
    });
  });

  describe("Scenario: Stopping cancels the running turn and keeps the queued prompts parked", () => {
    it("cancels turn-1 only and runs the parked turn-2 before the next prompt", async () => {
      // @step Given an open fspec session with "turn-1" running and "turn-2" queued
      const h = await running();
      await h.send(h.prompt("paseo-1", "b", "client-b"));
      await h.waitFor("session.prompt_result", (event) => event.clientMessageId === "client-b");
      // @step When the daemon sends InterruptedWithReason with queuedInputs ["b"]
      await h.stream(DAEMON, { type: "interruptedWithReason", queuedInputs: ["b"], reason: "user" });
      // @step Then the provider emitted canceled for "turn-1" and did not start "turn-2"
      expect(turns(h)).toEqual(["turn-1:started", "turn-1:canceled"]);
      // @step And it showed a notice that the queued prompt "b" is waiting
      const notice = h.ofType("session.notice").at(-1)!.notice;
      expect(notice).toMatchObject({ severity: "info", title: "1 queued prompt is waiting" });
      expect(notice.description).toContain("b");
      // @step And a later Done chunk emitted no further turn event
      await h.stream(DAEMON, { type: "done" });
      expect(turns(h)).toEqual(["turn-1:started", "turn-1:canceled"]);
      // @step And the next prompt "c" was submitted with submit_input Queue and "turn-2" then "turn-3" ran in order
      await h.send(h.prompt("paseo-1", "c", "client-c"));
      await vi.waitFor(() => expect(h.daemon.sent("submitInput").map((request) => [request.text, request.mode])).toEqual([["b", "queue"], ["c", "queue"]]));
      expect(h.ofType("session.prompt_result").at(-1)!.result).toEqual({ type: "turn", turnId: "turn-3" });
      expect(turns(h)).toEqual(["turn-1:started", "turn-1:canceled", "turn-2:started"]);
      await h.stream(DAEMON, { type: "userInput", text: "b" }, { type: "done" });
      expect(turns(h)).toEqual(["turn-1:started", "turn-1:canceled", "turn-2:started", "turn-2:completed", "turn-3:started"]);
      await h.stream(DAEMON, { type: "userInput", text: "c" }, { type: "done" });
      expect(turns(h).at(-1)).toBe("turn-3:completed");
    });
  });

  describe("Scenario: A queued prompt that cannot be sent fails in its turn", () => {
    it("fails turn-2 after turn-1 completes", async () => {
      // @step Given an open fspec session whose turn "turn-1" is running
      const h = await running();
      // @step When a second prompt is queued and its submit_input fails with "connection reset"
      h.daemon.handlers.submitInput = () => {
        throw new Error("connection reset");
      };
      await h.send(h.prompt("paseo-1", "b", "client-b"));
      await vi.waitFor(() => expect(h.daemon.sent("submitInput")).toHaveLength(1));
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
