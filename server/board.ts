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
import { within } from "./session.js";
import type {
  DecodedResponse,
  Envelope,
  FspecServiceRequest,
  WorkUnitFocus,
  WorkUnitInfo,
} from "./wire.js";

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
  /** Whether the daemon serves `cwd`; false when it is unreachable (FSPEC-040). */
  available(input: { cwd: string }): Promise<{ available: boolean }>;
  close(): Promise<void>;
}

interface Live {
  connection: DaemonConnection;
  workspace: string;
}

/**
 * The live fspec board for Paseo plugin UI (FSPEC-034). One daemon client of
 * its own, opened on the first watch: seeded from the connect-time frames,
 * then kept current by the daemon's WorkUnitsUpdate pushes and session events.
 * Paseo has no server-to-UI push, so the panel long-polls `watch`.
 */
export function createBoardFeed(options: DaemonClientOptions = {}): BoardFeed {
  const epoch = Date.now().toString(36);
  let counter = 0;
  let revision = `${epoch}:${counter}`;
  let closed = false;
  let daemon: FspecDaemonClient | null = null;
  let live: Promise<Live> | null = null;
  let units: WorkUnitInfo[] = [];
  /** fspec session id -> the work unit it is focused on. */
  const focus = new Map<string, string>();
  /** Set while the board cannot be served; cleared by a successful connect. */
  let unavailable: string | null = null;
  let subscribed = false;
  const waiters = new Set<() => void>();

  function changed(): void {
    counter += 1;
    revision = `${epoch}:${counter}`;
    for (const wake of [...waiters]) wake();
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

  function onEnvelope(envelope: Envelope): void {
    if (envelope.kind === "workUnitsUpdate") {
      if (JSON.stringify(envelope.workUnits) === JSON.stringify(units)) return;
      units = envelope.workUnits;
      changed();
      return;
    }
    if (envelope.kind !== "sessionEvent") return;
    const event = envelope.event;
    let moved = false;
    if (event.type === "focusChanged") moved = setFocus(event.sessionId, event.focus);
    else if (event.type === "created") moved = setFocus(event.session.id, event.session.workUnitFocus);
    else if (event.type === "removed") moved = focus.delete(event.sessionId);
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
      focus.clear();
      markUnavailable(`fspec daemon connection was lost: ${event.reason}`);
    });
    daemon = created;
    return created;
  }

  /**
   * Connects and seeds from the connect-time WorkUnitsUpdate and
   * SessionSnapshot, then keeps current through the envelope listener.
   */
  async function connect(): Promise<Live> {
    const connection = await client().connect();
    if (!subscribed) {
      // Envelope listeners outlive reconnects, so subscribe exactly once.
      subscribed = true;
      connection.onEnvelope(onEnvelope);
    }
    units = connection.initial.workUnits;
    focus.clear();
    for (const session of connection.initial.sessions) setFocus(session.id, session.workUnitFocus);
    const { workspace } = await call(connection, { method: "getWorkspaceInfo" });
    unavailable = null;
    changed();
    return { connection, workspace: workspace.cwd };
  }

  /** The connected workspace, (re)connecting after a loss; one attempt at a time. */
  function ensureLive(): Promise<Live> {
    if (live !== null) return live;
    const attempt = connect();
    live = attempt;
    attempt.catch(() => {
      if (live === attempt) live = null;
    });
    return attempt;
  }

  function board(workspace: string): BoardWatchOutput {
    if (unavailable !== null) return { state: "unavailable", revision, reason: unavailable };
    const byUnit: Record<string, string[]> = {};
    for (const [sessionId, unitId] of focus) (byUnit[unitId] ??= []).push(sessionId);
    return { state: "ready", revision, workspace, units, focus: byUnit };
  }

  function hold(): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, BOARD_HOLD_MS);
      waiters.add(done);
    });
  }

  function refusal(workspace: string, cwd: string): string {
    return `the fspec daemon serves ${workspace}, not ${cwd} — start fspec in ${cwd} to use it there`;
  }

  return {
    async watch({ cwd, sinceRevision }) {
      if (closed) return { state: "unavailable", revision, reason: "the fspec plugin was unloaded" };
      let current: Live;
      try {
        current = await ensureLive();
        if (!within(current.workspace, cwd)) {
          // A panel that already has this refusal waits like any other watch.
          if (sinceRevision === revision) await hold();
          return {
            state: "unavailable",
            revision,
            reason: refusal(current.workspace, cwd),
          };
        }
      } catch (error) {
        markUnavailable(error instanceof Error ? error.message : String(error));
        // A daemon that is still down is retried once per hold, not in a tight loop.
        if (sinceRevision === revision) await hold();
        return board("");
      }
      if (sinceRevision === revision && !closed) await hold();
      return closed
        ? { state: "unavailable", revision, reason: "the fspec plugin was unloaded" }
        : board(current.workspace);
    },
    async details({ cwd, id }) {
      if (closed) return { state: "unavailable", reason: "the fspec plugin was unloaded" };
      try {
        const current = await ensureLive();
        if (!within(current.workspace, cwd)) {
          return { state: "unavailable", reason: refusal(current.workspace, cwd) };
        }
        const { result } = await call(current.connection, { method: "getWorkUnitDetails", id });
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
        const current = await ensureLive();
        if (!within(current.workspace, cwd)) return { ok: false, error: refusal(current.workspace, cwd) };
        const method = direction === "up" ? "moveWorkUnitUp" : "moveWorkUnitDown";
        const { result } = await call(current.connection, { method, id });
        // The new order arrives as the daemon's next WorkUnitsUpdate.
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async available({ cwd }) {
      if (closed) return { available: false };
      try {
        const current = await ensureLive();
        return { available: within(current.workspace, cwd) };
      } catch {
        return { available: false };
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const wake of [...waiters]) wake();
      await daemon?.close();
    },
  };
}
