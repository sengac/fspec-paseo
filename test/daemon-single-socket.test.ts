/**
 * Feature: spec/features/fspec-daemon-single-socket.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderEventSchema, PROVIDER_CAPABILITIES, type ProviderEvent } from "@getpaseo/plugin/server/provider";
import { createFspecDaemonClient, type SocketLike } from "../server/daemon.js";
import { createFspecProvider } from "../server/provider.js";
import { FakeDaemon, FakeSocket, daemonOptions, tempHome } from "./support/fake-daemon.js";
import { text } from "./support/provider-harness.js";

const homes: Array<ReturnType<typeof tempHome>> = [];
afterEach(() => {
  for (const home of homes.splice(0)) home.dispose();
});

function liveHome() {
  const home = tempHome();
  home.writeDaemonEntry();
  homes.push(home);
  return home;
}

describe("Feature: Share one daemon socket across concurrent connects", () => {
  describe("Scenario: Concurrent connects share one socket", () => {
    it("opens one socket for three concurrent callers", async () => {
      // @step Given a daemon client whose first connection handshake is still in flight
      const daemon = new FakeDaemon();
      const client = createFspecDaemonClient(daemonOptions(liveHome(), daemon));
      // @step When three callers call connect() at the same time
      const connections = await Promise.all([client.connect(), client.connect(), client.connect()]);
      // @step Then exactly one socket was opened and all three callers resolved with the same connection
      expect(daemon.sockets).toHaveLength(1);
      expect(new Set(connections.map((connection) => connection.target.url)).size).toBe(1);
      expect(client.activeSockets).toBe(1);
      await client.close();
    });
  });

  describe("Scenario: Concurrent inputs stream each chunk once", () => {
    it("publishes one assistant row for one chunk", async () => {
      // @step Given Paseo sends the catalog request and session.open on a fresh provider connection without waiting
      const daemon = new FakeDaemon();
      const connection = await createFspecProvider(daemonOptions(liveHome(), daemon)).connect({
        versions: [1],
        capabilities: PROVIDER_CAPABILITIES,
      });
      const events: ProviderEvent[] = [];
      connection.onEvent((event) => events.push(ProviderEventSchema.parse(event)));
      await Promise.all([
        connection.send({ type: "catalog", requestId: "c-1" }),
        connection.send({
          type: "session.open",
          requestId: "o-1",
          sessionId: "paseo-1",
          config: { cwd: "/work", env: {}, mcpServers: {}, settings: {}, persist: true },
          history: "skip",
        }),
      ]);
      await vi.waitFor(() => expect(events.some((event) => event.type === "session.ready")).toBe(true));
      // @step When the daemon streams Text "hi" for the opened session
      daemon.push("fspec-sess-42", text("hi"));
      await new Promise((resolve) => setTimeout(resolve, 10));
      // @step Then the provider opened one daemon socket and published exactly one assistant_message "hi"
      expect(daemon.sockets).toHaveLength(1);
      const rows = events.filter((event) => event.type === "timeline.item");
      expect(rows.map((event) => (event as { item: { text?: string } }).item.text)).toEqual(["hi"]);
      await connection.close();
    });
  });

  describe("Scenario: A failed connect does not stick", () => {
    it("opens a new socket after a refused attempt", async () => {
      // @step Given a connect attempt that fails because the daemon refuses the socket
      const daemon = new FakeDaemon();
      let refuse = true;
      const client = createFspecDaemonClient({
        ...daemonOptions(liveHome(), daemon),
        openSocket: (url): SocketLike => {
          if (!refuse) return daemon.openSocket(url);
          const socket = new FakeSocket(() => {});
          queueMicrotask(() => socket.emit("error", {}));
          return socket;
        },
      });
      await expect(client.connect()).rejects.toThrow(/could not be established/);
      // @step When the next connect() is called after the daemon is back
      refuse = false;
      const connection = await client.connect();
      // @step Then a new socket is opened and the connection is established
      expect(daemon.sockets).toHaveLength(1);
      expect(client.state).toBe("established");
      expect(connection.handshake).toEqual({ workUnitsUpdate: true, sessionSnapshot: true });
      await client.close();
    });
  });
});
