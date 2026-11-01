/**
 * Feature: spec/features/fspec-bot-mode.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { BOT_ROLE_MARKER, ORCHESTRATOR_ROLE } from "../server/bot.js";
import * as wire from "../server/wire.js";
import { disposeHarnesses, harness } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

const DAEMON = "fspec-sess-42";

/** fspec's rust/sessions/src/bot.rs ORCHESTRATOR_ROLE (TUI-114), verbatim. */
const FSPEC_ORCHESTRATOR_ROLE = `# fspec bot: orchestrator

You are an orchestrator bot. Do not do the work yourself: break the user's
request into focused tasks and delegate each one to a sub-agent.

- Use the AgentManager tool to spawn one sub-agent per task (for example one
  per work unit), giving each a clear, self-contained instruction.
- Use AgentManager message to steer or answer a sub-agent, get_status to check
  on one, and await_idle to wait until they finish.
- Check each sub-agent's result against the request before relying on it, and
  send follow-up messages when something is missing or wrong.
- Close sub-agents you no longer need.
- Report back to the user: what each sub-agent did, what is finished, and what
  still needs attention.`;

function vector(name: string): string {
  const text = readFileSync(fileURLToPath(new URL("./golden/golden-vectors.txt", import.meta.url)), "utf8");
  const line = text.split("\n").find((entry) => entry.startsWith(`${name} `));
  if (line === undefined) throw new Error(`missing golden vector ${name}`);
  return line.slice(name.length + 1).trim();
}

const index = (n: number) => Buffer.from(new Uint32Array([n]).buffer).toString("hex");

function info(id: string, role: string | null): wire.SessionInfo {
  return {
    id,
    name: id,
    status: "idle",
    project: "/work",
    messageCount: 3,
    providerId: null,
    modelId: null,
    isIsolated: false,
    worktreePath: null,
    role,
    updatedAtMs: null,
    workUnitFocus: { revision: 0, context: null, source: "none" },
  };
}

describe("Feature: Start fspec orchestrator bots from Paseo with a bot mode", () => {
  describe("Scenario: The catalog offers agent and bot modes", () => {
    it("lists both modes with agent as the default", async () => {
      // @step Given an fspec provider connected to the daemon
      const h = await harness();
      // @step When Paseo asks for the catalog
      await h.send({ type: "catalog", requestId: "catalog-1" });
      const catalog = h.ofType("catalog")[0]!.catalog;
      // @step Then the catalog's modes are "agent" labelled "Agent" and "bot" labelled "Bot", and its defaultMode is "agent"
      expect(catalog.modes.map((mode) => [mode.id, mode.label])).toEqual([
        ["agent", "Agent"],
        ["bot", "Bot"],
      ]);
      expect(catalog.defaultMode).toBe("agent");
    });
  });

  describe("Scenario: A bot is created with fspec's orchestrator role", () => {
    it("passes the orchestrator role to create_session_checked", async () => {
      // @step Given the orchestrator role starts with "# fspec bot: orchestrator"
      expect(ORCHESTRATOR_ROLE).toBe(FSPEC_ORCHESTRATOR_ROLE);
      expect(ORCHESTRATOR_ROLE.startsWith(BOT_ROLE_MARKER)).toBe(true);
      const h = await harness();
      // @step When Paseo opens an fspec session in the daemon's start workspace with mode "bot"
      const opened = await h.open("paseo-1", { mode: "bot" });
      // @step Then the provider called create_session_checked with the orchestrator role
      expect(h.daemon.sent("createSessionChecked")).toEqual([{ method: "createSessionChecked", role: FSPEC_ORCHESTRATOR_ROLE }]);
      // @step And the committed session.config mode is "bot"
      expect(h.ofType("session.config", opened)[0]!.config).toMatchObject({ mode: "bot" });
    });
  });

  describe("Scenario: A bot in another workspace is created there with the orchestrator role", () => {
    it("passes the orchestrator role to create_session_in_workspace", async () => {
      // @step Given the fspec daemon started in "/work" serves no other workspace
      const h = await harness();
      // @step When Paseo opens an fspec session in "/repos/app" with mode "bot"
      await h.open("paseo-1", { cwd: "/repos/app", mode: "bot" });
      // @step Then the provider called create_session_in_workspace for "/repos/app" with the orchestrator role
      expect(h.daemon.sent("createSessionInWorkspace")).toEqual([
        { method: "createSessionInWorkspace", workspace: "/repos/app", role: FSPEC_ORCHESTRATOR_ROLE },
      ]);
    });
  });

  describe("Scenario: An agent opened without a mode has no role", () => {
    it("creates an ordinary agent", async () => {
      // @step Given an fspec provider connected to the daemon
      const h = await harness();
      // @step When Paseo opens an fspec session with no mode
      const opened = await h.open("paseo-1");
      // @step Then the provider called create_session_checked with no role
      expect(h.daemon.sent("createSessionChecked")).toEqual([{ method: "createSessionChecked", role: null }]);
      // @step And the committed session.config mode is "agent"
      expect(h.ofType("session.config", opened)[0]!.config).toMatchObject({ mode: "agent" });
    });
  });

  describe("Scenario: A resumed session with the bot role opens in bot mode", () => {
    it("takes the mode from the daemon's role", async () => {
      // @step Given a saved fspec session "fspec-sess-42" whose role is the orchestrator role
      const h = await harness();
      h.daemon.handlers.getSessionRole = () => FSPEC_ORCHESTRATOR_ROLE;
      // @step When Paseo reopens it with mode "agent"
      const opened = await h.open("paseo-1", { mode: "agent" }, { version: 1, data: { sessionId: DAEMON } });
      // @step Then the committed session.config mode is "bot" and no set_session_role was sent
      expect(h.daemon.sent("getSessionRole")).toEqual([{ method: "getSessionRole", sessionId: DAEMON }]);
      expect(h.ofType("session.config", opened)[0]!.config).toMatchObject({ mode: "bot" });
      expect(h.daemon.sent("setSessionRole")).toEqual([]);
    });
  });

  describe("Scenario: Changing the mode switches the session's role", () => {
    it("sets and clears the orchestrator role", async () => {
      // @step Given an open fspec agent session "fspec-sess-42"
      const h = await harness();
      await h.open("paseo-1");
      // @step When Paseo configures mode "bot" and then mode "agent"
      h.daemon.handlers.getSessionRole = () => null;
      await h.send({ type: "session.configure", requestId: "c-1", sessionId: "paseo-1", changes: { mode: "bot" } });
      h.daemon.handlers.getSessionRole = () => FSPEC_ORCHESTRATOR_ROLE;
      await h.send({ type: "session.configure", requestId: "c-2", sessionId: "paseo-1", changes: { mode: "agent" } });
      // @step Then the provider called set_session_role with the orchestrator role and then with no role
      expect(h.daemon.sent("setSessionRole")).toEqual([
        { method: "setSessionRole", sessionId: DAEMON, role: FSPEC_ORCHESTRATOR_ROLE },
        { method: "setSessionRole", sessionId: DAEMON, role: null },
      ]);
      // @step And the committed session.config modes were "bot" then "agent"
      expect(h.ofType("session.config").slice(-2).map((event) => event.config.mode)).toEqual(["bot", "agent"]);
    });
  });

  describe("Scenario: The import list marks bot sessions", () => {
    it("prefixes bot descriptions", async () => {
      // @step Given the daemon lists session "bot-1" with the orchestrator role and session "agent-1" with no role
      const h = await harness();
      h.daemon.handlers.listSessions = () => [info("bot-1", FSPEC_ORCHESTRATOR_ROLE), info("agent-1", null)];
      // @step When Paseo lists importable fspec sessions
      const reply = await h.send({ type: "sessions", requestId: "list-1" });
      const sessions = reply?.type === "sessions" ? reply.sessions : [];
      // @step Then the description of "bot-1" starts with "Bot · " and the description of "agent-1" does not
      const description = (title: string) => sessions.find((session) => session.title === title)?.description ?? "";
      expect(description("bot-1").startsWith("Bot · ")).toBe(true);
      expect(description("agent-1").startsWith("Bot · ")).toBe(false);
    });
  });

  describe("Scenario: Session role RPCs match the daemon's encoding", () => {
    it("byte-matches the golden vectors", () => {
      // @step Given the Rust golden vectors for an Option<String> reply and for String plus Option<String> arguments
      const reply = wire.decodeResponseFrame(
        new Uint8Array(Buffer.from("0000000000000000" + "00000000" + index(44) + vector("default_model_some"), "hex")),
      );
      // @step When the codec decodes a get_session_role reply and encodes set_session_role arguments
      const args = Buffer.from(
        wire.encodeRequestFrame({ id: 0, message: { method: "setSessionRole", sessionId: "/w/b", role: "role" } }),
      ).toString("hex");
      const get = Buffer.from(wire.encodeRequestFrame({ id: 0, message: { method: "getSessionRole", sessionId: "s-1" } })).toString("hex");
      // @step Then they match the golden vectors at variant indices 44 and 45
      expect(reply).toMatchObject({ method: "getSessionRole", role: "anthropic/claude-sonnet-4" });
      expect(args.endsWith(index(45) + vector("create_session_in_workspace_args"))).toBe(true);
      expect(get.endsWith(index(44) + "0300000000000000732d31")).toBe(true);
    });
  });
});
