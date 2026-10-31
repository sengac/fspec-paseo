/**
 * Feature: spec/features/fspec-replay-coalescing.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it } from "vitest";
import { transcriptPages } from "./support/fake-daemon.js";
import { disposeHarnesses, harness, text } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

const DAEMON = "fspec-sess-42";
const correlation = { correlationId: null, observedCorrelationIds: null };

async function replayed(entries: unknown[]) {
  const h = await harness();
  h.daemon.handlers.getTranscriptPage = transcriptPages(entries.map((entry) => JSON.stringify(entry)));
  const opened = await h.open("paseo-1", {}, { version: 1, data: { sessionId: DAEMON } }, "replay");
  return { h, items: h.ofType("timeline.item", opened) };
}

describe("Feature: Replay history as one final snapshot per item", () => {
  describe("Scenario: Replayed text is published once with its final content", () => {
    it("publishes the final reasoning and assistant text once each", async () => {
      // @step Given a resumed fspec session whose transcript holds Thinking "plan", Thinking "ning", Text "ok" and Done
      const entries = [
        { Thinking: { thinking: "plan", ...correlation } },
        { Thinking: { thinking: "ning", ...correlation } },
        { Text: { text: "ok", ...correlation } },
        "Done",
      ];
      // @step When Paseo reopens it with history "replay"
      const { items } = await replayed(entries);
      // @step Then the provider published exactly two timeline items before session.ready: reasoning "planning" then assistant_message "ok"
      expect(items.map((event) => [event.item.type, (event.item as { text?: string }).text])).toEqual([
        ["reasoning", "planning"],
        ["assistant_message", "ok"],
      ]);
    });
  });

  describe("Scenario: A replayed tool call is published once in its final state", () => {
    it("publishes the completed tool call once with its first timestamp", async () => {
      // @step Given a resumed fspec session whose transcript holds a Bash ToolCall "call-1" at t0, ToolProgress "a" at t1 and ToolResult "a b" at t2
      const entries = [
        { ToolCall: { toolCall: { id: "call-1", name: "Bash", input: '{"command":"ls"}' }, ...correlation } },
        { ToolProgress: { toolProgress: { tool_call_id: "call-1", tool_name: "Bash", output_chunk: "a", is_stderr: false }, ...correlation } },
        { ToolResult: { toolResult: { tool_call_id: "call-1", content: "a b", is_error: false }, ...correlation } },
      ];
      // @step When Paseo reopens it with history "replay"
      const { items } = await replayed(entries);
      // @step Then the provider published one tool_call "tool:call-1" with status completed and output "a b" timestamped t0
      expect(items).toHaveLength(1);
      expect(items[0]!.item).toMatchObject({
        id: "tool:call-1",
        status: "completed",
        detail: { type: "shell", command: "ls", output: "a b" },
      });
      expect(items[0]!.timestamp).toBe("2026-10-30T00:00:00Z");
    });
  });

  describe("Scenario: The live stream still publishes every delta", () => {
    it("streams each live snapshot", async () => {
      // @step Given an open fspec session with an active Paseo turn
      const h = await harness();
      await h.open("paseo-1");
      await h.send(h.prompt("paseo-1", "go"));
      await h.waitFor("session.turn", (event) => event.state === "started");
      // @step When the daemon streams Text "Hel" then Text "lo"
      await h.stream(DAEMON, text("Hel"), text("lo"));
      // @step Then the provider published assistant_message snapshots "Hel" and "Hello"
      expect(h.items("assistant_message").map((item) => item.text)).toEqual(["Hel", "Hello"]);
    });
  });
});
