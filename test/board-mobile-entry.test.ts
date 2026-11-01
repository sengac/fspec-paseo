/**
 * Feature: spec/features/fspec-board-mobile-entry.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { type WorkspaceEvent, syncBoardButtons } from "../client/board-buttons.js";
import { createBoardFeed } from "../server/board.js";
import { FakeDaemon, daemonOptions, tempHome } from "./support/fake-daemon.js";

const disposers: Array<() => unknown> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

function fakeHost(served: string) {
  let emit: (event: WorkspaceEvent) => void = () => {};
  const buttons = new Map<string, { title: string; press: () => void; removed: boolean }>();
  const opened: string[] = [];
  let released = false;
  const stop = syncBoardButtons({
    watchWorkspaces(onEvent) {
      emit = onEvent;
      return () => {
        released = true;
      };
    },
    available: async (cwd) => cwd === served || cwd.startsWith(`${served}/`),
    addHeaderButton({ id, workspaceId, button }) {
      expect(id).toBe("fspec-board");
      const entry = { title: button.title, press: () => void button.behavior.onPress(), removed: false };
      buttons.set(workspaceId, entry);
      return {
        remove() {
          entry.removed = true;
        },
      };
    },
    openPanel: (workspaceId) => opened.push(workspaceId),
  });
  return {
    emit: (event: WorkspaceEvent) => emit(event),
    buttons,
    opened,
    stop,
    live: () => [...buttons].filter(([, b]) => !b.removed).map(([id]) => id),
    released: () => released,
  };
}

describe("Feature: Open the fspec board from the workspace menu on phones", () => {
  describe("Scenario: Workspaces the fspec daemon serves get an fspec board button", () => {
    it("adds a header button only where the daemon serves the directory", async () => {
      // @step Given workspaces "W1" in "/ws" and "W2" in "/other" while the fspec daemon serves "/ws"
      const host = fakeHost("/ws");
      // @step When the plugin client starts
      host.emit({
        kind: "snapshot",
        entries: [
          { id: "W1", projectRootPath: "/ws", workspaceDirectory: "/ws" },
          { id: "W2", projectRootPath: "/other" },
        ],
      });
      // @step Then "W1" has an "fspec board" header button and "W2" has none
      await vi.waitFor(() => expect(host.live()).toEqual(["W1"]));
      expect(host.buttons.get("W1")!.title).toBe("fspec board");
      host.emit({ kind: "upsert", workspace: { id: "W3", projectRootPath: "/ws", workspaceDirectory: "/ws/sub" } });
      await vi.waitFor(() => expect(host.live()).toEqual(["W1", "W3"]));
      host.emit({ kind: "upsert", workspace: { id: "W1", projectRootPath: "/ws", workspaceDirectory: "/ws" } });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(host.live()).toEqual(["W1", "W3"]);
      // @step And pressing the button opens panel "fspec-board" in "W1"
      host.buttons.get("W1")!.press();
      expect(host.opened).toEqual(["W1"]);
      host.stop();
    });
  });

  describe("Scenario: Buttons follow workspace removal and plugin unload", () => {
    it("removes buttons with their workspace and on unload", async () => {
      // @step Given "W1" has an "fspec board" header button
      const host = fakeHost("/ws");
      host.emit({
        kind: "snapshot",
        entries: [
          { id: "W1", projectRootPath: "/ws" },
          { id: "W2", projectRootPath: "/ws/b" },
        ],
      });
      await vi.waitFor(() => expect(host.live()).toEqual(["W1", "W2"]));
      // @step When Paseo reports "W1" removed
      host.emit({ kind: "remove", id: "W1" });
      // @step Then its button is removed
      expect(host.live()).toEqual(["W2"]);
      // @step And unloading the plugin removes every button and releases the workspace subscription
      host.stop();
      expect(host.live()).toEqual([]);
      expect(host.released()).toBe(true);
      host.emit({ kind: "upsert", workspace: { id: "W4", projectRootPath: "/ws" } });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(host.live()).toEqual([]);
    });
  });

  describe("Scenario: The daemon answers which directories it serves", () => {
    it("applies the workspace guard", async () => {
      // @step Given the fspec daemon serves "/ws"
      const home = tempHome();
      home.writeDaemonEntry();
      const daemon = new FakeDaemon();
      daemon.handlers.getWorkspaceInfo = () => ({ cwd: "/ws", gitBranch: null });
      const feed = createBoardFeed(daemonOptions(home, daemon));
      disposers.push(home.dispose, () => feed.close());
      // @step When the client asks fspec.board.available for "/ws/sub" and "/other"
      const inside = await feed.available({ cwd: "/ws/sub" });
      const outside = await feed.available({ cwd: "/other" });
      // @step Then "/ws/sub" is available and "/other" is not
      expect(inside).toEqual({ available: true });
      expect(outside).toEqual({ available: false });
      await feed.close();
      await expect(feed.available({ cwd: "/ws" })).resolves.toEqual({ available: false });
    });
  });
});
