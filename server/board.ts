import type {
  BoardDetailsInput,
  BoardDetailsOutput,
  BoardMoveInput,
  BoardMoveOutput,
  BoardWatchInput,
  BoardWatchOutput,
} from "../shared/board.js";
import {
  createFspecDaemonClient,
  type DaemonClientOptions,
  type DaemonConnection,
  type FspecDaemonClient,
} from "./daemon.js";
import type {
  DecodedResponse,
  Envelope,
  FspecServiceRequest,
  WorkUnitFocus,
  WorkUnitInfo,
  WorkspaceEntry,
} from "./wire.js";
import { servingWorkspace } from "./workspaces.js";

/**
 * How long a watch with a current revision is held. Paseo times plugin RPCs
 * out after 30 s (server/plugins/runtime.ts REQUEST_TIMEOUT_MS), so stay well
 * under it and let the panel re-issue the watch.
 */
export const BOARD_HOLD_MS = 20_000;

export interface BoardFeed {
  watch(input: BoardWatchInput): Promise<BoardWatchOutput>;
  /** One work unit's complete record from get_work_unit_details (FSPEC-036). */
  details(input: BoardDetailsInput): Promise<BoardDetailsOutput>;
  /** Moves a card one position within its column (FSPEC-037). */
  move(input: BoardMoveInput): Promise<BoardMoveOutput>;
  /** Whether a workspace the daemon serves holds `cwd`; false when it is unreachable (FSPEC-040, FSPEC-053). */
  available(input: { cwd: string }): Promise<{ available: boolean }>;
  close(): Promise<void>;
}

interface Live {
  connection: DaemonConnection;
  /** The daemon's start workspace: the board the connect-time frames seed. */
  start: string;
}

/** One served workspace's board at one revision. */
interface WorkspaceBoard {
  units: WorkUnitInfo[];
  revision: string;
}

/** A held watch: woken by a change to its workspace, or by any change when it has none. */
interface Waiter {
  workspace: string | null;
  wake(): void;
}

/**
 * The live fspec boards for Paseo plugin UI (FSPEC-034), one per workspace
 * the daemon serves (FSPEC-053). One daemon client of its own, opened on the
 * first watch. The start workspace's board is seeded from the connect-time
 * frames and kept current by WorkUnitsUpdate pushes; any other served
 * workspace's board is read with list_workspace_work_units on its first watch
 * and kept current by WorkspaceWorkUnitsUpdate pushes tagged with its path.
 * Paseo has no server-to-UI push, so the panel long-polls `watch`.
 */
export function createBoardFeed(options: DaemonClientOptions = {}): BoardFeed {
  const epoch = Date.now().toString(36);
  let counter = 0;
  const nextRevision = () => `${epoch}:${++counter}`;
  /** The revision of answers no single board owns: unavailable and refused. */
  let revision = `${epoch}:${counter}`;
  let closed = false;
  let daemon: FspecDaemonClient | null = null;
  let live: Promise<Live> | null = null;
  let start: string | null = null;
  /** Served workspace path -> its board; only workspaces a panel has watched. */
  const boards = new Map<string, WorkspaceBoard>();
  const loading = new Map<string, Promise<void>>();
  /** The daemon's workspaces as last listed, start first. */
  let served: WorkspaceEntry[] = [];
  /** fspec session id -> the work unit it is focused on. */
  const focus = new Map<string, string>();
  /** fspec session id -> its project (SessionInfo.project), so focus stays in its workspace. */
  const projects = new Map<string, string>();
  /** Set while the board cannot be served; cleared by a successful connect. */
  let unavailable: string | null = null;
  let subscribed = false;
  const waiters = new Set<Waiter>();

  /** A change to one workspace's board, or to every board when `workspace` is null. */
  function changed(workspace: string | null = null): void {
    if (workspace === null) {
      revision = nextRevision();
      for (const board of boards.values()) board.revision = nextRevision();
    } else {
      const board = boards.get(workspace);
      if (board === undefined) return;
      board.revision = nextRevision();
    }
    for (const waiter of [...waiters]) {
      if (workspace === null || waiter.workspace === null || waiter.workspace === workspace) waiter.wake();
    }
  }

  function markUnavailable(reason: string): void {
    if (unavailable === reason) return;
    unavailable = reason;
    changed();
  }

  function setFocus(sessionId: string, value: WorkUnitFocus | null): boolean {
    const next = value?.context?.id ?? null;
    if ((focus.get(sessionId) ?? null) === next) return false;
    if (next === null) focus.delete(sessionId);
    else focus.set(sessionId, next);
    return true;
  }

  function setUnits(workspace: string, units: WorkUnitInfo[]): void {
    const board = boards.get(workspace);
    if (board === undefined || JSON.stringify(units) === JSON.stringify(board.units)) return;
    board.units = units;
    changed(workspace);
  }

  function onEnvelope(envelope: Envelope): void {
    if (envelope.kind === "workUnitsUpdate") {
      if (start !== null) setUnits(start, envelope.workUnits);
      return;
    }
    if (envelope.kind === "workspaceWorkUnitsUpdate") {
      // Only boards a panel loaded follow pushes; the start workspace never arrives here.
      setUnits(envelope.workspace, envelope.units);
      return;
    }
    if (envelope.kind !== "sessionEvent") return;
    const event = envelope.event;
    let moved = false;
    if (event.type === "focusChanged") moved = setFocus(event.sessionId, event.focus);
    else if (event.type === "created") {
      projects.set(event.session.id, event.session.project);
      moved = setFocus(event.session.id, event.session.workUnitFocus);
    } else if (event.type === "removed") {
      projects.delete(event.sessionId);
      moved = focus.delete(event.sessionId);
    }
    if (moved) changed();
  }

  async function call<M extends FspecServiceRequest["method"]>(
    connection: DaemonConnection,
    message: Extract<FspecServiceRequest, { method: M }>,
  ): Promise<Extract<DecodedResponse, { ok: true; method: M }>> {
    const response = await connection.request(message);
    if (!response.ok) throw new Error(`fspec daemon ${message.method} failed: ${response.error}`);
    return response as Extract<DecodedResponse, { ok: true; method: M }>;
  }

  function client(): FspecDaemonClient {
    if (daemon !== null) return daemon;
    const created = createFspecDaemonClient(options);
    created.onEvent((event) => {
      if (event.type !== "connection-lost") return;
      live = null;
      start = null;
      boards.clear();
      loading.clear();
      focus.clear();
      projects.clear();
      markUnavailable(`fspec daemon connection was lost: ${event.reason}`);
    });
    daemon = created;
    return created;
  }

  /** The daemon's workspaces, start first; a daemon that cannot list them serves its start workspace. */
  async function workspaces(connection: DaemonConnection): Promise<WorkspaceEntry[]> {
    const { result } = await call(connection, { method: "listWorkspaces" });
    if (result.ok && result.value.length > 0) served = result.value;
    else {
      const { workspace } = await call(connection, { method: "getWorkspaceInfo" });
      served = [{ path: workspace.cwd, name: workspace.cwd, start: true }];
    }
    return served;
  }

  /**
   * Connects and seeds the start workspace's board from the connect-time
   * WorkUnitsUpdate and SessionSnapshot, then keeps current through the
   * envelope listener.
   */
  async function connect(): Promise<Live> {
    const connection = await client().connect();
    if (!subscribed) {
      // Envelope listeners outlive reconnects, so subscribe exactly once.
      subscribed = true;
      connection.onEnvelope(onEnvelope);
    }
    const listed = await workspaces(connection);
    const startPath = (listed.find((entry) => entry.start) ?? listed[0]!).path;
    boards.clear();
    loading.clear();
    focus.clear();
    projects.clear();
    start = startPath;
    boards.set(startPath, { units: connection.initial.workUnits, revision });
    for (const session of connection.initial.sessions) {
      projects.set(session.id, session.project);
      setFocus(session.id, session.workUnitFocus);
    }
    unavailable = null;
    changed();
    return { connection, start: startPath };
  }

  /** The connected daemon, (re)connecting after a loss; one attempt at a time. */
  function ensureLive(): Promise<Live> {
    if (live !== null) return live;
    const attempt = connect();
    live = attempt;
    attempt.catch(() => {
      if (live === attempt) live = null;
    });
    return attempt;
  }

  /** Reads a served workspace's board the first time a panel watches it. */
  async function load(current: Live, workspace: string): Promise<void> {
    if (boards.has(workspace)) return;
    let pending = loading.get(workspace);
    if (pending === undefined) {
      pending = (async () => {
        const { result } = await call(current.connection, { method: "listWorkspaceWorkUnits", workspace });
        if (!result.ok) throw new Error(result.error);
        if (!boards.has(workspace)) boards.set(workspace, { units: result.value, revision: nextRevision() });
      })().finally(() => loading.delete(workspace));
      loading.set(workspace, pending);
    }
    await pending;
  }

  /** The served workspace a session belongs to; an unknown project is the start workspace's. */
  function workspaceOf(sessionId: string): string | null {
    const project = projects.get(sessionId);
    if (project === undefined) return start;
    return servingWorkspace(served, project)?.path ?? null;
  }

  function board(workspace: string): BoardWatchOutput {
    const current = boards.get(workspace);
    if (unavailable !== null || current === undefined) {
      return { state: "unavailable", revision, reason: unavailable ?? "the fspec board is reconnecting" };
    }
    const byUnit: Record<string, string[]> = {};
    for (const [sessionId, unitId] of focus) {
      if (workspaceOf(sessionId) === workspace) (byUnit[unitId] ??= []).push(sessionId);
    }
    return { state: "ready", revision: current.revision, workspace, units: current.units, focus: byUnit };
  }

  function hold(workspace: string | null): Promise<void> {
    return new Promise((resolve) => {
      const waiter: Waiter = {
        workspace,
        wake: () => {
          clearTimeout(timer);
          waiters.delete(waiter);
          resolve();
        },
      };
      const timer = setTimeout(waiter.wake, BOARD_HOLD_MS);
      waiters.add(waiter);
    });
  }

  function refusal(entries: readonly WorkspaceEntry[], cwd: string): string {
    const paths = entries.map((entry) => entry.path).join(", ");
    return `the fspec daemon serves ${paths}, not ${cwd} — start fspec in ${cwd} to use it there`;
  }

  /** get_work_unit_details and move_work_unit_* act on the daemon's cwd only. */
  function startOnly(startPath: string): string {
    return `card details and moves are only available in the fspec daemon's start workspace (${startPath})`;
  }

  /**
   * The served workspace holding cwd, or the refusal to answer with. The
   * list is re-read only when the last one holds no workspace for cwd, so a
   * workspace the daemon opened since (e.g. for a new agent) is found.
   */
  async function resolve(cwd: string): Promise<{ current: Live; entry: WorkspaceEntry } | { refused: string }> {
    const current = await ensureLive();
    const entry = servingWorkspace(served, cwd) ?? servingWorkspace(await workspaces(current.connection), cwd);
    return entry === null ? { refused: refusal(served, cwd) } : { current, entry };
  }

  return {
    async watch({ cwd, sinceRevision }) {
      if (closed) return { state: "unavailable", revision, reason: "the fspec plugin was unloaded" };
      let workspace: string;
      try {
        const found = await resolve(cwd);
        if ("refused" in found) {
          // A panel that already has this refusal waits like any other watch.
          if (sinceRevision === revision) await hold(null);
          return { state: "unavailable", revision, reason: found.refused };
        }
        workspace = found.entry.path;
        // A connection lost meanwhile is the answer; loading would only fail on it.
        if (unavailable === null) await load(found.current, workspace);
      } catch (error) {
        markUnavailable(error instanceof Error ? error.message : String(error));
        // A daemon that is still down is retried once per hold, not in a tight loop.
        if (sinceRevision === revision) await hold(null);
        return { state: "unavailable", revision, reason: unavailable ?? "fspec daemon unavailable" };
      }
      if (sinceRevision === boards.get(workspace)?.revision && !closed) await hold(workspace);
      return closed ? { state: "unavailable", revision, reason: "the fspec plugin was unloaded" } : board(workspace);
    },
    async details({ cwd, id }) {
      if (closed) return { state: "unavailable", reason: "the fspec plugin was unloaded" };
      try {
        const found = await resolve(cwd);
        if ("refused" in found) return { state: "unavailable", reason: found.refused };
        if (!found.entry.start) return { state: "unavailable", reason: startOnly(found.current.start) };
        const { result } = await call(found.current.connection, { method: "getWorkUnitDetails", id });
        if (!result.ok) return { state: "unavailable", reason: result.error };
        const envelope = JSON.parse(result.value) as { workUnit?: unknown };
        const record = envelope.workUnit;
        if (typeof record !== "object" || record === null || Array.isArray(record)) {
          return { state: "unavailable", reason: "invalid details envelope: workUnit is not an object" };
        }
        return { state: "ready", id, workUnit: record as Record<string, unknown> };
      } catch (error) {
        return { state: "unavailable", reason: error instanceof Error ? error.message : String(error) };
      }
    },
    async move({ cwd, id, direction }) {
      if (closed) return { ok: false, error: "the fspec plugin was unloaded" };
      try {
        const found = await resolve(cwd);
        if ("refused" in found) return { ok: false, error: found.refused };
        if (!found.entry.start) return { ok: false, error: startOnly(found.current.start) };
        const method = direction === "up" ? "moveWorkUnitUp" : "moveWorkUnitDown";
        const { result } = await call(found.current.connection, { method, id });
        // The new order arrives as the daemon's next WorkUnitsUpdate.
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async available({ cwd }) {
      if (closed) return { available: false };
      try {
        return { available: !("refused" in (await resolve(cwd))) };
      } catch {
        return { available: false };
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const waiter of [...waiters]) waiter.wake();
      await daemon?.close();
    },
  };
}
