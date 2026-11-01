/**
 * A fake fspec daemon for provider tests: a WebSocket transport (injected via
 * the FSPEC-003 client's `openSocket`) that completes the handshake, decodes
 * every tarpc request frame with the FSPEC-002 codec, answers it from a
 * per-method handler, and can push server-side stream chunks.
 *
 * Every byte crossing the fake socket is real wire format, so the provider is
 * exercised end-to-end through server/daemon.ts and server/wire.ts.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as wire from "../../server/wire.js";
import type { DaemonClientOptions, SocketLike } from "../../server/daemon.js";

type Listener = (event: { data?: unknown; code?: number }) => void;

export type Handler = (request: wire.FspecServiceRequest) => unknown | Promise<unknown>;

export class FakeSocket implements SocketLike {
  readyState = 0;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(private readonly onFrame: (socket: FakeSocket, bytes: Uint8Array) => void) {}

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, event: Parameters<Listener>[0] = {}): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
  send(data: Uint8Array): void {
    this.onFrame(this, data);
  }
  close(code?: number): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close", { code: code ?? 1005 });
  }
  serverFrame(envelope: wire.Envelope): void {
    const bytes = wire.encodeEnvelope(envelope);
    this.emit("message", {
      data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
  }
}

export class FakeDaemon {
  /** Every request the provider sent, in order. */
  readonly requests: wire.FspecServiceRequest[] = [];
  /** The tarpc deadline each request carried, in the same order as `requests`. */
  readonly deadlines: number[] = [];
  readonly sockets: FakeSocket[] = [];
  readonly handlers: Partial<Record<wire.FspecMethodName, Handler>> = {};
  /** The connect-time WorkUnitsUpdate and SessionSnapshot each new socket receives. */
  initialWorkUnits: wire.WorkUnitInfo[] = [];
  initialSessions: wire.SessionInfo[] = [];
  private nextSession = 42;

  constructor() {
    this.handlers.createSession = () => `fspec-sess-${this.nextSession++}`;
    this.handlers.createSessionChecked = () => ({ ok: true, value: `fspec-sess-${this.nextSession++}` });
    this.handlers.setSessionModel = () => ({ ok: true, value: undefined });
    this.handlers.setThinkingLevel = () => ({ ok: true, value: undefined });
    this.handlers.destroySession = () => ({ ok: true, value: undefined });
    this.handlers.resumeSession = () => ({ ok: true, value: undefined });
    // The harness opens sessions in /work, so that is the daemon's workspace.
    this.handlers.getWorkspaceInfo = () => ({ cwd: "/work", gitBranch: null });
    this.handlers.getPauseState = () => null;
    this.handlers.pauseConfirm = () => ({ ok: true, value: undefined });
    this.handlers.pauseTriple = () => ({ ok: true, value: undefined });
    this.handlers.getHitlRequest = () => null;
    this.handlers.sendHitlResponse = () => ({ ok: true, value: undefined });
    this.handlers.getInteractionSnapshot = () => interactionSnapshot({});
    this.handlers.replyInteractionChecked = () => ({ ok: true, value: undefined });
    this.handlers.writeExecStdin = () => ({ ok: true, value: undefined });
    this.handlers.getSupervisors = () => [];
    this.handlers.getSubordinates = () => [];
    this.handlers.persistenceSearchHistory = () => ({ ok: true, value: [] });
    this.handlers.setActiveSession = () => undefined;
    this.handlers.clearActiveSession = () => undefined;
    this.handlers.getActiveSession = () => null;
    this.handlers.listSessions = () => [];
    this.handlers.compactSession = () => ({
      ok: true,
      value: { originalTokens: 90000, compactedTokens: 30000, compressionRatio: 66.7, turnsSummarized: 4, turnsKept: 2 },
    });
    this.handlers.clearHistory = () => ({ ok: true, value: undefined });
    this.handlers.getContinueState = () => ({ enabled: false, budget: 10 });
    this.handlers.setContinueState = () => ({ ok: true, value: undefined });
    this.handlers.getGoalState = () => null;
    this.handlers.setGoalState = () => ({ ok: true, value: undefined });
    this.handlers.listCheckpoints = () => [];
    this.handlers.getSessionStatus = () => "idle";
    this.handlers.getPendingInput = () => null;
    this.handlers.getWorkUnitFocus = () => ({ ok: true, value: { revision: 0, context: null, source: "none" } });
    this.handlers.restoreCheckpointAll = () => ({ ok: true, value: undefined });
    this.handlers.setWorkUnitFocus = () => ({ ok: true, value: { revision: 1, context: null, source: "paseo" } });
    this.handlers.listProviders = () => [];
    this.handlers.listProviderSettings = () => ({ ok: true, value: [] });
    this.handlers.getDefaultModel = () => null;
    this.handlers.submitInput = () => ({ ok: true, value: undefined });
    // One workspace, the start workspace get_workspace_info reports.
    this.handlers.listWorkspaces = async (request) => {
      const info = (await this.handlers.getWorkspaceInfo!(request)) as wire.WorkspaceInfo;
      return { ok: true, value: [{ path: info.cwd, name: info.cwd.split("/").at(-1) ?? info.cwd, start: true }] };
    };
    this.handlers.createSessionInWorkspace = () => ({ ok: true, value: `fspec-sess-${this.nextSession++}` });
    this.handlers.listWorkspaceWorkUnits = () => ({ ok: true, value: [] });
    this.handlers.setDefaultModel = () => ({ ok: true, value: undefined });
  }

  readonly openSocket = (_url: string): SocketLike => {
    const socket = new FakeSocket((sock, bytes) => this.handleFrame(sock, bytes));
    this.sockets.push(socket);
    queueMicrotask(() => {
      socket.readyState = 1;
      socket.emit("open");
      socket.serverFrame({ kind: "workUnitsUpdate", workUnits: this.initialWorkUnits });
      socket.serverFrame({ kind: "sessionSnapshot", sessions: this.initialSessions });
    });
    return socket;
  };

  /** Requests of one method, in order. */
  sent<M extends wire.FspecServiceRequest["method"]>(
    method: M,
  ): Extract<wire.FspecServiceRequest, { method: M }>[] {
    return this.requests.filter(
      (request): request is Extract<wire.FspecServiceRequest, { method: M }> =>
        request.method === method,
    );
  }

  /** Pushes any server-side envelope (e.g. a session event). */
  pushEnvelope(envelope: wire.Envelope): void {
    for (const socket of this.sockets) {
      if (socket.readyState === 1) socket.serverFrame(envelope);
    }
  }

  /** Pushes one server-side stream chunk for a daemon session. */
  push(sessionId: string, chunk: wire.StreamChunk): void {
    for (const socket of this.sockets) {
      if (socket.readyState === 1) socket.serverFrame({ kind: "event", sessionId, chunk });
    }
  }

  private handleFrame(socket: FakeSocket, bytes: Uint8Array): void {
    const envelope = wire.decodeEnvelope(bytes);
    if (envelope.kind !== "rpc") return;
    const frame = wire.decodeRequestFrame(envelope.frame);
    this.requests.push(frame.message);
    this.deadlines.push(frame.context.deadlineMs);
    const handler = this.handlers[frame.message.method];
    void Promise.resolve()
      .then(() => (handler ? handler(frame.message) : undefined))
      .then(
        (value) =>
          wire.encodeResponseFrame({
            requestId: frame.id,
            message: frame.message.method,
            value,
          }),
        (error: unknown) =>
          wire.encodeResponseFrame({
            requestId: frame.id,
            message: frame.message.method,
            error: (error as Error).message,
          }),
      )
      .then((response) => {
        if (socket.readyState === 1) socket.serverFrame({ kind: "rpc", frame: response });
      });
  }
}

/** A temporary home directory, optionally holding a live daemon.json. */
export function tempHome(): { homeDir: string; daemonJsonPath: string; writeDaemonJson(): void; dispose(): void } {
  const homeDir = mkdtempSync(join(tmpdir(), "fspec-provider-"));
  const daemonJsonPath = join(homeDir, ".fspec", "daemon.json");
  return {
    homeDir,
    daemonJsonPath,
    writeDaemonJson() {
      mkdirSync(join(homeDir, ".fspec"), { recursive: true });
      writeFileSync(daemonJsonPath, JSON.stringify({ port: 47100, pid: 4242 }));
    },
    dispose() {
      rmSync(homeDir, { recursive: true, force: true });
    },
  };
}

/** Daemon-client options wiring a provider to a fake daemon in a temp home. */
export function daemonOptions(home: { homeDir: string }, daemon: FakeDaemon): DaemonClientOptions {
  return {
    env: {},
    homeDir: home.homeDir,
    isPidAlive: () => true,
    openSocket: daemon.openSocket,
  };
}

/**
 * Serves serde-JSON transcript entries the way the daemon journal does: each
 * entry is split into fragments of at most `size` bytes, one per page.
 */
export function transcriptPages(entries: string[], size = 16) {
  const generation = "gen-1";
  const snapshotEnd = entries.length;
  return (request: wire.FspecServiceRequest) => {
    if (request.method !== "getTranscriptPage") throw new Error("unexpected request");
    const sequence = request.cursor?.sequence ?? 0;
    const byteOffset = request.cursor?.byteOffset ?? 0;
    const entry = entries[sequence]!;
    const end = Math.min(entry.length, byteOffset + size);
    const finished = end === entry.length;
    const next = finished
      ? { generation, sequence: sequence + 1, byteOffset: 0 }
      : { generation, sequence, byteOffset: end };
    const page: wire.TranscriptPage = {
      generation,
      snapshotEnd,
      fragment: {
        sequence,
        byteOffset,
        totalBytes: entry.length,
        jsonFragment: entry.slice(byteOffset, end),
        original: {
          turnIndex: 0,
          messageId: `m-${sequence}`,
          timestamp: `2026-10-30T00:00:0${sequence}Z`,
          chunkIndex: 0,
        },
      },
      nextCursor: next,
      complete: next.sequence === snapshotEnd,
    };
    return { ok: true, value: page };
  };
}

export interface SnapshotPause {
  requestId: string;
  kind: "Triple" | "Confirm" | "Continue";
  toolName: string;
  message: string;
  details?: string | null;
}
export interface SnapshotHitl {
  requestId: string;
  questions: Array<{ id: string; header: string; question: string; options: Array<{ label: string; description: string }> | null }>;
}

/** A get_interaction_snapshot reply in the daemon's JSON shape. */
export function interactionSnapshot(parts: { pause?: SnapshotPause; hitl?: SnapshotHitl }) {
  return {
    ok: true,
    value: JSON.stringify({
      pause: {
        request_id: parts.pause?.requestId ?? "",
        state: parts.pause
          ? {
              kind: parts.pause.kind,
              tool_name: parts.pause.toolName,
              message: parts.pause.message,
              details: parts.pause.details ?? null,
            }
          : null,
      },
      hitl: {
        request_id: parts.hitl?.requestId ?? "",
        state: parts.hitl ? { questions: parts.hitl.questions } : null,
      },
    }),
  };
}
