/**
 * Feature: spec/features/fspec-board-panel.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOARD_COLUMNS,
  cardLabel,
  compactColumn,
  groupColumns,
  latestChange,
  pointsSummary,
  revealCard,
  searchUnits,
} from "../client/board-model.js";
import { watchBoard } from "../client/board-watch.js";
import { BOARD_PANEL_ID, registerBoard } from "../client/register.js";
import type { BoardUnit, BoardWatchInput, BoardWatchOutput } from "../shared/board.js";

afterEach(() => {
  vi.useRealTimers();
});

function unit(id: string, status: string, overrides: Partial<BoardUnit> = {}): BoardUnit {
  return {
    id,
    title: `${id} title`,
    workType: "story",
    status,
    description: null,
    estimate: null,
    epic: null,
    attachments: [],
    lastStateChangeAt: null,
    ...overrides,
  };
}

const ids = (units: readonly BoardUnit[]) => units.map((u) => u.id);

describe("Feature: Show the fspec board as a native Paseo workspace panel", () => {
  describe("Scenario: Columns, counts and the points summary follow the fspec board", () => {
    it("groups units into the seven fspec columns", () => {
      // @step Given a board with "FSPEC-001" in backlog with 3 points, "FSPEC-002" in done with 5 points and "FSPEC-003" in backlog unestimated
      const units = [
        unit("FSPEC-001", "backlog", { estimate: 3 }),
        unit("FSPEC-002", "done", { estimate: 5 }),
        unit("FSPEC-003", "backlog"),
      ];
      // @step When the panel groups the board into columns
      const columns = groupColumns(units);
      // @step Then the columns are backlog, specifying, testing, implementing, validating, done and blocked in that order
      expect(columns.map((c) => c.status)).toEqual([
        "backlog",
        "specifying",
        "testing",
        "implementing",
        "validating",
        "done",
        "blocked",
      ]);
      expect(BOARD_COLUMNS).toHaveLength(7);
      // @step And backlog holds "FSPEC-001" then "FSPEC-003", done holds "FSPEC-002" and every other column is empty
      const byStatus = Object.fromEntries(columns.map((c) => [c.status, ids(c.units)]));
      expect(byStatus).toEqual({
        backlog: ["FSPEC-001", "FSPEC-003"],
        specifying: [],
        testing: [],
        implementing: [],
        validating: [],
        done: ["FSPEC-002"],
        blocked: [],
      });
      // @step And the summary reads "3 points in progress, 5 points completed"
      expect(pointsSummary(units)).toBe("3 points in progress, 5 points completed");
    });
  });

  describe("Scenario: Card labels show points, focus and the most recent change", () => {
    it("labels cards like the TUI cell", () => {
      // @step Given "FSPEC-001" has 3 points and an fspec session focused on it
      const focus = { "FSPEC-001": ["fspec-sess-1"] };
      // @step And "FSPEC-002" changed state at 02:00 and "FSPEC-001" at 01:00
      const units = [
        unit("FSPEC-001", "backlog", { estimate: 3, lastStateChangeAt: "2026-10-30T01:00:00Z" }),
        unit("FSPEC-002", "done", { lastStateChangeAt: "2026-10-30T02:00:00Z" }),
        unit("FSPEC-003", "backlog"),
      ];
      // @step When the panel labels the cards
      const labels = units.map((u) => cardLabel(u, focus));
      // @step Then "FSPEC-001" reads "🟢 FSPEC-001 [3]" and "FSPEC-003" reads "FSPEC-003"
      expect(labels[0]).toBe("🟢 FSPEC-001 [3]");
      expect(labels[2]).toBe("FSPEC-003");
      // @step And only "FSPEC-002" is marked as the most recent change
      expect(latestChange(units)).toBe("FSPEC-002");
    });
  });

  describe("Scenario: Search matches id, title or description like the TUI", () => {
    it("filters case-insensitively by the chosen mode", () => {
      // @step Given "FSPEC-001" titled "Scaffold the plugin" with no description and "FSPEC-002" described as "Wire codec"
      const units = [
        unit("FSPEC-001", "done", { title: "Scaffold the plugin" }),
        unit("FSPEC-002", "done", { description: "Wire codec" }),
      ];
      // @step When the user searches "scaff" in title mode
      const byTitle = searchUnits(units, "title", "scaff");
      // @step Then only "FSPEC-001" matches
      expect(ids(byTitle)).toEqual(["FSPEC-001"]);
      expect(ids(searchUnits(units, "id", "fspec-00"))).toEqual(["FSPEC-001", "FSPEC-002"]);
      // @step And an empty query in description mode matches only "FSPEC-002"
      expect(ids(searchUnits(units, "description", ""))).toEqual(["FSPEC-002"]);
    });
  });

  describe("Scenario: Compact layouts open on the first non-empty column and follow search", () => {
    it("chooses the first non-empty column and reveals search results", () => {
      // @step Given a compact layout where backlog is empty and specifying holds "FSPEC-004"
      const units = [unit("FSPEC-004", "specifying"), unit("FSPEC-002", "done")];
      const columns = groupColumns(units);
      // @step When the panel opens without a chosen column
      const opened = compactColumn(null, columns);
      // @step Then it shows the specifying column
      expect(opened).toBe("specifying");
      expect(compactColumn("done", columns)).toBe("done");
      expect(compactColumn(null, groupColumns([]))).toBe("backlog");
      // @step And choosing search result "FSPEC-002" in done switches to done and selects "FSPEC-002"
      expect(revealCard(unit("FSPEC-002", "done"))).toEqual({ column: "done", selected: "FSPEC-002" });
    });
  });

  describe("Scenario: The panel keeps watching the board", () => {
    it("re-issues the watch with each revision and retries failures", async () => {
      // @step Given a panel watching workspace "/ws"
      vi.useFakeTimers();
      const calls: BoardWatchInput[] = [];
      const answers: Array<() => Promise<BoardWatchOutput>> = [
        async () => ({ state: "ready", revision: "E:1", workspace: "/ws", units: [], focus: {} }),
        async () => ({ state: "unavailable", revision: "E:2", reason: "fspec daemon connection was lost: x" }),
        async () => ({ state: "ready", revision: "E:3", workspace: "/ws", units: [], focus: {} }),
        async () => {
          throw new Error("plugin RPC timed out");
        },
        async () => ({ state: "ready", revision: "E:4", workspace: "/ws", units: [], focus: {} }),
      ];
      const pending = new Promise<BoardWatchOutput>(() => {});
      const seen: BoardWatchOutput[] = [];
      const stop = watchBoard({
        cwd: "/ws",
        watch: (input) => {
          calls.push(input);
          const next = answers.shift();
          return next ? next() : pending;
        },
        onBoard: (board) => seen.push(board),
      });
      // @step When fspec.board.watch answers revision "E:1"
      await vi.advanceTimersByTimeAsync(0);
      // @step Then the panel shows that board and immediately watches again since "E:1"
      expect(seen[0]).toMatchObject({ state: "ready", revision: "E:1" });
      expect(calls.slice(0, 2)).toEqual([
        { cwd: "/ws", sinceRevision: null },
        { cwd: "/ws", sinceRevision: "E:1" },
      ]);
      // @step And an unavailable answer is shown and replaced by the next ready answer
      expect(seen.map((b) => b.state)).toEqual(["ready", "unavailable", "ready"]);
      // @step And a failed watch is retried after 3 seconds
      expect(calls).toHaveLength(4);
      await vi.advanceTimersByTimeAsync(2_999);
      expect(calls).toHaveLength(4);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls[4]).toEqual({ cwd: "/ws", sinceRevision: "E:3" });
      await vi.advanceTimersByTimeAsync(0);
      expect(seen.at(-1)).toMatchObject({ revision: "E:4" });
      stop();
      expect(calls).toHaveLength(6);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(calls).toHaveLength(6);
    });
  });

  describe("Scenario: The panel opens from the Command Center and /board", () => {
    it("registers the panel, the Command Center item and /board", async () => {
      // @step Given the fspec plugin client is contributed
      const panels: Array<{ id: string; title: unknown; locations?: readonly string[] }> = [];
      const items: Array<{ id: string; title: unknown; context: string; onSelect: (ctx: never) => unknown }> = [];
      const commands: Array<{ name: string; context: string; onSubmit: (ctx: never) => unknown }> = [];
      const Panel = () => null;
      const cleanup = registerBoard(
        {
          addWorkspacePanel: (p) => (panels.push(p as never), () => {}),
          addCommandCenterItem: (i) => (items.push(i as never), () => {}),
          addSlashCommand: (c) => (commands.push(c as never), () => {}),
        },
        Panel,
      );
      // @step When the user selects "Open fspec board" or submits /board in a workspace
      const opened: string[] = [];
      const ctx = { openPanel: (id: string) => opened.push(id) } as never;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ title: "Open fspec board", context: "workspace" });
      await items[0]!.onSelect(ctx);
      expect(commands).toHaveLength(1);
      expect(commands[0]).toMatchObject({ name: "board", context: "workspace" });
      await commands[0]!.onSubmit(ctx);
      // @step Then the workspace panel "fspec-board" titled "fspec board" opens
      expect(panels).toEqual([
        expect.objectContaining({ id: "fspec-board", title: "fspec board", locations: ["workspace"], Component: Panel }),
      ]);
      expect(opened).toEqual([BOARD_PANEL_ID, BOARD_PANEL_ID]);
      expect(BOARD_PANEL_ID).toBe("fspec-board");
      cleanup();
    });
  });
});
