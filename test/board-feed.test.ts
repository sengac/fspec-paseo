/**
 * Feature: spec/features/fspec-board-feed.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBoardFeed, type BoardFeed } from "../server/board.js";
import type { BoardWatchOutput } from "../shared/board.js";
import type * as wire from "../server/wire.js";
import * as wireCodec from "../server/wire.js";
import { FakeDaemon, daemonOptions, tempHome } from "./support/fake-daemon.js";

const disposers: Array<() => unknown> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const dispose of disposers.splice(0)) await dispose();
});

function unit(id: string, status: string, estimate: number | null = null): wire.WorkUnitInfo {
  return {
    id,
    title: `${id} title`,
    workType: "story",
    status,
    description: null,
    estimate,
    epic: null,
    attachments: [],
    lastStateChangeAt: null,
  };
}

function liveSession(id: string, workUnitId: string | null): wire.SessionInfo {
  return {
    id,
    name: id,
    status: "idle",
    project: "/ws",
    messageCount: 0,
    providerId: null,
    modelId: null,
    isIsolated: false,
    worktreePath: null,
    role: null,
    updatedAtMs: null,
    workUnitFocus: {
      revision: 1,
      context: workUnitId === null ? null : { id: workUnitId, title: workUnitId, status: "backlog" },
      source: "paseo",
    },
  };
}

function setup(units: wire.WorkUnitInfo[] = [], sessions: wire.SessionInfo[] = []) {
  const home = tempHome();
  home.writeDaemonEntry();
  const daemon = new FakeDaemon();
  daemon.handlers.getWorkspaceInfo = () => ({ cwd: "/ws", gitBranch: null });
  daemon.initialWorkUnits = units;
  daemon.initialSessions = sessions;
  const feed: BoardFeed = createBoardFeed(daemonOptions(home, daemon));
  disposers.push(home.dispose, () => feed.close());
  return { daemon, feed };
}

function ready(board: BoardWatchOutput) {
  if (board.state !== "ready") throw new Error(`board unavailable: ${board.reason}`);
  return board;
}

/** True once the promise has settled, without awaiting it. */
function settled(promise: Promise<unknown>): () => boolean {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true),
  );
  return () => done;
}

describe("Feature: Serve the live fspec board to Paseo plugin UI", () => {
  describe("Scenario: The first watch seeds the board from the daemon", () => {
    it("answers ready from the connect-time frames", async () => {
      // @step Given the fspec daemon serves "/ws" and its connect-time WorkUnitsUpdate holds "FSPEC-001" in backlog with 3 points
      const { daemon, feed } = setup([unit("FSPEC-001", "backlog", 3)]);
      // @step When the panel calls fspec.board.watch with cwd "/ws" and no revision
      const board = ready(await feed.watch({ cwd: "/ws", sinceRevision: null }));
      // @step Then it answers state ready for workspace "/ws" with the unit "FSPEC-001" and an empty focus map
      expect(board.workspace).toBe("/ws");
      expect(board.units).toEqual([unit("FSPEC-001", "backlog", 3)]);
      expect(board.focus).toEqual({});
      expect(daemon.sockets).toHaveLength(1);
      // @step And the revision has the form "<epoch>:<counter>"
      expect(board.revision).toMatch(/^[^:]+:\d+$/);
    });
  });

  describe("Scenario: A held watch answers when the daemon pushes a work-units update", () => {
    it("wakes the held watch with the pushed snapshot", async () => {
      // @step Given a panel holding fspec.board.watch with the current revision
      const { daemon, feed } = setup([unit("FSPEC-001", "backlog", 3)]);
      const first = ready(await feed.watch({ cwd: "/ws", sinceRevision: null }));
      const held = feed.watch({ cwd: "/ws", sinceRevision: first.revision });
      const isSettled = settled(held);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(isSettled()).toBe(false);
      // @step When the daemon pushes a WorkUnitsUpdate moving "FSPEC-001" to specifying
      daemon.pushEnvelope({ kind: "workUnitsUpdate", workUnits: [unit("FSPEC-001", "specifying", 3)] });
      // @step Then the held watch answers with a new revision and "FSPEC-001" in status specifying
      const next = ready(await held);
      expect(next.revision).not.toBe(first.revision);
      expect(next.units).toEqual([unit("FSPEC-001", "specifying", 3)]);
    });
  });

  describe("Scenario: A held watch with no change answers after 20 seconds", () => {
    it("answers the unchanged board when the hold expires", async () => {
      // @step Given a panel holding fspec.board.watch with the current revision
      const { daemon, feed } = setup([unit("FSPEC-001", "backlog", 3)]);
      const first = ready(await feed.watch({ cwd: "/ws", sinceRevision: null }));
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const held = feed.watch({ cwd: "/ws", sinceRevision: first.revision });
      const isSettled = settled(held);
      // An identical snapshot is not a change.
      daemon.pushEnvelope({ kind: "workUnitsUpdate", workUnits: [unit("FSPEC-001", "backlog", 3)] });
      await vi.advanceTimersByTimeAsync(19_999);
      expect(isSettled()).toBe(false);
      // @step When 20 seconds pass without a change
      await vi.advanceTimersByTimeAsync(1);
      // @step Then the watch answers state ready with the same revision and the unchanged board
      const next = ready(await held);
      expect(next.revision).toBe(first.revision);
      expect(next.units).toEqual(first.units);
    });
  });

  describe("Scenario: Focus changes move sessions between work units", () => {
    it("tracks focused sessions per work unit", async () => {
      // @step Given the connect-time SessionSnapshot has session "fspec-sess-1" focused on "FSPEC-001"
      const { daemon, feed } = setup(
        [unit("FSPEC-001", "backlog"), unit("FSPEC-002", "backlog")],
        [liveSession("fspec-sess-1", "FSPEC-001"), liveSession("fspec-sess-2", null)],
      );
      const first = ready(await feed.watch({ cwd: "/ws", sinceRevision: null }));
      expect(first.focus).toEqual({ "FSPEC-001": ["fspec-sess-1"] });
      // @step When the daemon reports focusChanged for "fspec-sess-1" to "FSPEC-002"
      const held = feed.watch({ cwd: "/ws", sinceRevision: first.revision });
      daemon.pushEnvelope({
        kind: "sessionEvent",
        event: {
          type: "focusChanged",
          sessionId: "fspec-sess-1",
          focus: { revision: 2, context: { id: "FSPEC-002", title: "FSPEC-002", status: "backlog" }, source: "paseo" },
        },
      });
      // @step Then the focus map goes from "FSPEC-001" to "FSPEC-002" for "fspec-sess-1" with a new revision
      const moved = ready(await held);
      expect(moved.focus).toEqual({ "FSPEC-002": ["fspec-sess-1"] });
      expect(moved.revision).not.toBe(first.revision);
      // @step And a cleared focus removes "fspec-sess-1" from the focus map
      const cleared = feed.watch({ cwd: "/ws", sinceRevision: moved.revision });
      daemon.pushEnvelope({
        kind: "sessionEvent",
        event: { type: "focusChanged", sessionId: "fspec-sess-1", focus: { revision: 3, context: null, source: "paseo" } },
      });
      expect(ready(await cleared).focus).toEqual({});
    });
  });

  describe("Scenario: The board is refused outside the daemon workspace", () => {
    it("answers unavailable with the workspace guard reason", async () => {
      // @step Given the fspec daemon serves "/ws"
      const { daemon, feed } = setup([unit("FSPEC-001", "backlog")]);
      // @step When the panel calls fspec.board.watch with cwd "/elsewhere"
      const board = await feed.watch({ cwd: "/elsewhere", sinceRevision: null });
      // @step Then it answers state unavailable with reason "the fspec daemon serves /ws, not /elsewhere — start fspec in /elsewhere to use it there"
      expect(board).toMatchObject({
        state: "unavailable",
        reason: "the fspec daemon serves /ws, not /elsewhere — start fspec in /elsewhere to use it there",
      });
      // @step And a repeated watch with that revision is held instead of answered at once
      const repeated = feed.watch({ cwd: "/elsewhere", sinceRevision: board.revision });
      const isSettled = settled(repeated);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(isSettled()).toBe(false);
      daemon.pushEnvelope({ kind: "workUnitsUpdate", workUnits: [unit("FSPEC-001", "testing")] });
      await expect(repeated).resolves.toMatchObject({ state: "unavailable" });
    });
  });

  describe("Scenario: A lost daemon connection makes the board unavailable until the next watch reconnects", () => {
    it("wakes held watches on loss and re-seeds on the next watch", async () => {
      // @step Given a panel holding fspec.board.watch with the current revision
      const { daemon, feed } = setup([unit("FSPEC-001", "backlog")]);
      const first = ready(await feed.watch({ cwd: "/ws", sinceRevision: null }));
      const held = feed.watch({ cwd: "/ws", sinceRevision: first.revision });
      // @step When the daemon socket closes
      daemon.sockets[0]!.close(1006);
      // @step Then the held watch answers state unavailable with a reason starting "fspec daemon connection was lost"
      const lost = await held;
      expect(lost.state).toBe("unavailable");
      if (lost.state === "unavailable") expect(lost.reason).toMatch(/^fspec daemon connection was lost/);
      // @step And the next watch reconnects, re-seeds and answers state ready
      daemon.initialWorkUnits = [unit("FSPEC-001", "testing")];
      const again = ready(await feed.watch({ cwd: "/ws", sinceRevision: lost.revision }));
      expect(again.units).toEqual([unit("FSPEC-001", "testing")]);
      expect(daemon.sockets).toHaveLength(2);
    });
  });

  describe("Scenario: Unloading the plugin closes the board connection", () => {
    it("answers held watches and closes the socket on close()", async () => {
      // @step Given a panel holding fspec.board.watch with the current revision
      const { daemon, feed } = setup([unit("FSPEC-001", "backlog")]);
      const first = ready(await feed.watch({ cwd: "/ws", sinceRevision: null }));
      const held = feed.watch({ cwd: "/ws", sinceRevision: first.revision });
      // @step When the plugin is unloaded
      await feed.close();
      // @step Then the held watch answers and the board daemon socket is closed
      await expect(held).resolves.toBeDefined();
      expect(daemon.sockets[0]!.readyState).toBe(3);
    });
  });
});

describe("Feature: Serve the live fspec board to Paseo plugin UI (codec)", () => {
  describe("Scenario: list_live_sessions decodes bare session ids", () => {
    it("reads Vec<SessionId> as strings", () => {
      // @step Given the daemon answers list_live_sessions with the session ids "fspec-sess-1" and "fspec-sess-2"
      const text = (value: string) => {
        const bytes = new TextEncoder().encode(value);
        return [...u64(bytes.length), ...bytes];
      };
      // Response { request_id: 7, message: Ok(ListLiveSessions(vec![..])) }, bincode 1 little-endian.
      const frame = new Uint8Array([...u64(7), ...u32(0), ...u32(2), ...u64(2), ...text("fspec-sess-1"), ...text("fspec-sess-2")]);
      // @step When the provider decodes the response frame
      const decoded = wireCodec.decodeResponseFrame(frame);
      // @step Then it reads sessionIds "fspec-sess-1" and "fspec-sess-2"
      expect(decoded).toEqual({ requestId: 7, ok: true, method: "listLiveSessions", sessionIds: ["fspec-sess-1", "fspec-sess-2"] });
    });
  });
});

function u32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}
function u64(value: number): number[] {
  return [...u32(value), 0, 0, 0, 0];
}
