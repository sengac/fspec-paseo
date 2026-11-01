/**
 * Feature: spec/features/fspec-board-actions.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it } from "vitest";
import { type AgentEntry, fspecModels, openInAgent } from "../client/open-in-agent.js";
import { createBoardFeed } from "../server/board.js";
import type { BoardUnit } from "../shared/board.js";
import { FakeDaemon, daemonOptions, tempHome } from "./support/fake-daemon.js";

const disposers: Array<() => unknown> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

function unit(id: string, title: string): BoardUnit {
  return {
    id,
    title,
    workType: "story",
    status: "backlog",
    description: null,
    estimate: null,
    epic: null,
    attachments: [],
    lastStateChangeAt: null,
  };
}

function fspecAgent(id: string, sessionId: string, status = "idle"): AgentEntry {
  return {
    agent: {
      id,
      provider: "fspec",
      status,
      persistence: { metadata: { pluginProviderPersistence: { version: 1, data: { sessionId } } } },
    },
  };
}

function deps(entries: AgentEntry[], models: Array<{ id: string; isDefault?: boolean }>) {
  const created: Array<{ provider: string; title: string; prompt: string }> = [];
  const opened: string[] = [];
  return {
    created,
    opened,
    deps: {
      listAgents: async () => entries,
      listModels: async () => models,
      createAgent: async (options: { provider: string; title: string; prompt: string }) => {
        created.push(options);
        return { id: "A-new" };
      },
      openAgent: (agentId: string) => opened.push(agentId),
    },
  };
}

describe("Feature: Reorder fspec cards and open them in an agent from the Paseo board", () => {
  describe("Scenario: Cards move up and down within their column", () => {
    it("calls move_work_unit_up/down behind the workspace guard", async () => {
      // @step Given the fspec daemon serves "/ws"
      const home = tempHome();
      home.writeDaemonEntry();
      const daemon = new FakeDaemon();
      daemon.handlers.getWorkspaceInfo = () => ({ cwd: "/ws", gitBranch: null });
      daemon.handlers.moveWorkUnitUp = (request) =>
        request.method === "moveWorkUnitUp" && request.id === "FSPEC-002"
          ? { ok: false, error: "cannot move done work unit" }
          : { ok: true, value: undefined };
      daemon.handlers.moveWorkUnitDown = () => ({ ok: true, value: undefined });
      const feed = createBoardFeed(daemonOptions(home, daemon));
      disposers.push(home.dispose, () => feed.close());
      // @step When the panel moves "FSPEC-003" up and "FSPEC-004" down
      const up = await feed.move({ cwd: "/ws", id: "FSPEC-003", direction: "up" });
      const down = await feed.move({ cwd: "/ws", id: "FSPEC-004", direction: "down" });
      // @step Then the daemon receives move_work_unit_up "FSPEC-003" and move_work_unit_down "FSPEC-004" and both answer ok
      expect(daemon.sent("moveWorkUnitUp")).toEqual([{ method: "moveWorkUnitUp", workspace: "/ws", id: "FSPEC-003" }]);
      expect(daemon.sent("moveWorkUnitDown")).toEqual([{ method: "moveWorkUnitDown", workspace: "/ws", id: "FSPEC-004" }]);
      expect(up).toEqual({ ok: true });
      expect(down).toEqual({ ok: true });
      // @step And a daemon error "cannot move done work unit" answers not ok with that error
      await expect(feed.move({ cwd: "/ws", id: "FSPEC-002", direction: "up" })).resolves.toEqual({
        ok: false,
        error: "cannot move done work unit",
      });
      await expect(feed.move({ cwd: "/elsewhere", id: "FSPEC-003", direction: "up" })).resolves.toMatchObject({
        ok: false,
        error: "the fspec daemon serves /ws, not /elsewhere — start fspec in /elsewhere to use it there",
      });
      expect(daemon.sent("moveWorkUnitUp")).toHaveLength(2);
    });
  });

  describe("Scenario: Open in agent switches to the agent focused on the card", () => {
    it("opens the Paseo agent that owns the focused fspec session", async () => {
      // @step Given "FSPEC-001" is focused by fspec session "fspec-sess-1" owned by Paseo agent "A1"
      const focus = { "FSPEC-001": ["fspec-sess-1"] };
      const t = deps(
        [
          fspecAgent("A0", "fspec-sess-0"),
          fspecAgent("A-closed", "fspec-sess-1", "closed"),
          fspecAgent("A1", "fspec-sess-1"),
          { agent: { id: "C1", provider: "claude", status: "idle", persistence: null } },
        ],
        [{ id: "m1" }],
      );
      // @step When the user opens "FSPEC-001" in an agent
      const result = await openInAgent(t.deps, unit("FSPEC-001", "Scaffold"), focus);
      // @step Then Paseo agent "A1" is opened and no agent is created
      expect(result).toEqual({ agentId: "A1", created: false });
      expect(t.opened).toEqual(["A1"]);
      expect(t.created).toEqual([]);
    });
  });

  describe("Scenario: Open in agent creates a focused fspec agent when none is on the card", () => {
    it("creates an fspec agent with the default model and /focus", async () => {
      // @step Given "FSPEC-002" titled "Wire codec" has no focused session and the fspec models are "m1" and default "m2"
      const t = deps([fspecAgent("A1", "fspec-sess-1")], [{ id: "m1" }, { id: "m2", isDefault: true }]);
      // @step When the user opens "FSPEC-002" in an agent
      const result = await openInAgent(t.deps, unit("FSPEC-002", "Wire codec"), { "FSPEC-001": ["fspec-sess-1"] });
      // @step Then an agent is created with model "fspec/m2", title "FSPEC-002 — Wire codec" and prompt "/focus FSPEC-002"
      expect(t.created).toEqual([{ provider: "fspec/m2", title: "FSPEC-002 — Wire codec", prompt: "/focus FSPEC-002" }]);
      // @step And the new agent is opened
      expect(result).toEqual({ agentId: "A-new", created: true });
      expect(t.opened).toEqual(["A-new"]);
    });
  });

  describe("Scenario: Open in agent without fspec's default model fails", () => {
    it("creates nothing without a default model", async () => {
      // @step Given "FSPEC-002" has no focused session and the fspec models are "m1" and "m2" with no default
      const t = deps([], [{ id: "m1" }, { id: "m2" }]);
      // @step When the user opens "FSPEC-002" in an agent
      const opening = openInAgent(t.deps, unit("FSPEC-002", "Wire codec"), {});
      // @step Then it fails with "fspec has no default model — set one under fspec providers" and no agent is created
      await expect(opening).rejects.toThrow("fspec has no default model — set one under fspec providers");
      expect(t.created).toEqual([]);
    });
  });

  describe("Scenario: Open in agent reports Paseo's model listing error", () => {
    it("throws the listing error or the missing list", () => {
      // @step Given Paseo answers the fspec model listing with the error "provider fspec is loading"
      const failed = { error: "provider fspec is loading" };
      // @step When the board reads the fspec models
      const read = () => fspecModels(failed);
      // @step Then it fails with "provider fspec is loading"
      expect(read).toThrow("provider fspec is loading");
      // @step And a listing without models fails with "Paseo listed no fspec models"
      expect(() => fspecModels({ error: null })).toThrow("Paseo listed no fspec models");
      expect(fspecModels({ models: [{ id: "m1" }], error: null })).toEqual([{ id: "m1" }]);
    });
  });
});
