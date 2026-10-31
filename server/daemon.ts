/**
 * Feature: spec/features/fspec-daemon-connection.feature
 *
 * The fspec daemon client: target resolution (explicit connect URL wins over
 * daemon.json autodiscovery), loopback-only enforcement before any socket,
 * the WebSocket connect + handshake (WorkUnitsUpdate then SessionSnapshot),
 * request/response RPC over the FSPEC-002 codec, connection-lost handling, and
 * clean idempotent shutdown.
 *
 * No bincode lives here — every byte is produced/consumed by server/wire.ts.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  decodeEnvelope,
  decodeResponseFrame,
  encodeRequestFrame,
  encodeRpcEnvelope,
  type DecodedResponse,
  type Envelope,
  type FspecServiceRequest,
  type SessionInfo,
  type WorkUnitInfo,
} from "./wire.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DaemonClientState =
  | "idle"
  | "connecting"
  | "established"
  | "connection-lost"
  | "closed";

export interface DaemonTarget {
  /** Full WebSocket URL including path `/` (the full surface). */
  url: string;
  host: string;
  port: number;
  /** Present only when the target came from daemon.json autodiscovery. */
  daemonJsonPath?: string;
}

/**
 * Mirrors Paseo's ProviderStatus: an `available: false` result ALWAYS carries a
 * non-empty, user-actionable diagnostic (rule 10).
 */
export type DaemonStatus =
  | { available: true; diagnostic?: string }
  | { available: false; diagnostic: string };

export type DaemonClientEvent =
  | { type: "connection-lost"; reason: string; code?: number }
  | { type: "envelope"; envelope: Envelope };

/** The minimal WebSocket surface the client drives (injectable for tests). */
export interface SocketLike {
  readyState: number;
  addEventListener(
    type: string,
    listener: (event: { data?: unknown; code?: number }) => void,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: { data?: unknown; code?: number }) => void,
  ): void;
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export interface DaemonClientOptions {
  /** Explicit connect URL (provider configuration). Wins over daemon.json. */
  connectUrl?: string;
  /** Environment used for FSPEC_DAEMON_URL / XDG_RUNTIME_DIR lookups. */
  env?: Record<string, string | undefined>;
  /** Override for the home directory used by ~/.fspec/daemon.json. */
  homeDir?: string;
  /** pid liveness probe (kill(pid,0); EPERM counts as alive). */
  isPidAlive?: (pid: number) => boolean;
  /** WebSocket transport factory (default: the Node global WebSocket). */
  openSocket?: (url: string) => SocketLike;
}

export interface DaemonConnection {
  readonly target: DaemonTarget;
  readonly handshake: { workUnitsUpdate: boolean; sessionSnapshot: boolean };
  /**
   * The connect-time WorkUnitsUpdate and SessionSnapshot of the current socket.
   * Both arrive before connect() resolves, so a listener added afterwards
   * never sees them.
   */
  readonly initial: { workUnits: WorkUnitInfo[]; sessions: SessionInfo[] };
  /**
   * Sends one FspecService request and resolves with its decoded response.
   * `deadlineMs` overrides the 10 s tarpc deadline for calls that wait on the
   * user (OAuth sign-in).
   */
  request(message: FspecServiceRequest, options?: { deadlineMs?: number }): Promise<DecodedResponse>;
  /** Subscribes to server-pushed envelopes; returns an unsubscribe function. */
  onEnvelope(listener: (envelope: Envelope) => void): () => void;
}

export interface FspecDaemonClient {
  readonly state: DaemonClientState;
  readonly handshake: { workUnitsUpdate: boolean; sessionSnapshot: boolean };
  /** Daemon session ids currently open through this connection. */
  readonly openSessions: Set<string>;
  readonly outstandingRequests: number;
  readonly activeSockets: number;
  readonly listenerCount: number;
  /** How many times daemon.json was actually read (0 when a URL was explicit). */
  readonly readDaemonJsonCount: number;
  resolveTarget(): Promise<DaemonTarget>;
  status(): Promise<DaemonStatus>;
  connect(): Promise<DaemonConnection>;
  onEvent(listener: (event: DaemonClientEvent) => void): () => void;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Loopback rule (rule 3) — validated before any socket is opened
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function isLoopbackHost(host: string): boolean {
  const bare = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;
  return LOOPBACK_HOSTS.has(bare);
}

function nonLoopbackError(host: string): Error {
  return new Error(
    `non-loopback daemon host "${host}" — the fspec daemon only accepts loopback targets (127.0.0.1, ::1, or localhost); auth/TLS for external binds are out of scope`,
  );
}

// ---------------------------------------------------------------------------
// daemon.json resolution (rules 1, 2) — mirrors common::daemon_json_path
// ---------------------------------------------------------------------------

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the pid exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

interface DaemonJson {
  port: number;
  pid: number;
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export function createFspecDaemonClient(
  options: DaemonClientOptions = {},
): FspecDaemonClient {
  const env = options.env ?? process.env;
  const isPidAlive = options.isPidAlive ?? defaultPidAlive;
  const openSocket = options.openSocket ?? defaultOpenSocket;

  let state: DaemonClientState = "idle";
  let socket: SocketLike | null = null;
  let target: DaemonTarget | null = null;
  let readDaemonJsonCount = 0;
  let closed = false;
  const handshake = { workUnitsUpdate: false, sessionSnapshot: false };
  let initial: { workUnits: WorkUnitInfo[]; sessions: SessionInfo[] } = { workUnits: [], sessions: [] };
  const openSessions = new Set<string>();
  const events = new Set<(event: DaemonClientEvent) => void>();
  const envelopeListeners = new Set<(envelope: Envelope) => void>();
  const outstanding = new Map<
    number,
    { resolve: (r: DecodedResponse) => void; reject: (e: unknown) => void }
  >();
  let nextRequestId = 0;

  // -- discovery ----------------------------------------------------------

  function explicitUrl(): string | undefined {
    const configured = options.connectUrl ?? env["FSPEC_DAEMON_URL"];
    return configured && configured.trim() !== "" ? configured.trim() : undefined;
  }

  /**
   * The single daemon.json path, exactly as the daemon resolves it
   * (common::daemon_json_path): $XDG_RUNTIME_DIR/fspec/daemon.json when
   * XDG_RUNTIME_DIR is set and non-empty, otherwise ~/.fspec/daemon.json.
   */
  function daemonJsonPath(): string {
    const xdg = env["XDG_RUNTIME_DIR"];
    if (xdg && xdg.trim() !== "") return join(xdg, "fspec", "daemon.json");
    return join(options.homeDir ?? homedir(), ".fspec", "daemon.json");
  }

  function readDaemonJson(path: string): DaemonJson | null {
    readDaemonJsonCount += 1;
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const value = parsed as { port?: unknown; pid?: unknown };
    const port = value.port;
    const pid = value.pid;
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
      return null;
    }
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid < 1) {
      return null;
    }
    return { port, pid };
  }

  function resolveFromDaemonJson(): { target?: DaemonTarget; diagnostic?: string } {
    const path = daemonJsonPath();
    if (!existsSync(path)) {
      return { diagnostic: `no daemon.json found at ${path} — start fspec daemon first` };
    }
    const parsed = readDaemonJson(path);
    if (parsed === null) {
      return { diagnostic: `no daemon.json found at ${path} — start fspec daemon first` };
    }
    if (!isPidAlive(parsed.pid)) {
      rmSync(path, { force: true });
      return {
        diagnostic: `no daemon.json found (stale daemon.json removed at ${path}) — start fspec daemon first`,
      };
    }
    // Rule 3: the port discovered via daemon.json is only ever used against a
    // loopback host; the daemon itself binds loopback only.
    const host = "127.0.0.1";
    if (!isLoopbackHost(host)) {
      return { diagnostic: nonLoopbackError(host).message };
    }
    return {
      target: {
        url: `ws://${host}:${parsed.port}/`,
        host,
        port: parsed.port,
        daemonJsonPath: path,
      },
    };
  }

  async function resolveTarget(): Promise<DaemonTarget> {
    const url = explicitUrl();
    if (url !== undefined) {
      // Rule 4: an explicit URL bypasses daemon.json entirely.
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error(`invalid fspec daemon connect URL: ${url}`);
      }
      const host = parsed.hostname;
      if (!isLoopbackHost(host)) throw nonLoopbackError(host);
      const port =
        parsed.port !== "" ? Number(parsed.port) : parsed.protocol === "wss:" ? 443 : 80;
      const resolved: DaemonTarget = {
        url: `ws://${host}:${port}/`,
        host,
        port,
      };
      target = resolved;
      return resolved;
    }
    const found = resolveFromDaemonJson();
    if (found.target === undefined) {
      throw new Error(found.diagnostic ?? "no fspec daemon reachable");
    }
    target = found.target;
    return found.target;
  }

  // -- availability probe (no socket) -------------------------------------

  async function status(): Promise<DaemonStatus> {
    if (closed) return { available: false, diagnostic: "fspec provider connection is closed" };
    try {
      await resolveTarget();
      return { available: true };
    } catch (error) {
      return { available: false, diagnostic: (error as Error).message };
    }
  }

  // -- connect + handshake (rule 6) ---------------------------------------

  function emitEvent(event: DaemonClientEvent): void {
    if (closed) return;
    for (const listener of events) listener(event);
  }

  function settleOutstanding(reason: string): void {
    for (const { reject } of outstanding.values()) {
      reject(new Error(`fspec daemon connection was lost: ${reason}`));
    }
    outstanding.clear();
  }

  function attachSocket(sock: SocketLike, resolved: DaemonTarget): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const onOpen = () => {
        if (settled) return;
        // The handshake is complete only once BOTH initial frames arrived.
        if (handshake.workUnitsUpdate && handshake.sessionSnapshot) {
          settled = true;
          state = "established";
          resolve();
        }
      };
      // Blob frames decode asynchronously; later frames queue behind them so
      // the daemon's frame order is preserved.
      let blobQueue: Promise<void> | null = null;
      const onMessage = (event: { data?: unknown }) => {
        if (event.data instanceof Blob || blobQueue !== null) {
          const data = event.data;
          const queued: Promise<void> = (blobQueue ?? Promise.resolve())
            .then(async () => {
              const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : toBytes(data);
              if (bytes !== null) onFrame(bytes);
            })
            .finally(() => {
              if (blobQueue === queued) blobQueue = null;
            });
          blobQueue = queued;
          return;
        }
        const bytes = toBytes(event.data);
        if (bytes === null) return; // text frames are ignored by the daemon too
        onFrame(bytes);
      };
      const onFrame = (bytes: Uint8Array) => {
        let envelope: Envelope;
        try {
          envelope = decodeEnvelope(bytes);
        } catch {
          return; // a frame we cannot decode never breaks the connection here
        }
        if (envelope.kind === "workUnitsUpdate" && !handshake.workUnitsUpdate) {
          handshake.workUnitsUpdate = true;
          initial = { ...initial, workUnits: envelope.workUnits };
        }
        if (envelope.kind === "sessionSnapshot" && !handshake.sessionSnapshot) {
          handshake.sessionSnapshot = true;
          initial = { ...initial, sessions: envelope.sessions };
        }
        if (envelope.kind === "rpc") {
          try {
            const response = decodeResponseFrame(envelope.frame);
            const pending = outstanding.get(response.requestId);
            if (pending) {
              outstanding.delete(response.requestId);
              pending.resolve(response);
            }
          } catch {
            /* ignore undecodable rpc frames */
          }
        }
        for (const listener of envelopeListeners) listener(envelope);
        onOpen();
      };
      const onError = () => {
        if (!settled) {
          settled = true;
          reject(
            new Error(
              `the connection to the fspec daemon at ${resolved.host}:${resolved.port} could not be established`,
            ),
          );
          return;
        }
        handleDrop("transport error");
      };
      const onClose = (event: { code?: number }) => {
        const code = event.code;
        if (!settled) {
          settled = true;
          reject(
            new Error(
              `the connection to the fspec daemon at ${resolved.host}:${resolved.port} could not be established`,
            ),
          );
          return;
        }
        handleDrop(
          code === 1001 ? "server going away (close 1001)" : `socket closed (code ${code ?? "none"})`,
          code,
        );
      };

      sock.addEventListener("open", onOpen);
      sock.addEventListener("message", onMessage);
      sock.addEventListener("error", onError);
      sock.addEventListener("close", onClose);
      registered.push(
        () => {
          sock.removeEventListener("open", onOpen);
          sock.removeEventListener("message", onMessage);
          sock.removeEventListener("error", onError);
          sock.removeEventListener("close", onClose);
        },
      );
    });
  }

  const registered: Array<() => void> = [];

  function handleDrop(reason: string, code?: number): void {
    if (closed || state === "closed") return;
    state = "connection-lost";
    settleOutstanding(reason);
    socket = null;
    openSessions.clear();
    emitEvent({ type: "connection-lost", reason, code });
  }

  // Concurrent callers share one attempt: a second socket would receive every
  // broadcast again and each chunk would be folded twice.
  let connecting: Promise<DaemonConnection> | null = null;

  async function connect(): Promise<DaemonConnection> {
    if (closed) throw new Error("fspec provider connection is closed");
    if (connecting !== null) return connecting;
    const attempt = openConnection();
    connecting = attempt;
    try {
      return await attempt;
    } finally {
      if (connecting === attempt) connecting = null;
    }
  }

  async function openConnection(): Promise<DaemonConnection> {
    const resolved = await resolveTarget();
    if (state === "established" && socket !== null) {
      return connectionFor(resolved);
    }
    state = "connecting";
    handshake.workUnitsUpdate = false;
    handshake.sessionSnapshot = false;
    initial = { workUnits: [], sessions: [] };
    const sock = openSocket(resolved.url);
    socket = sock;
    try {
      await attachSocket(sock, resolved);
    } catch (error) {
      state = "idle";
      socket = null;
      try {
        sock.close();
      } catch {
        /* already gone */
      }
      throw error;
    }
    return connectionFor(resolved);
  }


  function connectionFor(resolved: DaemonTarget): DaemonConnection {
    return {
      target: resolved,
      handshake,
      get initial() {
        return initial;
      },
      request(message: FspecServiceRequest, options: { deadlineMs?: number } = {}): Promise<DecodedResponse> {
        const sock = socket;
        if (closed || sock === null || state !== "established") {
          return Promise.reject(new Error("fspec daemon connection is not established"));
        }
        const id = nextRequestId;
        nextRequestId += 1;
        const frame = encodeRequestFrame({
          id,
          message,
          ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
        });
        return new Promise<DecodedResponse>((resolve, reject) => {
          outstanding.set(id, { resolve, reject });
          try {
            sock.send(encodeRpcEnvelope(frame));
          } catch (error) {
            outstanding.delete(id);
            reject(error);
          }
        });
      },
      onEnvelope(listener: (envelope: Envelope) => void): () => void {
        envelopeListeners.add(listener);
        return () => {
          envelopeListeners.delete(listener);
        };
      },
    };
  }

  // -- shutdown (rule 8) --------------------------------------------------

  function onEvent(listener: (event: DaemonClientEvent) => void): () => void {
    events.add(listener);
    return () => {
      events.delete(listener);
    };
  }

  async function close(): Promise<void> {
    if (closed) return; // idempotent
    closed = true;
    state = "closed";
    settleOutstanding("connection closed");
    const sock = socket;
    socket = null;
    if (sock !== null) {
      try {
        sock.close(1000, "provider unloaded");
      } catch {
        /* already closed */
      }
    }
    for (const teardown of registered) {
      try {
        teardown();
      } catch {
        /* best effort */
      }
    }
    registered.length = 0;
    envelopeListeners.clear();
    events.clear();
    openSessions.clear();
  }

  return {
    get state() {
      return state;
    },
    get handshake() {
      return { ...handshake };
    },
    openSessions,
    get outstandingRequests() {
      return outstanding.size;
    },
    get activeSockets() {
      return socket === null ? 0 : 1;
    },
    get listenerCount() {
      return events.size + envelopeListeners.size;
    },
    get readDaemonJsonCount() {
      return readDaemonJsonCount;
    },
    resolveTarget,
    status,
    connect,
    onEvent,
    close,
  };
}

/**
 * Node's WebSocket delivers binary frames as Blob unless told otherwise; the
 * codec needs bytes synchronously, so ask for ArrayBuffer up front.
 */
function defaultOpenSocket(url: string): SocketLike {
  const socket = new globalThis.WebSocket(url);
  socket.binaryType = "arraybuffer";
  return socket as unknown as SocketLike;
}

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (typeof data === "string") return null; // text frames: ignored
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}
