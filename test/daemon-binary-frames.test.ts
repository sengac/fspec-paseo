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

afterEach(() => {
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
});
