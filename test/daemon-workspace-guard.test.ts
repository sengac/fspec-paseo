/**
 * Feature: spec/features/fspec-daemon-workspace-guard.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as wire from "../server/wire.js";
import { within } from "../server/workspaces.js";
import { disposeHarnesses, harness } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

function vector(name: string): string {
  const text = readFileSync(fileURLToPath(new URL("./golden/golden-vectors.txt", import.meta.url)), "utf8");
  const line = text.split("\n").find((entry) => entry.startsWith(`${name} `));
  if (line === undefined) throw new Error(`missing golden vector ${name}`);
  return line.slice(name.length + 1).trim();
}

const index = (n: number) => Buffer.from(new Uint32Array([n]).buffer).toString("hex");

/** A daemon started in /repos/fspec that also serves the given workspaces. */
async function serving(...others: string[]) {
  const h = await harness();
  h.daemon.handlers.getWorkspaceInfo = () => ({ cwd: "/repos/fspec", gitBranch: "main" });
  h.daemon.handlers.listWorkspaces = () => ({
    ok: true,
    value: [
      { path: "/repos/fspec", name: "fspec", start: true },
      ...others.map((path) => ({ path, name: path.split("/").at(-1)!, start: false })),
    ],
  });
  return h;
}

describe("Feature: Run each fspec session in the workspace of its Paseo directory", () => {
  describe("Scenario: An open outside the daemon's start workspace runs in that directory's workspace", () => {
    it("creates the session in the Paseo directory's workspace", async () => {
      // @step Given the fspec daemon started in "/repos/fspec" and serves no other workspace
      const h = await serving();
      // @step When Paseo opens an fspec session with cwd "/repos/fspec-paseo"
      const opened = await h.open("paseo-1", { cwd: "/repos/fspec-paseo" });
      // @step Then the provider created the session with create_session_in_workspace for "/repos/fspec-paseo" and no create_session_checked
      expect(h.daemon.sent("createSessionInWorkspace")).toEqual([
        { method: "createSessionInWorkspace", workspace: "/repos/fspec-paseo", role: null },
      ]);
      expect(h.daemon.sent("createSessionChecked")).toEqual([]);
      // @step And the open reached session.ready
      expect(opened.at(-1)).toMatchObject({ type: "session.ready", sessionId: "paseo-1" });
    });
  });

  describe("Scenario: An open inside the daemon workspace proceeds", () => {
    it("checks the workspace first and opens", async () => {
      // @step Given the fspec daemon serves workspace "/repos/fspec"
      const h = await harness();
      h.daemon.handlers.getWorkspaceInfo = () => ({ cwd: "/repos/fspec", gitBranch: "main" });
      // @step When Paseo opens an fspec session with cwd "/repos/fspec/rust"
      const opened = await h.open("paseo-1", { cwd: "/repos/fspec/rust" });
      // @step Then the provider resolved the workspace with list_workspaces before create_session_checked and the open reached session.ready
      const methods = h.daemon.requests.map((request) => request.method);
      expect(methods.indexOf("listWorkspaces")).toBeGreaterThanOrEqual(0);
      expect(methods.indexOf("listWorkspaces")).toBeLessThan(methods.indexOf("createSessionChecked"));
      expect(h.daemon.sent("createSessionInWorkspace")).toEqual([]);
      expect(opened.at(-1)).toMatchObject({ type: "session.ready", sessionId: "paseo-1" });
    });
  });

  describe("Scenario: Symlinked paths to the daemon workspace are accepted", () => {
    it("compares resolved real paths", async () => {
      // @step Given the fspec daemon reports its workspace by its resolved real path
      const root = mkdtempSync(join(tmpdir(), "fspec-ws-"));
      const real = join(root, "real");
      mkdirSync(real);
      const link = join(root, "link");
      symlinkSync(real, link);
      const h = await harness();
      h.daemon.handlers.getWorkspaceInfo = () => ({ cwd: realpathSync(real), gitBranch: null });
      try {
        // @step When Paseo opens an fspec session with a symlinked path to the same directory
        const opened = await h.open("paseo-1", { cwd: `${link}/` });
        // @step Then the open reaches session.ready
        expect(opened.at(-1)).toMatchObject({ type: "session.ready" });
        await vi.waitFor(() => expect(h.daemon.sent("createSessionChecked")).toHaveLength(1));
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe("Scenario: A directory not yet created under a symlinked workspace path is inside it", () => {
    it("canonicalises the missing directory through its deepest existing ancestor", async () => {
      // @step Given the fspec daemon reports its workspace by its resolved real path
      const root = mkdtempSync(join(tmpdir(), "fspec-ws-"));
      const real = join(root, "real");
      mkdirSync(real);
      const link = join(root, "link");
      symlinkSync(real, link);
      const h = await harness();
      h.daemon.handlers.getWorkspaceInfo = () => ({ cwd: realpathSync(real), gitBranch: null });
      h.daemon.handlers.listWorkspaces = () => ({ ok: true, value: [{ path: realpathSync(real), name: "real", start: true }] });
      try {
        // @step When Paseo opens an fspec session in a directory that does not exist yet under a symlinked path to that workspace
        const opened = await h.open("paseo-1", { cwd: join(link, "new", "deeper") });
        // @step Then the provider created the session with create_session_checked and no create_session_in_workspace
        expect(h.daemon.sent("createSessionChecked")).toHaveLength(1);
        expect(h.daemon.sent("createSessionInWorkspace")).toEqual([]);
        // @step And the open reaches session.ready
        expect(opened.at(-1)).toMatchObject({ type: "session.ready" });
        expect(within(real, join(link, "new"))).toBe(true);
        expect(within(real, join(root, "other", "new"))).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe("Scenario: A path that cannot be resolved is an error", () => {
    it.skipIf(process.getuid?.() === 0)("throws naming the path", () => {
      // @step Given a directory whose contents cannot be read
      const root = mkdtempSync(join(tmpdir(), "fspec-ws-"));
      const locked = join(root, "locked");
      mkdirSync(locked);
      chmodSync(locked, 0o000);
      try {
        // @step When the workspace guard compares a path inside it with a workspace
        const compare = () => within(root, join(locked, "inner"));
        // @step Then it fails with "cannot resolve" naming the path
        expect(compare).toThrow(`cannot resolve ${join(locked, "inner")}:`);
      } finally {
        chmodSync(locked, 0o700);
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe("Scenario: An open inside another served workspace creates the session there", () => {
    it("uses the listed workspace holding the directory", async () => {
      // @step Given the fspec daemon started in "/repos/fspec" and also serves "/repos/app"
      const h = await serving("/repos/app");
      // @step When Paseo opens an fspec session with cwd "/repos/app/web"
      await h.open("paseo-1", { cwd: "/repos/app/web" });
      // @step Then the provider created the session with create_session_in_workspace for "/repos/app"
      expect(h.daemon.sent("createSessionInWorkspace")).toEqual([{ method: "createSessionInWorkspace", workspace: "/repos/app", role: null }]);
      expect(h.daemon.sent("createSessionChecked")).toEqual([]);
    });
  });

  describe("Scenario: A workspace the daemon refuses fails the open with its reason", () => {
    it("fails the open with the daemon's reason", async () => {
      // @step Given create_session_in_workspace answers "workspace path is not a directory: /gone"
      const h = await serving();
      h.daemon.handlers.createSessionInWorkspace = () => ({ ok: false, error: "workspace path is not a directory: /gone" });
      // @step When Paseo opens an fspec session with cwd "/gone"
      await h.connection.send({
        type: "session.open",
        requestId: "o-1",
        sessionId: "paseo-1",
        config: { cwd: "/gone", env: {}, mcpServers: {}, settings: {}, persist: true },
        history: "skip",
      });
      const failed = await h.waitFor("request.failed", (event) => event.requestId === "o-1");
      // @step Then the open fails with "fspec could not create a session in /gone: workspace path is not a directory: /gone"
      expect(failed.error.message).toBe("fspec could not create a session in /gone: workspace path is not a directory: /gone");
      // @step And no set_session_model or set_thinking_level was sent
      expect(h.daemon.sent("setSessionModel")).toEqual([]);
      expect(h.daemon.sent("setThinkingLevel")).toEqual([]);
    });
  });

  describe("Scenario: Workspace RPCs match the daemon's encoding", () => {
    it("byte-matches the golden vectors", () => {
      // @step Given the Rust golden vectors for list_workspaces, create_session_in_workspace and list_workspace_work_units
      const reply = (variant: number, payload: string) =>
        wire.decodeResponseFrame(new Uint8Array(Buffer.from("0000000000000000" + "00000000" + index(variant) + payload, "hex")));
      const hex = (message: wire.FspecServiceRequest) => Buffer.from(wire.encodeRequestFrame({ id: 0, message })).toString("hex");
      // @step When the codec decodes the replies and encodes the requests
      const listed = reply(124, vector("workspace_entries_ok"));
      const created = reply(126, vector("create_session_in_workspace_ok"));
      // @step Then the workspaces decode to "/w/a" named "a" as the start workspace and "/w/b" named "b"
      expect(listed).toMatchObject({
        method: "listWorkspaces",
        result: { ok: true, value: [{ path: "/w/a", name: "a", start: true }, { path: "/w/b", name: "b", start: false }] },
      });
      const encoded = wire.encodeResponseFrame({
        requestId: 0,
        message: "listWorkspaces",
        value: { ok: true, value: [{ path: "/w/a", name: "a", start: true }, { path: "/w/b", name: "b", start: false }] },
      });
      expect(Buffer.from(encoded.subarray(16)).toString("hex")).toBe(vector("workspace_entries_ok"));
      // @step And the create_session_in_workspace and list_workspace_work_units arguments and reply match the golden vectors exactly
      expect(created).toMatchObject({ method: "createSessionInWorkspace", result: { ok: true, value: "s-9" } });
      expect(hex({ method: "createSessionInWorkspace", workspace: "/w/b", role: "role" }).endsWith(index(126) + vector("create_session_in_workspace_args"))).toBe(true);
      expect(hex({ method: "listWorkspaceWorkUnits", workspace: "/w/b" }).endsWith(index(125) + vector("list_workspace_work_units_args"))).toBe(true);
      expect(hex({ method: "listWorkspaces" }).endsWith(index(124))).toBe(true);
    });
  });

  describe("Scenario: The import list shows the sessions of the served workspace holding the directory", () => {
    it("lists that workspace's sessions", async () => {
      // @step Given the fspec daemon started in "/repos/fspec" and also serves "/repos/app"
      const h = await serving("/repos/app");
      h.daemon.handlers.listSessions = (request) =>
        request.method === "listSessions" && request.projectPath === "/repos/app"
          ? [{ ...SESSION, id: "app-1", name: "app work", project: "/repos/app" }]
          : [];
      // @step When Paseo lists importable fspec sessions for cwd "/repos/app/web"
      const reply = await h.send({ type: "sessions", requestId: "list-1", cwd: "/repos/app/web" });
      // @step Then the provider listed the sessions of "/repos/app" and each summary carries cwd "/repos/app"
      expect(h.daemon.sent("listSessions")).toEqual([{ method: "listSessions", projectPath: "/repos/app" }]);
      expect(reply).toMatchObject({ type: "sessions", sessions: [{ cwd: "/repos/app", title: "app work" }] });
    });
  });
});

const SESSION: wire.SessionInfo = {
  id: "s",
  name: "s",
  status: "idle",
  project: "/repos/fspec",
  messageCount: 2,
  providerId: null,
  modelId: null,
  isIsolated: false,
  worktreePath: null,
  role: null,
  updatedAtMs: null,
  workUnitFocus: { revision: 0, context: null, source: "none" },
};
