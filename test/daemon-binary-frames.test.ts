/**
 * Feature: spec/features/fspec-daemon-binary-frames.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 *
 * The default factory path is exercised by stubbing globalThis.WebSocket with
 * a fake that, like Node's WebSocket, delivers Blob unless binaryType is set.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as wire from "../server/wire.js";
import { createFspecDaemonClient } from "../server/daemon.js";
import { FakeDaemon, FakeSocket } from "./support/fake-daemon.js";
import { disposeHarnesses, harness } from "./support/provider-harness.js";

type Listener = (event: { data?: unknown; code?: number }) => void;

class BrowserLikeSocket {
  static last: BrowserLikeSocket | undefined;
  binaryType: "blob" | "arraybuffer" = "blob";
  binaryTypeAtFirstFrame: string | undefined;
  readyState = 0;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(readonly url: string) {
    BrowserLikeSocket.last = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit("open", {});
      this.frame({ kind: "workUnitsUpdate", workUnits: [] });
      this.frame({ kind: "sessionSnapshot", sessions: [] });
    });
  }
  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, event: Parameters<Listener>[0]): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
  /** Delivers a frame as Node's WebSocket does: Blob unless binaryType says otherwise. */
  frame(envelope: wire.Envelope): void {
    this.binaryTypeAtFirstFrame ??= this.binaryType;
    const bytes = wire.encodeEnvelope(envelope);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    this.emit("message", { data: this.binaryType === "arraybuffer" ? buffer : new Blob([buffer as ArrayBuffer]) });
  }
  send(data: Uint8Array): void {
    const envelope = wire.decodeEnvelope(data);
    if (envelope.kind !== "rpc") return;
    const request = wire.decodeRequestFrame(envelope.frame);
    queueMicrotask(() =>
      this.frame({
        kind: "rpc",
        frame: wire.encodeResponseFrame({ requestId: request.id, message: "listProviders", value: [] }),
      }),
    );
  }
  close(): void {
    this.readyState = 3;
  }
}

afterEach(async () => {
  await disposeHarnesses();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  BrowserLikeSocket.last = undefined;
});

describe("Feature: Receive daemon frames as ArrayBuffer on the default WebSocket", () => {
  describe("Scenario: The default WebSocket receives daemon frames as ArrayBuffer", () => {
    it("sets binaryType and completes the handshake through the default factory", async () => {
      // @step Given the daemon client uses its default WebSocket factory
      vi.stubGlobal("WebSocket", BrowserLikeSocket);
      const client = createFspecDaemonClient({ connectUrl: "ws://127.0.0.1:47100/", env: {} });
      // @step When it opens the socket to the daemon
      const connection = await client.connect();
      // @step Then the socket's binaryType is "arraybuffer" before any frame arrives
      expect(BrowserLikeSocket.last!.binaryTypeAtFirstFrame).toBe("arraybuffer");
      // @step And the WorkUnitsUpdate and SessionSnapshot handshake completes and a list_providers response decodes
      expect(connection.handshake).toEqual({ workUnitsUpdate: true, sessionSnapshot: true });
      await expect(connection.request({ method: "listProviders" })).resolves.toMatchObject({
        ok: true,
        method: "listProviders",
        providers: [],
      });
      await client.close();
    });
  });

  describe("Scenario: A Blob frame is decoded instead of dropped", () => {
    it("completes the handshake when frames arrive as Blob", async () => {
      // @step Given a transport that delivers binary daemon frames as Blob
      const client = createFspecDaemonClient({
        connectUrl: "ws://127.0.0.1:47100/",
        env: {},
        openSocket: (url) => {
          const socket = new BrowserLikeSocket(url);
          // A transport that ignores binaryType keeps delivering Blob.
          Object.defineProperty(socket, "binaryType", { get: () => "blob", set: () => {} });
          return socket;
        },
      });
      // @step When the daemon sends the WorkUnitsUpdate and SessionSnapshot handshake frames
      const connection = await Promise.race([
        client.connect(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("handshake never completed")), 1000)),
      ]);
      // @step Then the client completes the handshake
      expect(connection.handshake).toEqual({ workUnitsUpdate: true, sessionSnapshot: true });
      await client.close();
    });
  });

  describe("Scenario: An undecodable frame drops the connection as a protocol error", () => {
    it("rejects the request, drops once, closes the socket and logs", async () => {
      // @step Given an established daemon connection with a list_providers request in flight
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const daemon = new FakeDaemon();
      daemon.handlers.listProviders = () => new Promise(() => {});
      const client = createFspecDaemonClient({ connectUrl: "ws://127.0.0.1:47100/", env: {}, openSocket: daemon.openSocket });
      const lost: string[] = [];
      client.onEvent((event) => {
        if (event.type === "connection-lost") lost.push(event.reason);
      });
      const connection = await client.connect();
      const inFlight = connection.request({ method: "listProviders" });
      // @step When the daemon sends a binary frame that is not an Envelope
      daemon.sockets[0]!.emit("message", { data: new Uint8Array([0xff, 0xff, 0xff, 0xff]).buffer });
      // @step Then the request rejects with "protocol error: the envelope frame could not be decoded"
      await expect(inFlight).rejects.toThrow("protocol error: the envelope frame could not be decoded");
      // @step And the client is connection-lost after one connection-lost event, the socket is closed and the plugin log has the reason
      expect(client.state).toBe("connection-lost");
      expect(lost).toHaveLength(1);
      expect(lost[0]).toMatch(/^protocol error: the envelope frame could not be decoded — /);
      expect(daemon.sockets[0]!.readyState).toBe(3);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("protocol error: the envelope frame could not be decoded"));
      // Later frames of that socket are not processed.
      daemon.sockets[0]!.serverFrame({ kind: "workUnitsUpdate", workUnits: [] });
      expect(lost).toHaveLength(1);
      await client.close();
    });
  });

  describe("Scenario: An undecodable rpc response during the handshake fails the connect", () => {
    it("rejects connect with the protocol error", async () => {
      // @step Given a daemon that answers the handshake with an rpc envelope whose response frame does not decode
      vi.spyOn(console, "error").mockImplementation(() => {});
      const sockets: FakeSocket[] = [];
      const client = createFspecDaemonClient({
        connectUrl: "ws://127.0.0.1:47100/",
        env: {},
        openSocket: () => {
          const socket = new FakeSocket(() => {});
          sockets.push(socket);
          queueMicrotask(() => {
            socket.readyState = 1;
            socket.emit("open");
            socket.serverFrame({ kind: "workUnitsUpdate", workUnits: [] });
            socket.serverFrame({ kind: "rpc", frame: new Uint8Array([1, 2, 3]) });
            socket.serverFrame({ kind: "sessionSnapshot", sessions: [] });
          });
          return socket;
        },
      });
      // @step When the client connects
      const connecting = client.connect();
      // @step Then connect fails with "protocol error: an rpc response frame could not be decoded"
      await expect(connecting).rejects.toThrow("protocol error: an rpc response frame could not be decoded");
      expect(sockets[0]!.readyState).toBe(3);
      await client.close();
    });
  });

  describe("Scenario: A session sees a protocol error as a lost runtime", () => {
    it("fails the session's runtime with the reason", async () => {
      // @step Given an open Paseo fspec session
      vi.spyOn(console, "error").mockImplementation(() => {});
      const h = await harness();
      await h.open("paseo-1");
      // @step When the daemon sends a binary frame that is not an Envelope
      h.daemon.sockets[0]!.emit("message", { data: new Uint8Array([0xff, 0xff, 0xff, 0xff]).buffer });
      // @step Then the session gets session.runtime_failed naming the protocol error
      const failed = await h.waitFor("session.runtime_failed");
      expect(failed.error.message).toMatch(/^fspec daemon connection was lost: protocol error: the envelope frame could not be decoded — .* — reopen the session$/);
    });
  });

  describe("Scenario: Text frames are logged and ignored", () => {
    it("logs the text frame and keeps the connection", async () => {
      // @step Given an established daemon connection
      const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
      const daemon = new FakeDaemon();
      const client = createFspecDaemonClient({ connectUrl: "ws://127.0.0.1:47100/", env: {}, openSocket: daemon.openSocket });
      const connection = await client.connect();
      // @step When the daemon sends a text frame
      daemon.sockets[0]!.emit("message", { data: "hello" });
      // @step Then the plugin log notes the ignored text frame and the connection stays established
      expect(warned).toHaveBeenCalledWith("[fspec] ignored a text frame from the fspec daemon (its protocol is binary)");
      expect(client.state).toBe("established");
      await expect(connection.request({ method: "listProviders" })).resolves.toMatchObject({ ok: true });
      await client.close();
    });
  });
});
