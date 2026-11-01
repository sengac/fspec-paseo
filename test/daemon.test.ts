/**
 * Feature: spec/features/fspec-daemon-connection.feature
 *
 * Validates the fspec daemon client (server/daemon.ts): target resolution
 * (explicit connect URL vs the daemons/<pid>.json entries), loopback-only enforcement before any
 * socket, the connect/handshake (WorkUnitsUpdate + SessionSnapshot),
 * connection-drop handling, and clean idempotent shutdown.
 *
 * Per the feature's assumption 2 the client takes an injectable WebSocket
 * transport, so no real daemon is required.
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as wire from "../server/wire.js";
import {
  createFspecDaemonClient,
  type FspecDaemonClient,
} from "../server/daemon.js";

// ---------------------------------------------------------------------------
// Fake WebSocket transport (no real sockets)
// ---------------------------------------------------------------------------

type Listener = (event: {
  data?: unknown;
  code?: number;
  reason?: string;
}) => void;

class FakeSocket {
  readonly sent: Uint8Array[] = [];
  readonly listeners = new Map<string, Set<Listener>>();
  readyState = 0; // 0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED
  closeCode: number | null = null;

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, event: Parameters<Listener>[0] = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  send(data: Uint8Array | ArrayBufferLike): void {
    this.sent.push(data instanceof Uint8Array ? data : new Uint8Array(data));
  }
  close(code?: number): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closeCode = code ?? 1005;
    this.emit("close", { code: this.closeCode });
  }
  serverOpen(): void {
    this.readyState = 1;
    this.emit("open");
  }
  serverFrame(envelope: wire.Envelope): void {
    const bytes = wire.encodeEnvelope(envelope);
    this.emit("message", {
      data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
  }
}

const HANDSHAKE: wire.Envelope[] = [
  { kind: "workUnitsUpdate", workUnits: [] },
  { kind: "sessionSnapshot", sessions: [] },
];

let root: string;
let xdgDir: string;
let homeDir: string;

/**
 * Writes one daemon's discovery entry. `sub` differs by location, exactly as
 * the daemon resolves it: $XDG_RUNTIME_DIR/fspec/daemons vs ~/.fspec/daemons.
 */
function writeEntry(dir: string, port: number, pid: number, sub = ".fspec"): string {
  mkdirSync(join(dir, sub, "daemons"), { recursive: true });
  const path = join(dir, sub, "daemons", `${pid}.json`);
  writeFileSync(path, JSON.stringify({ port, pid, workspace: root }));
  return path;
}

function clientFor(options: {
  connectUrl?: string;
  env?: Record<string, string>;
  pidAlive?: boolean;
  refuseConnect?: boolean;
}): { client: FspecDaemonClient; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  const client = createFspecDaemonClient({
    connectUrl: options.connectUrl,
    env: options.env ?? {},
    homeDir,
    isPidAlive: () => options.pidAlive ?? true,
    openSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      if (options.refuseConnect) {
        queueMicrotask(() => socket.emit("error", {}));
        return socket;
      }
      queueMicrotask(() => {
        socket.serverOpen();
        for (const envelope of HANDSHAKE) socket.serverFrame(envelope);
      });
      return socket;
    },
  });
  return { client, sockets };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fspec-daemon-"));
  xdgDir = join(root, "xdg");
  homeDir = join(root, "home");
  mkdirSync(xdgDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("Feature: Discover and connect to the fspec daemon", () => {
  describe("Scenario: A live daemon entry yields a connected client", () => {
    it("resolves the loopback URL and completes the handshake", async () => {
      // @step Given daemons/4321.json names a live daemon on port 41413 whose workspace holds the client's directory
      const path = writeEntry(homeDir, 41413, 4321);
      expect(existsSync(path)).toBe(true);
      // @step And provider configuration does not set an explicit connect URL
      const { client, sockets } = clientFor({ pidAlive: true });
      mkdirSync(join(root, "project"));
      client.bindDirectory(join(root, "project"));
      // @step When the plugin resolves the daemon target and connects
      const target = await client.resolveTarget();
      await client.connect();
      // @step Then the resolved target is the loopback WebSocket URL from that entry
      expect(target.url).toBe("ws://127.0.0.1:41413/");
      expect(target.entryPath).toBe(path);
      expect(sockets.length).toBe(1);
      // @step And the connection completes the handshake after receiving the initial WorkUnitsUpdate and SessionSnapshot
      expect(client.handshake).toEqual({
        workUnitsUpdate: true,
        sessionSnapshot: true,
      });
      // @step And the connection is reported established
      expect(client.state).toBe("established");
      await client.close();
    });
  });

  describe("Scenario: No live daemon reports unavailable with an actionable diagnostic", () => {
    it("reports available:false naming the daemons directory and the fix", async () => {
      // @step Given the daemons directory holds no entry
      const expected = join(homeDir, ".fspec", "daemons");
      expect(existsSync(expected)).toBe(false);
      // @step And provider configuration does not set an explicit connect URL
      const { client, sockets } = clientFor({});
      // @step When Paseo calls the provider's status()
      const status = await client.status();
      // @step Then status reports available false
      expect(status.available).toBe(false);
      // @step And the diagnostic says no fspec daemon is running, names the daemons directory and says to start the fspec daemon
      expect(status.diagnostic).toBe(`no fspec daemon is running — no live entry in ${expected}; start fspec daemon first`);
      expect(sockets.length).toBe(0); // status() opens no socket
      await client.close();
    });
  });

  describe("Scenario: A dead daemon's entry counts as no daemon", () => {
    it("reports no daemon and leaves the entry", async () => {
      // @step Given daemons/999999.json names a daemon whose pid is dead
      const path = writeEntry(homeDir, 41413, 999999);
      const { client } = clientFor({ pidAlive: false });
      // @step When Paseo calls the provider's status()
      const status = await client.status();
      // @step Then status reports available false with the no-daemon diagnostic
      expect(status).toEqual({
        available: false,
        diagnostic: `no fspec daemon is running — no live entry in ${join(homeDir, ".fspec", "daemons")}; start fspec daemon first`,
      });
      // @step And the entry is left on disk for fspec to prune
      expect(existsSync(path)).toBe(true);
      await client.close();
    });
  });

  describe("Scenario: A non-loopback connect URL is rejected before any socket opens", () => {
    it("rejects the target and names the offending host", async () => {
      // @step Given provider configuration sets an explicit connect URL pointing at a non-loopback host
      const { client, sockets } = clientFor({ connectUrl: "ws://8.8.8.8:41413" });
      // @step When the plugin resolves the daemon target
      // @step Then the target is rejected as non-loopback before any socket is opened
      await expect(client.resolveTarget()).rejects.toThrow(/non-loopback/i);
      expect(sockets.length).toBe(0);
      // @step And status reports available false
      const status = await client.status();
      expect(status.available).toBe(false);
      // @step And the diagnostic names the offending host and says only loopback (127.0.0.1, ::1, or localhost) is allowed
      expect(status.diagnostic).toContain("8.8.8.8");
      expect(status.diagnostic).toContain("127.0.0.1, ::1, or localhost");
      await client.close();
    });
  });

  describe("Scenario: The explicit connect URL wins over discovery", () => {
    it("uses the explicit URL and never reads the daemons directory", async () => {
      // @step Given provider configuration sets an explicit connect URL on a different port than the live daemon entry
      // @step And a live daemon entry exists in the daemons directory
      const path = writeEntry(homeDir, 41413, 4321);
      const { client, sockets } = clientFor({
        connectUrl: "ws://127.0.0.1:5555",
        pidAlive: true,
      });
      // @step When the plugin resolves the daemon target
      const target = await client.resolveTarget();
      // @step Then the connection target uses the explicit connect URL's port
      expect(target.url).toBe("ws://127.0.0.1:5555/");
      await client.connect();
      expect(sockets.length).toBe(1);
      // @step And the daemons directory is never read
      expect(existsSync(path)).toBe(true);
      expect(client.discoveryReadCount).toBe(0);
      await client.close();
    });
  });

  describe("Scenario: XDG_RUNTIME_DIR wins over the home directory for daemon entries", () => {
    it("resolves the XDG entry and its port", async () => {
      // @step Given both the XDG_RUNTIME_DIR daemons directory (port 6001) and the home directory daemons directory (port 7001) hold a live entry
      writeEntry(xdgDir, 6001, 4321, "fspec");
      writeEntry(homeDir, 7001, 4321);
      // @step And XDG_RUNTIME_DIR is set and non-empty
      const { client } = clientFor({
        env: { XDG_RUNTIME_DIR: xdgDir },
        pidAlive: true,
      });
      // @step When the plugin resolves the daemon target
      const target = await client.resolveTarget();
      // @step Then the resolved entry is under XDG_RUNTIME_DIR
      expect(target.entryPath).toBe(join(xdgDir, "fspec", "daemons", "4321.json"));
      // @step And the resolved port is 6001
      expect(target.port).toBe(6001);
      await client.close();
    });
  });

  describe("Scenario: A mid-session connection drop is surfaced as connection lost", () => {
    it("transitions to connection-lost and tears down without reconnecting", async () => {
      // @step Given the plugin has an established daemon connection
      writeEntry(homeDir, 41413, 4321);
      const { client, sockets } = clientFor({ pidAlive: true });
      const events: string[] = [];
      client.onEvent((event) => events.push(event.type));
      const connection = await client.connect();
      // start an in-flight request so we can observe its teardown
      const inFlight = connection.request({ method: "listProviders" });
      // @step When the daemon closes the WebSocket mid-session with a going-away close
      sockets[0].close(1001);
      await expect(inFlight).rejects.toThrow(/connection (was )?lost/i);
      // @step Then the client transitions to connection-lost and tears down outstanding request state
      expect(client.state).toBe("connection-lost");
      expect(client.outstandingRequests).toBe(0);
      // @step And the provider surfaces a connection-lost event with its open sessions torn down
      expect(events).toContain("connection-lost");
      // @step And the client does not reconnect on its own
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(sockets.length).toBe(1);
      expect(client.state).toBe("connection-lost");
      await client.close();
    });
  });

  describe("Scenario: Unloading the plugin closes the daemon connection cleanly", () => {
    it("closes the socket and releases all state, idempotently", async () => {
      // @step Given the plugin has an open daemon connection
      writeEntry(homeDir, 41413, 4321);
      const { client, sockets } = clientFor({ pidAlive: true });
      const unsubscribe = client.onEvent(() => {});
      await client.connect();
      const socket = sockets[0];
      // @step When Paseo unloads the plugin and the connection is closed
      await client.close();
      // @step Then the WebSocket is closed and open sessions and event listeners are released
      expect(socket.readyState).toBe(3);
      expect(client.state).toBe("closed");
      expect(client.openSessions.size).toBe(0);
      expect(socket.listeners.get("message")?.size ?? 0).toBe(0);
      unsubscribe();
      // @step And a second close is a no-op that does not throw
      await expect(client.close()).resolves.toBeUndefined();
      // @step And no sockets, timers, or listener registrations remain
      expect(client.activeSockets).toBe(0);
      expect(client.listenerCount).toBe(0);
    });
  });

  describe("Scenario: An unreachable daemon fails the connect with a diagnostic", () => {
    it("fails the connect naming the resolved target", async () => {
      // @step Given a valid loopback target was resolved
      writeEntry(homeDir, 41413, 4321);
      const { client } = clientFor({ pidAlive: true, refuseConnect: true });
      // @step When the plugin attempts to connect and the connection is refused
      // @step Then connect fails
      // @step And the failure says the connection to the resolved loopback target could not be established
      await expect(client.connect()).rejects.toThrow(
        /could not be established.*127\.0\.0\.1:41413|127\.0\.0\.1:41413.*could not be established/s,
      );
      await client.close();
    });
  });
});
