/**
 * Feature: spec/features/fspec-stderr-markers.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it } from "vitest";
import { disposeHarnesses, harness, toolCall, toolProgress, toolResult } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

async function running(callId: string) {
  const h = await harness();
  await h.open("paseo-1");
  await h.send(h.prompt("paseo-1", "time it"));
  await h.stream("fspec-sess-42", toolCall(callId, "Bash", { command: "time true" }));
  return h;
}

describe("Feature: Strip fspec stderr markers from shell output", () => {
  describe("Scenario: Stderr markers are removed from shell output", () => {
    it("removes the markers and keeps the text", async () => {
      // @step Given an fspec session running a Bash tool call "call-1"
      const h = await running("call-1");
      // @step When the daemon streams ToolResult "⚠stderr⚠real\t0m0.017s\n⚠stderr⚠user\t0m0.004s\n" for "call-1"
      await h.stream("fspec-sess-42", toolResult("call-1", "⚠stderr⚠real\t0m0.017s\n⚠stderr⚠user\t0m0.004s\n"));
      // @step Then the shell card output is "real\t0m0.017s\nuser\t0m0.004s\n"
      expect(h.items("tool_call").at(-1)!.detail).toEqual({ type: "shell", command: "time true", output: "real\t0m0.017s\nuser\t0m0.004s\n" });
    });
  });

  describe("Scenario: Unmarked output is unchanged", () => {
    it("keeps plain output as is", async () => {
      // @step Given an fspec session running a Bash tool call "call-2"
      const h = await running("call-2");
      // @step When the daemon streams ToolProgress "a.txt\n" and ToolResult "a.txt\n" for "call-2"
      await h.stream("fspec-sess-42", toolProgress("call-2", "a.txt\n"), toolResult("call-2", "a.txt\n"));
      // @step Then the shell card output is "a.txt\n"
      expect(h.items("tool_call").at(-1)!.detail).toMatchObject({ output: "a.txt\n" });
    });
  });
});
