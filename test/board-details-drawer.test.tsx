// @vitest-environment jsdom
/**
 * Feature: spec/features/fspec-board-details-drawer.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 * The document, geometry and state are tested pure; the board and drawer are
 * also rendered with react-native-web, as Paseo desktop and web render them,
 * with Paseo's hooks stubbed.
 */
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  attachmentLink,
  bottomInset,
  documentFor,
  drawerActions,
  drawerHeader,
  canGoBack,
  canGoForward,
  currentId,
  drawerReducer,
  EMPTY_DRAWER,
  drawerWidth,
  type Block,
} from "../client/details-document.js";
import type { BoardUnit } from "../shared/board.js";

function unit(id: string, overrides: Partial<BoardUnit> = {}): BoardUnit {
  return {
    id,
    title: `${id} title`,
    workType: "story",
    status: "backlog",
    description: null,
    estimate: null,
    epic: null,
    attachments: [],
    lastStateChangeAt: null,
    ...overrides,
  };
}

const rpc347 = unit("RPC-347", {
  title: "Backend custom-model RPC + NAPI surface",
  status: "done",
  epic: "rust-frontend",
  estimate: 8,
});

const item = (id: number, text: string, deleted = false) => ({ id, text, deleted, createdAt: "2026-06-20T00:55:49.415Z" });

const record347: Record<string, unknown> = {
  id: "RPC-347",
  title: "Backend custom-model RPC + NAPI surface",
  type: "story",
  status: "done",
  epic: "rust-frontend",
  estimate: 8,
  description: "Backend slice 2 of 2.",
  userStory: { role: "model-selector UI", action: "add, update, and delete custom models", benefit: "the write path is complete" },
  rules: [...Array.from({ length: 9 }, (_, i) => item(i, `Rule ${i + 1}`)), item(9, "Dropped rule", true)],
  examples: Array.from({ length: 8 }, (_, i) => item(i, `Example ${i + 1}`)),
  questions: [],
  architectureNotes: Array.from({ length: 3 }, (_, i) => item(i, `Note ${i + 1}`)),
  dependsOn: ["RPC-346"],
  children: [],
  attachments: ["spec/attachments/RPC-347/a.md", "spec/attachments/RPC-347/b.md"],
  stateHistory: [
    { state: "specifying", timestamp: "2026-06-20T02:52:28.000Z" },
    { state: "done", timestamp: "2026-06-20T07:24:46.000Z" },
  ],
  createdAt: "2026-06-20T02:52:28.000Z",
  updatedAt: "2026-06-20T07:24:46.000Z",
  nextRuleId: 10,
};

const find = <K extends Block["kind"]>(blocks: Block[], kind: K) =>
  blocks.find((block): block is Extract<Block, { kind: K }> => block.kind === kind);


vi.mock("react-native", async () => await import("react-native-web"));

const renderedUnit = {
  id: "RPC-347",
  title: "Backend custom-model RPC + NAPI surface",
  workType: "story",
  status: "done",
  description: "Backend slice 2 of 2.",
  estimate: 8,
  epic: "rust-frontend",
  attachments: [],
  lastStateChangeAt: null,
};

const otherUnit = { ...renderedUnit, id: "RPC-440", title: "Expose get_default_model", status: "backlog", estimate: null };

vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: () => async ({ id }: { id: string }) => ({
    state: "ready",
    id,
    workUnit:
      id === renderedUnit.id
        ? {
            id,
            title: renderedUnit.title,
            rules: [{ id: 0, text: "Rule one", deleted: false }],
            attachments: ["spec/attachments/RPC-347/notes.md"],
          }
        : { id, title: otherUnit.title },
  }),
  usePaseo: () => ({}),
  useWorkspace: () => "/work",
  useTabState: (_tab: unknown, _schema: unknown, initial: unknown) => useState(initial),
}));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const web = await import("react-native-web");
  return {
    ScrollView: web.ScrollView,
    FlatList: web.FlatList,
    TextInput: web.TextInput,
    Loading: () => null,
    // Paseo's Markdown resolves workspace file links; the stub exposes what it was given.
    Markdown: ({ children }: { children: string }) => <span data-markdown={children}>{children}</span>,
    useToast: () => ({ show() {}, error() {} }),
  };
});
vi.mock("../client/use-board.js", () => ({
  useBoard: () => ({ board: { state: "ready", revision: "1", workspace: "/work", units: [renderedUnit, otherUnit], focus: {} }, error: null }),
}));

const theme = {
  colors: {
    surface0: "#101010",
    surface1: "#181818",
    surface2: "#202020",
    border: "#303030",
    foreground: "#f0f0f0",
    foregroundMuted: "#a0a0a0",
    accent: "#3388ff",
    accentForeground: "#ffffff",
    statusSuccess: "#33cc66",
    statusWarning: "#ffcc33",
    statusDanger: "#ff4444",
  },
};

describe("Feature: Show work unit details in a drawer over the fspec board", () => {
  describe("Scenario: Selecting a card opens the drawer with the snapshot first", () => {
    it("opens at once from the board snapshot", () => {
      // @step Given the board shows RPC-347 "Backend custom-model RPC + NAPI surface" (story, done, epic rust-frontend, 8 points)
      const card = rpc347;
      // @step When the user selects RPC-347
      const state = drawerReducer(EMPTY_DRAWER, { type: "select", id: card.id });
      const header = drawerHeader(card, null);
      // @step Then the drawer opens for RPC-347 at once with the title "RPC-347 — Backend custom-model RPC + NAPI surface"
      expect(currentId(state)).toBe("RPC-347");
      expect(header.title).toBe("RPC-347 — Backend custom-model RPC + NAPI surface");
      // @step And its chips read "story", "done", "rust-frontend" and "8 pts" before the full record has loaded
      expect(header.chips).toEqual(["story", "done", "rust-frontend", "8 pts"]);
      expect(drawerHeader(unit("X-1"), null).chips).toEqual(["story", "backlog"]);
    });
  });

  describe("Scenario: The card's actions sit at the top of the drawer", () => {
    it("offers the card's actions", () => {
      // @step Given the drawer shows RPC-347 (done) and the drawer shows RPC-440 (backlog)
      const done = rpc347;
      const backlog = unit("RPC-440");
      // @step When the drawer lists their actions
      const labels = (card: BoardUnit) => drawerActions(card, true).map((action) => action.label);
      // @step Then RPC-347 offers "Open in agent" and "Close"
      expect(labels(done)).toEqual(["Open in agent", "Close"]);
      // @step And RPC-440 offers "Open in agent", "Move up", "Move down" and "Close"
      expect(labels(backlog)).toEqual(["Open in agent", "Move up", "Move down", "Close"]);
      expect(drawerActions(backlog, false).map((action) => action.id)).toEqual(["moveUp", "moveDown", "close"]);
    });
  });

  describe("Scenario: The full record is laid out as formatted blocks", () => {
    it("builds typed blocks in order", () => {
      // @step Given RPC-347's record with a user story, 9 rules, 8 examples, 3 architecture notes, a deleted rule, depends-on RPC-346, 2 attachments and a status history
      const record = record347;
      // @step When the drawer lays out the record
      const blocks = documentFor(record);
      // @step Then the blocks are Description, User Story, Rules, Examples, Architecture Notes, Relationships, Attachments, History and Details, in that order
      expect(blocks.map((block) => block.title)).toEqual([
        "Description",
        "User Story",
        "Rules",
        "Examples",
        "Architecture Notes",
        "Relationships",
        "Attachments",
        "History",
        "Details",
      ]);
      // @step And the user story reads "As a", "I want" and "So that" with the record's role, action and benefit
      expect(find(blocks, "userStory")!.rows).toEqual([
        { label: "As a", text: "model-selector UI" },
        { label: "I want", text: "add, update, and delete custom models" },
        { label: "So that", text: "the write path is complete" },
      ]);
      // @step And the rules are numbered 1 to 9 without the deleted rule
      const rules = blocks.find((block) => block.title === "Rules");
      expect(rules).toEqual({ kind: "numbered", title: "Rules", items: Array.from({ length: 9 }, (_, i) => `Rule ${i + 1}`) });
      // @step And Relationships has a "Depends On" chip for RPC-346
      expect(find(blocks, "links")!.groups).toEqual([{ label: "Depends On", ids: ["RPC-346"] }]);
      // @step And History lists each status with its time
      expect(find(blocks, "history")!.items).toEqual([
        { state: "specifying", at: "2026-06-20T02:52:28.000Z" },
        { state: "done", at: "2026-06-20T07:24:46.000Z" },
      ]);
      expect(find(blocks, "attachments")!.items).toEqual(["spec/attachments/RPC-347/a.md", "spec/attachments/RPC-347/b.md"]);
      // Bookkeeping counters are not shown; timestamps are.
      expect(find(blocks, "fields")!.rows.map((row) => row.label)).toEqual(["Created At", "Updated At"]);
    });
  });

  describe("Scenario: Questions show their answers and open questions are marked", () => {
    it("pairs questions with answers", () => {
      // @step Given a record with an answered question "Support OAuth?" answered "Yes" and an open question "Which host?"
      const record = {
        questions: [
          { id: 0, text: "Support OAuth?", selected: true, answer: "Yes", deleted: false },
          { id: 1, text: "Which host?", selected: false, deleted: false },
        ],
      };
      // @step When the drawer lays out the record
      const questions = find(documentFor(record), "questions");
      // @step Then the Questions block shows "Support OAuth?" with "Answer: Yes" and "Which host?" marked open
      expect(questions!.items).toEqual([
        { text: "Support OAuth?", answer: "Yes" },
        { text: "Which host?", answer: null },
      ]);
    });
  });

  describe("Scenario: Event Storm items are grouped by kind", () => {
    it("groups the storm", () => {
      // @step Given a record whose event storm has two domain events and a hotspot
      const record = {
        eventStorm: {
          level: "process_modeling",
          items: [
            { type: "event", text: "UserRegistered", deleted: false },
            { type: "event", text: "EmailVerified", deleted: false },
            { type: "hotspot", text: "Timeout", concern: "unclear", deleted: false },
          ],
        },
      };
      // @step When the drawer lays out the record
      const storm = find(documentFor(record), "storm");
      // @step Then the Event Storm block has "Domain Events" with 2 items and "Hotspots" with 1 item
      expect(storm!.groups.map((group) => [group.title, group.items.length])).toEqual([
        ["Domain Events", 2],
        ["Hotspots", 1],
      ]);
      expect(storm!.groups[1]!.items[0]).toBe("Timeout — Concern: unclear");
    });
  });

  describe("Scenario: Fields the drawer does not know are still shown", () => {
    it("keeps unknown fields and drops empty blocks", () => {
      // @step Given a record with an unknown field "reviewNotes" of "looks good" and empty examples
      const record = { reviewNotes: "looks good", examples: [] };
      // @step When the drawer lays out the record
      const blocks = documentFor(record);
      // @step Then the Details block shows "Review Notes" with "looks good"
      expect(find(blocks, "fields")!.rows).toEqual([{ label: "Review Notes", value: "looks good" }]);
      // @step And no Examples block is shown
      expect(blocks.some((block) => block.title === "Examples")).toBe(false);
    });
  });

  describe("Scenario: The drawer's width follows the layout", () => {
    it("sizes the drawer", () => {
      // @step Given a board 400 wide on a compact layout and a board 1200 wide on a wide layout
      const compact = { width: 400, compact: true };
      const wide = { width: 1200, compact: false };
      // @step When the drawer sizes itself
      const sizes = [drawerWidth(compact.width, compact.compact), drawerWidth(wide.width, wide.compact)];
      // @step Then it is 352 wide on the compact board and 540 wide on the wide board
      expect(sizes).toEqual([352, 540]);
      // @step And it is never wider than 480 when compact or outside 360 to 560 otherwise
      expect(drawerWidth(900, true)).toBe(480);
      expect(drawerWidth(600, false)).toBe(360);
      expect(drawerWidth(2000, false)).toBe(560);
    });
  });

  describe("Scenario: Android content clears the navigation bar", () => {
    it("reserves the Android navigation bar", () => {
      // @step Given the platform is Android, then iOS, then web
      const platforms = ["android", "ios", "web"] as const;
      // @step When the drawer and the board compute their bottom clearance
      const clearance = platforms.map(bottomInset);
      // @step Then the clearance is 48 on Android and 0 on iOS and web
      expect(clearance).toEqual([48, 0, 0]);
    });
  });

  describe("Scenario: Tapping a relationship shows that work unit and adds it to the history", () => {
    it("follows the link in place", () => {
      // @step Given the drawer shows RPC-347 with a Depends On chip for RPC-346
      let state = drawerReducer(EMPTY_DRAWER, { type: "select", id: "RPC-347" });
      expect(find(documentFor(record347), "links")!.groups[0]!.ids).toContain("RPC-346");
      // @step When the user taps the RPC-346 chip
      state = drawerReducer(state, { type: "follow", id: "RPC-346" });
      // @step Then the drawer shows RPC-346
      expect(currentId(state)).toBe("RPC-346");
      // @step And its back arrow is enabled and its forward arrow disabled
      expect([canGoBack(state), canGoForward(state)]).toEqual([true, false]);
    });
  });

  describe("Scenario: Back and forward step through the work units the drawer showed", () => {
    it("walks the history", () => {
      // @step Given the drawer went from RPC-347 to RPC-440 to RPC-346 through relationship chips
      let state = drawerReducer(EMPTY_DRAWER, { type: "select", id: "RPC-347" });
      state = drawerReducer(state, { type: "follow", id: "RPC-440" });
      state = drawerReducer(state, { type: "follow", id: "RPC-346" });
      // @step When the user goes back twice, then forward once, then taps a chip for RPC-300
      const back1 = drawerReducer(state, { type: "back" });
      const back2 = drawerReducer(back1, { type: "back" });
      const forward = drawerReducer(back2, { type: "forward" });
      const followed = drawerReducer(forward, { type: "follow", id: "RPC-300" });
      // @step Then the drawer shows RPC-440, then RPC-347 with back disabled, then RPC-440
      expect(currentId(back1)).toBe("RPC-440");
      expect(currentId(back2)).toBe("RPC-347");
      expect(canGoBack(back2)).toBe(false);
      expect(drawerReducer(back2, { type: "back" })).toEqual(back2);
      expect(currentId(forward)).toBe("RPC-440");
      // @step And after RPC-300 the history is RPC-347, RPC-440, RPC-300 with forward disabled
      expect(followed.history).toEqual(["RPC-347", "RPC-440", "RPC-300"]);
      expect(currentId(followed)).toBe("RPC-300");
      expect(canGoForward(followed)).toBe(false);
      expect(drawerReducer(followed, { type: "forward" })).toEqual(followed);
    });
  });

  describe("Scenario: Selecting a card on the board starts a new history", () => {
    it("resets the history", () => {
      // @step Given the drawer shows RPC-346 after following chips from RPC-347
      let state = drawerReducer(EMPTY_DRAWER, { type: "select", id: "RPC-347" });
      state = drawerReducer(state, { type: "follow", id: "RPC-346" });
      // @step When the user selects RPC-500 on the board
      state = drawerReducer(state, { type: "select", id: "RPC-500" });
      // @step Then the drawer shows RPC-500 with both arrows disabled
      expect(currentId(state)).toBe("RPC-500");
      expect([canGoBack(state), canGoForward(state)]).toEqual([false, false]);
      // @step And Close clears the selection
      expect(currentId(drawerReducer(state, { type: "close" }))).toBeNull();
    });
  });

  describe("Scenario: Selecting a card opens the drawer with the snapshot first (rendered)", () => {
    it("shows the drawer over the rendered board", async () => {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      const { BoardPanel } = await import("../client/board-panel.js");
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      // @step Given the board shows RPC-347 "Backend custom-model RPC + NAPI surface" (story, done, epic rust-frontend, 8 points)
      await act(async () => {
        root.render(
          <BoardPanel
            {...({} as never)}
            theme={theme as never}
            layout={{ compact: false, platform: "web" }}
            workspaceId="w1"
            tab={{} as never}
            navigation={undefined}
          />,
        );
      });
      const card = [...host.querySelectorAll<HTMLElement>('[role="button"]')].find((el) =>
        el.textContent?.includes(renderedUnit.title),
      );
      expect(card).toBeDefined();
      // @step When the user selects RPC-347
      await act(async () => card!.click());
      await act(async () => new Promise((resolve) => setTimeout(resolve, 400)));
      // @step Then the drawer opens for RPC-347 at once with the title "RPC-347 — Backend custom-model RPC + NAPI surface"
      expect(host.textContent).toContain("RPC-347 — Backend custom-model RPC + NAPI surface");
      // @step And its chips read "story", "done", "rust-frontend" and "8 pts" before the full record has loaded
      expect(host.textContent).toContain("8 pts");
      // A done card without agent navigation offers only Close.
      expect(host.textContent).toContain("Close");
      expect(host.textContent).not.toContain("Move up");
      expect(host.textContent).toContain("Rule one");
      // The panel has slid fully in.
      const panel = [...host.querySelectorAll<HTMLElement>("div")].find((el) => (el.getAttribute("style") ?? "").includes("translateX"));
      expect(panel?.getAttribute("style")).toContain("translateX(0px)");
      act(() => root.unmount());
    });
  });

  describe("Scenario: The board stays usable beside the drawer", () => {
    it("switches cards without a backdrop or shadow", async () => {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      const { BoardPanel } = await import("../client/board-panel.js");
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      const cardFor = (title: string) =>
        [...host.querySelectorAll<HTMLElement>('[role="button"]')].find((el) => el.textContent?.includes(title) && !el.textContent?.includes("—"));
      // @step Given the board shows RPC-347 and RPC-440 with RPC-347's drawer open
      await act(async () => {
        root.render(
          <BoardPanel
            {...({} as never)}
            theme={theme as never}
            layout={{ compact: false, platform: "web" }}
            workspaceId="w1"
            tab={{} as never}
            navigation={undefined}
          />,
        );
      });
      await act(async () => cardFor(renderedUnit.title)!.click());
      await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
      expect(host.textContent).toContain("RPC-347 — ");
      // @step When the user selects RPC-440 on the board
      await act(async () => cardFor(otherUnit.title)!.click());
      await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
      // @step Then the drawer shows RPC-440
      expect(host.textContent).toContain("RPC-440 — Expose get_default_model");
      expect(host.textContent).not.toContain("RPC-347 — ");
      // @step And nothing dims or covers the board, and the drawer has no shadow
      expect(host.querySelector('[aria-label="Close details"]')).toBeNull();
      const styles = [...host.querySelectorAll<HTMLElement>("div")].map((el) => el.getAttribute("style") ?? "");
      expect(styles.some((style) => style.includes("box-shadow"))).toBe(false);
      expect(styles.some((style) => style.includes("opacity: 0.6"))).toBe(false);
      act(() => root.unmount());
    });
  });

  describe("Scenario: Attachments open in Paseo's file viewer", () => {
    it("links each attachment to its file", async () => {
      // @step Given the daemon workspace "/Users/me/fspec" and RPC-347's attachment "spec/attachments/RPC-347/ast-research notes.md"
      const workspace = "/Users/me/fspec";
      const path = "spec/attachments/RPC-347/ast-research notes.md";
      // @step When the drawer lays out the attachment
      const link = attachmentLink(workspace, path);
      // @step Then it is a Markdown link "ast-research notes.md" to "/Users/me/fspec/spec/attachments/RPC-347/ast-research notes.md"
      expect(link).toEqual({
        name: "ast-research notes.md",
        folder: "spec/attachments/RPC-347",
        markdown: "[ast-research notes.md](</Users/me/fspec/spec/attachments/RPC-347/ast-research notes.md>)",
      });
      expect(attachmentLink("/w/", "/abs/file.md").markdown).toBe("[file.md](</abs/file.md>)");
      // @step And the drawer renders it with the plugin Markdown component so Paseo opens the file
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      const { BoardPanel } = await import("../client/board-panel.js");
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      await act(async () => {
        root.render(
          <BoardPanel
            {...({} as never)}
            theme={theme as never}
            layout={{ compact: false, platform: "web" }}
            workspaceId="w1"
            tab={{} as never}
            navigation={undefined}
          />,
        );
      });
      const card = [...host.querySelectorAll<HTMLElement>('[role="button"]')].find((el) => el.textContent?.includes(renderedUnit.title));
      await act(async () => card!.click());
      await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
      const markdown = [...host.querySelectorAll("[data-markdown]")].map((el) => el.getAttribute("data-markdown"));
      expect(markdown).toContain("[notes.md](</work/spec/attachments/RPC-347/notes.md>)");
      act(() => root.unmount());
    });
  });
});
