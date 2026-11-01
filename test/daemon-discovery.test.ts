/**
 * Feature: spec/features/fspec-daemon-discovery.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROVIDER_CAPABILITIES, type ProviderEvent } from "@getpaseo/plugin/server/provider";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBoardFeed } from "../server/board.js";
import { createFspecDaemonClient, type DaemonClientOptions, type SocketLike } from "../server/daemon.js";
import { createFspecProvider } from "../server/provider.js";
import { createSettingsFeed } from "../server/settings.js";
import type * as wire from "../server/wire.js";
import { FakeDaemon } from "./support/fake-daemon.js";
import { CATALOG } from "./support/provider-harness.js";

const disposers: Array<() => unknown> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

interface Entry {
  pid: number;
  port: number;
  workspace: string;
}

/**
 * A temp ~/.fspec holding daemons/<pid>.json entries, and a daemon.json
 * (optional) that discovery must ignore (FSPEC-060). `alive` can change.
 */
function discovery(files: { pointer?: Entry; entries: Entry[]; alive: number[] }) {
  const homeDir = mkdtempSync(join(tmpdir(), "fspec-discovery-"));
  disposers.push(() => rmSync(homeDir, { recursive: true, force: true }));
  const dir = join(homeDir, ".fspec");
  mkdirSync(join(dir, "daemons"), { recursive: true });
  const json = (entry: Entry) =>
    JSON.stringify({ port: entry.port, pid: entry.pid, workspace: entry.workspace, started_at: "2026-11-01T00:00:00Z", version: "0.10.9" });
  if (files.pointer) writeFileSync(join(dir, "daemon.json"), json(files.pointer));
  for (const entry of files.entries) writeFileSync(join(dir, "daemons", `${entry.pid}.json`), json(entry));
  const alive = new Set(files.alive);
  return { homeDir, alive, isPidAlive: (pid: number) => alive.has(pid) };
}

const A: Entry = { pid: 100, port: 4100, workspace: "/a" };
const B: Entry = { pid: 200, port: 4200, workspace: "/b" };
const NOT_SERVED_C =
  "no fspec daemon serves /c — the live daemons are pid 100 in /a (port 4100), pid 200 in /b (port 4200); start fspec in /c, or set FSPEC_DAEMON_URL to choose a daemon";

async function targetFor(options: DaemonClientOptions, cwd: string): Promise<string> {
  const client = createFspecDaemonClient(options);
  disposers.push(() => client.close());
  client.bindDirectory(cwd);
  return (await client.resolveTarget()).url;
}

function unit(id: string): wire.WorkUnitInfo {
  return { id, title: id, workType: "story", status: "backlog", description: null, estimate: null, epic: null, attachments: [], lastStateChangeAt: null };
}

/** Two fake daemons, one per workspace, reached through one openSocket routed by port. */
function twoDaemons() {
  // daemon.json names /a: discovery must not prefer it.
  const files = discovery({ pointer: A, entries: [A, B], alive: [100, 200] });
  const daemons = new Map<number, FakeDaemon>();
  for (const entry of [A, B]) {
    const daemon = new FakeDaemon();
    daemon.handlers.getWorkspaceInfo = () => ({ cwd: entry.workspace, gitBranch: null });
    daemon.handlers.listProviders = () => CATALOG;
    daemon.handlers.getDefaultModel = () => "anthropic/claude-sonnet-4";
    daemon.initialWorkUnits = [unit(entry.workspace === "/a" ? "A-001" : "B-001")];
    daemons.set(entry.port, daemon);
  }
  const options: DaemonClientOptions = {
    env: {},
    homeDir: files.homeDir,
    isPidAlive: files.isPidAlive,
    openSocket: (url) => daemons.get(Number(new URL(url).port))!.openSocket(url),
  };
  return { options, alive: files.alive, a: daemons.get(4100)!, b: daemons.get(4200)! };
}

/** Records the headers each socket was opened with. */
function recordingOptions(env: Record<string, string>) {
  const files = discovery({ pointer: A, entries: [A], alive: [100] });
  const daemon = new FakeDaemon();
  const opened: Array<Record<string, string>> = [];
  const options: DaemonClientOptions = {
    env,
    homeDir: files.homeDir,
    isPidAlive: files.isPidAlive,
    openSocket: (url, init): SocketLike => {
      opened.push(init?.headers ?? {});
      return daemon.openSocket(url);
    },
  };
  return { options, opened };
}

describe("Feature: Find the right local fspec daemon and authenticate to it", () => {
  describe("Scenario: The daemon whose workspace holds the directory is used", () => {
    it("targets the entry whose workspace holds the directory", async () => {
      // @step Given daemons/100.json names a live daemon in "/a" on port 4100 and daemons/200.json a live daemon in "/b" on port 4200
      const files = discovery({ pointer: A, entries: [A, B], alive: [100, 200] });
      // @step When a daemon client bound to "/b/web" resolves its target
      const url = await targetFor({ env: {}, homeDir: files.homeDir, isPidAlive: files.isPidAlive }, "/b/web");
      // @step Then it targets "ws://127.0.0.1:4200/"
      expect(url).toBe("ws://127.0.0.1:4200/");
    });
  });

  describe("Scenario: A directory no daemon serves fails naming the live daemons", () => {
    it("fails instead of using daemon.json", async () => {
      // @step Given daemons/100.json names a live daemon in "/a" on port 4100 and daemons/200.json a live daemon in "/b" on port 4200
      const files = discovery({ pointer: A, entries: [A, B], alive: [100, 200] });
      // @step When a daemon client bound to "/c" resolves its target
      const resolved = targetFor({ env: {}, homeDir: files.homeDir, isPidAlive: files.isPidAlive }, "/c");
      // @step Then it fails with "no fspec daemon serves /c — the live daemons are pid 100 in /a (port 4100), pid 200 in /b (port 4200); start fspec in /c, or set FSPEC_DAEMON_URL to choose a daemon"
      await expect(resolved).rejects.toThrow(NOT_SERVED_C);
    });
  });

  describe("Scenario: Dead daemon entries never serve a directory", () => {
    it("skips dead pids and fails for the unserved directory", async () => {
      // @step Given daemons/111.json for a dead daemon in "/p" on port 4111 and daemons/222.json for a live daemon in "/other" on port 4222
      const files = discovery({
        entries: [
          { pid: 111, port: 4111, workspace: "/p" },
          { pid: 222, port: 4222, workspace: "/other" },
        ],
        alive: [222],
      });
      // @step When a daemon client bound to "/p" resolves its target
      const resolved = targetFor({ env: {}, homeDir: files.homeDir, isPidAlive: files.isPidAlive }, "/p");
      // @step Then it fails with "no fspec daemon serves /p — the live daemons are pid 222 in /other (port 4222); start fspec in /p, or set FSPEC_DAEMON_URL to choose a daemon"
      await expect(resolved).rejects.toThrow(
        "no fspec daemon serves /p — the live daemons are pid 222 in /other (port 4222); start fspec in /p, or set FSPEC_DAEMON_URL to choose a daemon",
      );
    });
  });

  describe("Scenario: Several daemons serving the directory fail naming them", () => {
    it("refuses to choose between nested workspaces", async () => {
      // @step Given daemons/100.json names a live daemon in "/a" on port 4100 and daemons/300.json a live daemon in "/a/b" on port 4300
      const files = discovery({ entries: [A, { pid: 300, port: 4300, workspace: "/a/b" }], alive: [100, 300] });
      // @step When a daemon client bound to "/a/b/c" resolves its target
      const resolved = targetFor({ env: {}, homeDir: files.homeDir, isPidAlive: files.isPidAlive }, "/a/b/c");
      // @step Then it fails with "2 fspec daemons serve /a/b/c — pid 100 in /a (port 4100), pid 300 in /a/b (port 4300); stop all but one, or set FSPEC_DAEMON_URL to choose one"
      await expect(resolved).rejects.toThrow(
        "2 fspec daemons serve /a/b/c — pid 100 in /a (port 4100), pid 300 in /a/b (port 4300); stop all but one, or set FSPEC_DAEMON_URL to choose one",
      );
    });
  });

  describe("Scenario: A connection bound to no directory needs exactly one daemon", () => {
    it("fails with two daemons and uses the only one", async () => {
      // @step Given daemons/100.json names a live daemon in "/a" on port 4100 and daemons/200.json a live daemon in "/b" on port 4200
      const { options, alive, a, b } = twoDaemons();
      a.handlers.listProviderCredentials = () => [];
      // @step When the settings feed lists providers, and later only the daemon in "/a" is live
      const first = await createSettingsFeed(options).list({});
      const both = await createFspecProvider(options).status!({});
      alive.delete(200);
      const feed = createSettingsFeed(options);
      disposers.push(() => feed.close());
      const second = await feed.list({});
      const one = await createFspecProvider(options).status!({});
      // @step Then the first list is unavailable with "2 fspec daemons are running and this connection serves no directory — pid 100 in /a (port 4100), pid 200 in /b (port 4200); set FSPEC_DAEMON_URL to choose one"
      expect(first).toEqual({
        state: "unavailable",
        reason:
          "2 fspec daemons are running and this connection serves no directory — pid 100 in /a (port 4100), pid 200 in /b (port 4200); set FSPEC_DAEMON_URL to choose one",
      });
      // @step And the second list comes from the daemon in "/a"
      expect(second).toMatchObject({ state: "ready", workspace: "/a" });
      expect(b.sockets).toHaveLength(0);
      // @step And the provider's status is available while either daemon is live
      expect([both, one]).toEqual([{ available: true }, { available: true }]);
    });
  });

  describe("Scenario: An fspec agent connects to the daemon serving its directory", () => {
    it("opens the provider's socket to that daemon", async () => {
      // @step Given daemons/100.json names a live daemon in "/a" and daemons/200.json a live daemon in "/b"
      const { options, a, b } = twoDaemons();
      const connection = await createFspecProvider(options).connect({ versions: [1], capabilities: PROVIDER_CAPABILITIES });
      disposers.push(() => connection.close());
      const events: ProviderEvent[] = [];
      connection.onEvent((event) => events.push(event));
      // @step When Paseo opens an fspec agent in "/b"
      await connection.send({
        type: "session.open",
        requestId: "o-1",
        sessionId: "paseo-1",
        config: { cwd: "/b", env: {}, mcpServers: {}, settings: {}, persist: true },
        history: "skip",
      });
      await vi.waitFor(() => expect(events.some((event) => event.type === "session.ready")).toBe(true));
      // @step Then the provider's socket was opened to the daemon in "/b" and the session was created there
      expect(b.sockets).toHaveLength(1);
      expect(a.sockets).toHaveLength(0);
      expect(b.sent("createSessionChecked")).toHaveLength(1);
    });
  });

  describe("Scenario: Each board panel reaches the daemon serving its directory", () => {
    it("routes each panel directory to its daemon", async () => {
      // @step Given daemons/100.json names a live daemon in "/a" and daemons/200.json a live daemon in "/b"
      const { options, a, b } = twoDaemons();
      const feed = createBoardFeed(options);
      disposers.push(() => feed.close());
      // @step When board panels watch "/a", "/b" and "/c"
      const boardA = await feed.watch({ cwd: "/a", sinceRevision: null });
      const boardB = await feed.watch({ cwd: "/b", sinceRevision: null });
      const boardC = await feed.watch({ cwd: "/c", sinceRevision: null });
      // @step Then the board of "/a" comes from the daemon in "/a" and the board of "/b" from the daemon in "/b"
      expect(boardA).toMatchObject({ state: "ready", workspace: "/a", units: [unit("A-001")] });
      expect(boardB).toMatchObject({ state: "ready", workspace: "/b", units: [unit("B-001")] });
      expect([a.sockets.length, b.sockets.length]).toEqual([1, 1]);
      // @step And the board of "/c" is unavailable with "no fspec daemon serves /c — the live daemons are pid 100 in /a (port 4100), pid 200 in /b (port 4200); start fspec in /c, or set FSPEC_DAEMON_URL to choose a daemon"
      expect(boardC).toMatchObject({ state: "unavailable", reason: NOT_SERVED_C });
    });
  });

  describe("Scenario: A configured token is sent as a bearer header", () => {
    it("opens the socket with Authorization: Bearer", async () => {
      // @step Given FSPEC_DAEMON_TOKEN is "s3cret" in the Paseo daemon's environment
      const { options, opened } = recordingOptions({ FSPEC_DAEMON_TOKEN: "s3cret" });
      const client = createFspecDaemonClient(options);
      disposers.push(() => client.close());
      // @step When the daemon client connects
      await client.connect();
      // @step Then the WebSocket was opened with the header "Authorization: Bearer s3cret"
      expect(opened).toEqual([{ Authorization: "Bearer s3cret" }]);
    });
  });

  describe("Scenario: Without a token no Authorization header is sent", () => {
    it("opens the socket without Authorization", async () => {
      // @step Given FSPEC_DAEMON_TOKEN is not set
      const { options, opened } = recordingOptions({});
      const client = createFspecDaemonClient(options);
      disposers.push(() => client.close());
      // @step When the daemon client connects
      await client.connect();
      // @step Then the WebSocket was opened without an Authorization header
      expect(opened).toEqual([{}]);
    });
  });
});
