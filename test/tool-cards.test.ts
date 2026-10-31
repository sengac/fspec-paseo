/**
 * Feature: spec/features/fspec-tool-cards.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it } from "vitest";
import { disposeHarnesses, harness, toolCall, toolResult } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

const DAEMON = "fspec-sess-42";

async function activeTurn() {
  const h = await harness();
  await h.open("paseo-1");
  await h.send(h.prompt("paseo-1", "go"));
  await h.waitFor("session.turn", (event) => event.state === "started");
  return h;
}

describe("Feature: Render fspec tool calls clearly and never answer FspecCommandRequest", () => {
  describe("Scenario: An fspec tool call renders as a readable card", () => {
    it("uses plain_text detail with the command label and output", async () => {
      // @step Given an fspec session with an active turn
      const h = await activeTurn();
      // @step When the daemon streams ToolCall "fspec" with input {"command":"list-prefixes","work_unit_id":"NONE"} and its ToolResult "Prefixes (91)"
      await h.stream(DAEMON, toolCall("call-1", "fspec", { command: "list-prefixes", work_unit_id: "NONE" }), toolResult("call-1", "Prefixes (91)"));
      // @step Then the provider published tool_call with plain_text detail labelled "fspec list-prefixes" and text "Prefixes (91)" and status completed
      expect(h.items("tool_call").at(-1)).toMatchObject({
        name: "fspec",
        status: "completed",
        detail: { type: "plain_text", label: "fspec list-prefixes", text: "Prefixes (91)", icon: "wrench" },
      });
    });
  });

  describe("Scenario: fspec command arguments appear in the label", () => {
    it("adds the non-work-unit arguments to the label", async () => {
      // @step Given an fspec session with an active turn
      const h = await activeTurn();
      // @step When the daemon streams ToolCall "fspec" with input {"command":"show-work-unit","args":{"id":"FSPEC-001"},"work_unit_id":"NONE"}
      await h.stream(DAEMON, toolCall("call-2", "fspec", { command: "show-work-unit", args: { id: "FSPEC-001" }, work_unit_id: "NONE" }));
      // @step Then the card label is "fspec show-work-unit {\"args\":{\"id\":\"FSPEC-001\"}}"
      expect(h.items("tool_call").at(-1)!.detail).toEqual({
        type: "plain_text",
        label: 'fspec show-work-unit {"args":{"id":"FSPEC-001"}}',
        icon: "wrench",
      });
    });
  });

  describe("Scenario: FspecCommandRequest is never answered", () => {
    it("ignores the display chunks", async () => {
      // @step Given an fspec session with an active turn
      const h = await activeTurn();
      const before = h.ofType("timeline.item").length;
      // @step When the daemon streams FspecCommandRequest and FspecCommandResult display chunks
      await h.stream(
        DAEMON,
        { type: "fspecCommandRequest", request: { command: "list-prefixes", argsJson: "{}", projectRoot: "/work", toolCallId: "u-1" } },
        { type: "fspecCommandResult", result: { success: true, data: "Prefixes (91)", error: null, systemReminder: null, toolCallId: "u-1" } },
      );
      // @step Then the provider published no timeline item for them and sent no send_fspec_result
      expect(h.ofType("timeline.item")).toHaveLength(before);
      expect(h.daemon.requests.some((request) => (request.method as string) === "sendFspecResult")).toBe(false);
    });
  });
});
