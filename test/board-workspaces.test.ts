/**
 * Feature: spec/features/fspec-board-workspaces.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createBoardFeed } from "../server/board.js";
import * as wire from "../server/wire.js";
import { FakeDaemon, daemonOptions, tempHome } from "./support/fake-daemon.js";
import { disposeHarnesses, harness } from "./support/provider-harness.js";

const disposers: Array<() => unknown> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
  await disposeHarnesses();
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
  home.writeDaemonEntry();
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
      expect(answers).toEqual([{ state: "served" }, { state: "served" }, { state: "unserved", reason: expect.stringContaining("not /other") }]);
      expect(daemon.sent("listWorkspaceWorkUnits")).toEqual([]);
    });
  });

  describe("Scenario: Card details and moves act on the panel's workspace", () => {
    it("sends the served workspace with every details and move call", async () => {
      // @step Given the fspec daemon started in "/ws" also serves "/app"
      const { daemon, feed } = setup();
      daemon.handlers.getWorkUnitDetails = (request) =>
        request.method === "getWorkUnitDetails"
          ? { ok: true, value: JSON.stringify({ id: request.id, workspace: request.workspace, workUnit: { id: request.id } }) }
          : { ok: false, error: "unexpected" };
      daemon.handlers.moveWorkUnitUp = () => ({ ok: true, value: undefined });
      daemon.handlers.moveWorkUnitDown = () => ({ ok: true, value: undefined });
      // @step When the panel of "/app/web" asks for card "APP-001"'s details and to move it up and down, and the panel of "/ws" asks for card "FSPEC-001"'s details
      const details = await feed.details({ cwd: "/app/web", id: "APP-001" });
      const up = await feed.move({ cwd: "/app/web", id: "APP-001", direction: "up" });
      const down = await feed.move({ cwd: "/app/web", id: "APP-001", direction: "down" });
      const start = await feed.details({ cwd: "/ws", id: "FSPEC-001" });
      // @step Then the daemon received get_work_unit_details("/app", "APP-001"), move_work_unit_up("/app", "APP-001"), move_work_unit_down("/app", "APP-001") and get_work_unit_details("/ws", "FSPEC-001")
      expect(daemon.sent("getWorkUnitDetails")).toEqual([
        { method: "getWorkUnitDetails", workspace: "/app", id: "APP-001" },
        { method: "getWorkUnitDetails", workspace: "/ws", id: "FSPEC-001" },
      ]);
      expect(daemon.sent("moveWorkUnitUp")).toEqual([{ method: "moveWorkUnitUp", workspace: "/app", id: "APP-001" }]);
      expect(daemon.sent("moveWorkUnitDown")).toEqual([{ method: "moveWorkUnitDown", workspace: "/app", id: "APP-001" }]);
      // @step And the details answer ready and both moves answer ok
      expect(details).toEqual({ state: "ready", id: "APP-001", workUnit: { id: "APP-001" } });
      expect(start).toEqual({ state: "ready", id: "FSPEC-001", workUnit: { id: "FSPEC-001" } });
      expect([up, down]).toEqual([{ ok: true }, { ok: true }]);
    });
  });

  describe("Scenario: Card details and move requests match the daemon's encoding", () => {
    it("encodes (workspace, id) and decodes the move reply", () => {
      // @step Given the Rust golden vectors for the arguments ("/w/b", "AUTH-001") and for move_work_unit_up answering Ok(())
      const args = golden("work_unit_details_args");
      const ok = golden("move_work_unit_ok");
      // @step When the codec encodes get_work_unit_details, move_work_unit_up and move_work_unit_down for workspace "/w/b" and card "AUTH-001" and decodes the reply
      const requests = (["getWorkUnitDetails", "moveWorkUnitUp", "moveWorkUnitDown"] as const).map((method) =>
        Buffer.from(wire.encodeRequestFrame({ id: 0, message: { method, workspace: "/w/b", id: "AUTH-001" } })).toString("hex"),
      );
      const replied = wire.decodeResponseFrame(
        new Uint8Array(Buffer.from("0000000000000000" + "00000000" + index(18) + ok, "hex")),
      );
      // @step Then each request's argument bytes equal the golden vector after variant indices 123, 18 and 19
      expect(requests.map((hex, i) => hex.endsWith(index([123, 18, 19][i]!) + args))).toEqual([true, true, true]);
      // @step And the reply decodes to an ok result
      expect(replied).toMatchObject({ ok: true, method: "moveWorkUnitUp", result: { ok: true } });
    });
  });

  describe("Scenario: A workspace list the daemon cannot give is an error", () => {
    it("fails the board and the open with list_workspaces' reason", async () => {
      // @step Given list_workspaces answers "workspace registry unavailable: locked"
      const { daemon, feed } = setup();
      const refusal = { ok: false, error: "workspace registry unavailable: locked" };
      daemon.handlers.listWorkspaces = () => refusal;
      const h = await harness();
      h.daemon.handlers.listWorkspaces = () => refusal;
      // @step When the panel watches the board of "/ws" and Paseo opens an fspec agent in "/ws"
      const board = await feed.watch({ cwd: "/ws", sinceRevision: null });
      await h.connection.send({
        type: "session.open",
        requestId: "o-1",
        sessionId: "paseo-1",
        config: { cwd: "/work", env: {}, mcpServers: {}, settings: {}, persist: true },
        history: "skip",
      });
      const failed = await h.waitFor("request.failed", (event) => event.requestId === "o-1");
      // @step Then the watch answers unavailable with "fspec daemon list_workspaces failed: workspace registry unavailable: locked"
      const reason = "fspec daemon list_workspaces failed: workspace registry unavailable: locked";
      expect(board).toMatchObject({ state: "unavailable", reason });
      // @step And the open fails with the same reason and get_workspace_info was never called
      expect(failed.error.message).toBe(reason);
      expect(daemon.sent("getWorkspaceInfo")).toEqual([]);
      expect(h.daemon.sent("getWorkspaceInfo")).toEqual([]);
    });
  });

  describe("Scenario: A session of unknown project shows on no board", () => {
    it("leaves an unknown session's focus off every board", async () => {
      // @step Given the panel watches the board of "/ws"
      const { daemon, feed } = setup();
      const first = await feed.watch({ cwd: "/ws", sinceRevision: null });
      // @step When the daemon reports session "s-x", never listed in a snapshot or Created event, focused on "FSPEC-001"
      daemon.pushEnvelope({
        kind: "sessionEvent",
        event: { type: "focusChanged", sessionId: "s-x", focus: { revision: 1, context: { id: "FSPEC-001", title: "x", status: "backlog" }, source: "tui" } },
      });
      await pause();
      // @step Then the board of "/ws" shows no focus for "FSPEC-001"
      const board = await feed.watch({ cwd: "/ws", sinceRevision: null });
      expect(first.state === "ready" && first.focus).toEqual({});
      expect(board.state === "ready" && board.focus).toEqual({});
    });
  });
});

const GOLDEN = new Map(
  readFileSync(fileURLToPath(new URL("./golden/golden-vectors.txt", import.meta.url)), "utf8")
    .trim()
    .split("\n")
    .map((line) => line.split(" ") as [string, string]),
);

function golden(name: string): string {
  const hex = GOLDEN.get(name);
  if (hex === undefined) throw new Error(`missing golden vector ${name}`);
  return hex;
}

function index(n: number): string {
  return Buffer.from(new Uint32Array([n]).buffer).toString("hex");
}
