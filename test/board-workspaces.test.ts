/**
 * Feature: spec/features/fspec-board-workspaces.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createBoardFeed } from "../server/board.js";
import type * as wire from "../server/wire.js";
import { FakeDaemon, daemonOptions, tempHome } from "./support/fake-daemon.js";

const disposers: Array<() => unknown> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

function unit(id: string): wire.WorkUnitInfo {
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
  };
}

function session(id: string, project: string, workUnitId: string): wire.SessionInfo {
  return {
    id,
    name: id,
    status: "idle",
    project,
    messageCount: 0,
    providerId: null,
    modelId: null,
    isIsolated: false,
    worktreePath: null,
    role: null,
    updatedAtMs: null,
    workUnitFocus: { revision: 1, context: { id: workUnitId, title: workUnitId, status: "backlog" }, source: "tui" },
  };
}

/** A daemon started in /ws that also serves /app. */
function setup(sessions: wire.SessionInfo[] = []) {
  const home = tempHome();
  home.writeDaemonJson();
  const daemon = new FakeDaemon();
  daemon.handlers.getWorkspaceInfo = () => ({ cwd: "/ws", gitBranch: null });
  daemon.handlers.listWorkspaces = () => ({
    ok: true,
    value: [
      { path: "/ws", name: "ws", start: true },
      { path: "/app", name: "app", start: false },
    ],
  });
  daemon.handlers.listWorkspaceWorkUnits = (request) =>
    request.method === "listWorkspaceWorkUnits" && request.workspace === "/app"
      ? { ok: true, value: [unit("APP-001")] }
      : { ok: false, error: "not a directory" };
  daemon.initialWorkUnits = [unit("FSPEC-001")];
  daemon.initialSessions = sessions;
  const feed = createBoardFeed(daemonOptions(home, daemon));
  disposers.push(home.dispose, () => feed.close());
  return { daemon, feed };
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("Feature: Show the fspec board for every workspace the daemon serves", () => {
  describe("Scenario: The board of another served workspace is read from the daemon", () => {
    it("loads the workspace's units with list_workspace_work_units", async () => {
      // @step Given the fspec daemon started in "/ws" also serves "/app", whose work units are "APP-001"
      const { daemon, feed } = setup();
      // @step When the panel calls fspec.board.watch with cwd "/app/web" and no revision
      const board = await feed.watch({ cwd: "/app/web", sinceRevision: null });
      // @step Then the provider read list_workspace_work_units for "/app"
      expect(daemon.sent("listWorkspaceWorkUnits")).toEqual([{ method: "listWorkspaceWorkUnits", workspace: "/app" }]);
      // @step And it answers state ready for workspace "/app" with the unit "APP-001"
      expect(board).toMatchObject({ state: "ready", workspace: "/app", units: [unit("APP-001")] });
    });
  });

  describe("Scenario: Pushes for a served workspace keep only its board live", () => {
    it("wakes a workspace's watch only for its own push", async () => {
      // @step Given a panel holding fspec.board.watch for "/app" at its current revision
      const { daemon, feed } = setup();
      const first = await feed.watch({ cwd: "/app", sinceRevision: null });
      let answered = false;
      const held = feed.watch({ cwd: "/app", sinceRevision: first.revision }).then((board) => {
        answered = true;
        return board;
      });
      // @step When the daemon pushes WorkUnitsUpdate for the start workspace
      daemon.pushEnvelope({ kind: "workUnitsUpdate", workUnits: [unit("FSPEC-002")] });
      await pause();
      // @step Then the held watch is still waiting
      expect(answered).toBe(false);
      // @step And when the daemon pushes WorkspaceWorkUnitsUpdate for "/app" with "APP-002" the held watch answers with the unit "APP-002"
      daemon.pushEnvelope({ kind: "workspaceWorkUnitsUpdate", workspace: "/app", units: [unit("APP-002")] });
      const next = await held;
      expect(next).toMatchObject({ state: "ready", workspace: "/app", units: [unit("APP-002")] });
      expect(next.revision).not.toBe(first.revision);
      expect(await feed.watch({ cwd: "/ws", sinceRevision: null })).toMatchObject({ units: [unit("FSPEC-002")] });
    });
  });

  describe("Scenario: A workspace's board shows only its own sessions' focus", () => {
    it("scopes the focus map by session project", async () => {
      // @step Given session "s-ws" in "/ws" is focused on "FSPEC-001" and session "s-app" in "/app" is focused on "APP-001"
      const { feed } = setup([session("s-ws", "/ws", "FSPEC-001"), session("s-app", "/app", "APP-001")]);
      // @step When the panel watches the board of "/app"
      const board = await feed.watch({ cwd: "/app", sinceRevision: null });
      // @step Then its focus map is "APP-001" for "s-app" only
      expect(board).toMatchObject({ state: "ready", focus: { "APP-001": ["s-app"] } });
      expect(board.state === "ready" && board.focus).toEqual({ "APP-001": ["s-app"] });
      const start = await feed.watch({ cwd: "/ws", sinceRevision: null });
      expect(start.state === "ready" && start.focus).toEqual({ "FSPEC-001": ["s-ws"] });
    });
  });

  describe("Scenario: Every served workspace offers the board on phones", () => {
    it("answers available for every served workspace", async () => {
      // @step Given the fspec daemon started in "/ws" also serves "/app"
      const { daemon, feed } = setup();
      // @step When the client asks fspec.board.available for "/app/web", "/ws" and "/other"
      const answers = [await feed.available({ cwd: "/app/web" }), await feed.available({ cwd: "/ws" }), await feed.available({ cwd: "/other" })];
      // @step Then "/app/web" and "/ws" are available and "/other" is not
      expect(answers).toEqual([{ available: true }, { available: true }, { available: false }]);
      expect(daemon.sent("listWorkspaceWorkUnits")).toEqual([]);
    });
  });

  describe("Scenario: Card details and moves stay with the start workspace", () => {
    it("refuses details and moves off the start workspace", async () => {
      // @step Given the fspec daemon started in "/ws" also serves "/app"
      const { daemon, feed } = setup();
      // @step When the panel of "/app" asks for card "APP-001"'s details and to move it up
      const details = await feed.details({ cwd: "/app", id: "APP-001" });
      const moved = await feed.move({ cwd: "/app", id: "APP-001", direction: "up" });
      // @step Then both answer "card details and moves are only available in the fspec daemon's start workspace (/ws)"
      const reason = "card details and moves are only available in the fspec daemon's start workspace (/ws)";
      expect(details).toEqual({ state: "unavailable", reason });
      expect(moved).toEqual({ ok: false, error: reason });
      // @step And no get_work_unit_details or move_work_unit_up reached the daemon
      expect(daemon.sent("getWorkUnitDetails")).toEqual([]);
      expect(daemon.sent("moveWorkUnitUp")).toEqual([]);
    });
  });
});
