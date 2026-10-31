/**
 * Feature: spec/features/fspec-work-unit-focus.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { disposeHarnesses, harness, toolCall } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

const focusItems = (h: Awaited<ReturnType<typeof harness>>) =>
  h.items("todo").filter((item) => item.id.endsWith(":focus"));

describe("Feature: Show fspec work units in the Paseo timeline", () => {
  describe("Scenario: The focused work unit shows when the session opens", () => {
    it("seeds the focus item from get_work_unit_focus", async () => {
      // @step Given get_work_unit_focus returns work unit "BUG-285" titled "sync-version flag" in status backlog
      const h = await harness();
      h.daemon.handlers.getWorkUnitFocus = () => ({ ok: true, value: { revision: 1, context: { id: "BUG-285", title: "sync-version flag", status: "backlog" }, source: "paseo" } });
      // @step When Paseo opens an fspec session
      await h.open("paseo-1");
      // @step Then the provider published a todo item "<epoch>:focus" with one in_progress entry "BUG-285 — sync-version flag"
      await vi.waitFor(() => expect(focusItems(h)).toHaveLength(1));
      expect(focusItems(h)[0]!.items).toEqual([{ text: "BUG-285 — sync-version flag", completed: false, status: "in_progress" }]);
    });
  });

  describe("Scenario: A focus change updates the same item", () => {
    it("re-publishes the focus item on focusChanged", async () => {
      // @step Given an open fspec session showing its focus item
      const h = await harness();
      h.daemon.handlers.getWorkUnitFocus = () => ({ ok: true, value: { revision: 1, context: { id: "BUG-285", title: "sync-version flag", status: "backlog" }, source: "paseo" } });
      await h.open("paseo-1");
      await vi.waitFor(() => expect(focusItems(h)).toHaveLength(1));
      // @step When the daemon reports a focusChanged session event to work unit "FSPEC-001" titled "Scaffold" in status done
      h.daemon.pushEnvelope({
        kind: "sessionEvent",
        event: { type: "focusChanged", sessionId: "fspec-sess-42", focus: { revision: 2, context: { id: "FSPEC-001", title: "Scaffold", status: "done" }, source: "paseo" } },
      });
      // @step Then the provider re-published the same todo item with one completed entry "FSPEC-001 — Scaffold"
      await vi.waitFor(() => expect(focusItems(h)).toHaveLength(2));
      expect(focusItems(h)[1]!.id).toBe(focusItems(h)[0]!.id);
      expect(focusItems(h)[1]!.items).toEqual([{ text: "FSPEC-001 — Scaffold", completed: true, status: "completed" }]);
      // @step And a cleared focus re-publishes it with the pending entry "No work unit in focus"
      h.daemon.pushEnvelope({ kind: "sessionEvent", event: { type: "focusChanged", sessionId: "fspec-sess-42", focus: { revision: 3, context: null, source: "paseo" } } });
      await vi.waitFor(() => expect(focusItems(h)).toHaveLength(3));
      expect(focusItems(h)[2]!.items).toEqual([{ text: "No work unit in focus", completed: false, status: "pending" }]);
    });
  });

  describe("Scenario: Tool cards show their work unit", () => {
    it("adds work-unit metadata and the fspec label suffix", async () => {
      // @step Given an fspec session with an active turn
      const h = await harness();
      await h.open("paseo-1");
      await h.send(h.prompt("paseo-1", "go"));
      // @step When the daemon streams a Bash call with work_unit_id "FSPEC-001" and an fspec show-work-unit call with work_unit_id "FSPEC-001"
      await h.stream("fspec-sess-42", toolCall("c1", "Bash", { command: "ls", work_unit_id: "FSPEC-001" }), toolCall("c2", "fspec", { command: "show-work-unit", work_unit_id: "FSPEC-001" }));
      // @step Then both tool cards carry metadata workUnitId "FSPEC-001"
      const cards = h.items("tool_call");
      expect(cards.map((card) => card.metadata)).toEqual([{ workUnitId: "FSPEC-001" }, { workUnitId: "FSPEC-001" }]);
      // @step And the fspec card is labelled "fspec show-work-unit · FSPEC-001"
      expect(cards[1]!.detail).toMatchObject({ type: "plain_text", label: "fspec show-work-unit · FSPEC-001" });
    });
  });
});
