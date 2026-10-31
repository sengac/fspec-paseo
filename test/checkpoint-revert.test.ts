/**
 * Feature: spec/features/fspec-checkpoint-revert.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as wire from "../server/wire.js";
import { disposeHarnesses, harness, toolCall, toolResult } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

const DAEMON = "fspec-sess-42";
const checkpoint = (workUnitId: string, name: string): wire.CheckpointInfo => ({
  workUnitId,
  name,
  timestamp: "2026-10-30T00:00:00Z",
  isAutomatic: name.includes("-auto-"),
});
const BASELINE = checkpoint("AUTH-001", "AUTH-001-baseline");
const AUTO = checkpoint("AUTH-001", "AUTH-001-auto-testing");

describe("Feature: Revert files to fspec checkpoints from Paseo", () => {
  describe("Scenario: A checkpoint created by an fspec tool call becomes a revert point", () => {
    it("attaches the new checkpoint to the tool card", async () => {
      // @step Given an open fspec session whose daemon already had checkpoint "AUTH-001-baseline"
      const h = await harness();
      h.daemon.handlers.listCheckpoints = () => [BASELINE];
      await h.open("paseo-1");
      await h.send(h.prompt("paseo-1", "advance AUTH-001"));
      // @step When the agent's fspec tool call "call-3" completes and list_checkpoints now also shows "AUTH-001-auto-testing" for work unit "AUTH-001"
      h.daemon.handlers.listCheckpoints = () => [AUTO, BASELINE];
      await h.stream(DAEMON, toolCall("call-3", "fspec", { command: "update-work-unit-status", work_unit_id: "AUTH-001" }), toolResult("call-3", "ok"));
      // @step Then the provider re-published tool card "tool:call-3" with revertToken { workUnitId "AUTH-001", name "AUTH-001-auto-testing" }
      await vi.waitFor(() =>
        expect(h.items("tool_call").at(-1)).toMatchObject({ id: "tool:call-3", status: "completed", revertToken: { workUnitId: "AUTH-001", name: "AUTH-001-auto-testing" } }),
      );
      // @step And no revert token points at "AUTH-001-baseline"
      expect(h.items("tool_call").some((item) => JSON.stringify(item.revertToken ?? null).includes("baseline"))).toBe(false);
    });
  });

  describe("Scenario: Reverting files restores the checkpoint", () => {
    it("restores the checkpoint and completes", async () => {
      // @step Given a tool card with revertToken { workUnitId "AUTH-001", name "AUTH-001-auto-testing" }
      const h = await harness();
      await h.open("paseo-1");
      // @step When Paseo sends session.revert with scope files and that token
      const reply = await h.send({ type: "session.revert", requestId: "r-1", sessionId: "paseo-1", token: { workUnitId: "AUTH-001", name: "AUTH-001-auto-testing" }, scope: "files" });
      // @step Then the provider called restore_checkpoint_all("AUTH-001", "AUTH-001-auto-testing") and answered request.completed
      expect(h.daemon.sent("restoreCheckpointAll")).toEqual([{ method: "restoreCheckpointAll", workUnitId: "AUTH-001", name: "AUTH-001-auto-testing" }]);
      expect(reply).toEqual({ type: "request.completed", requestId: "r-1" });
    });
  });

  describe("Scenario: A failed or malformed revert is reported", () => {
    it("fails malformed tokens and daemon errors", async () => {
      // @step Given an open fspec session
      const h = await harness();
      await h.open("paseo-1");
      // @step When Paseo sends session.revert with scope files and the token "oops"
      const bad = await h.send({ type: "session.revert", requestId: "r-2", sessionId: "paseo-1", token: "oops", scope: "files" });
      // @step Then the provider answered request.failed "Not an fspec checkpoint" and restored nothing
      expect(bad).toMatchObject({ type: "request.failed", error: { message: "Not an fspec checkpoint" } });
      expect(h.daemon.sent("restoreCheckpointAll")).toEqual([]);
      // @step And when restore_checkpoint_all fails with "dirty tree" the revert answers request.failed "dirty tree"
      h.daemon.handlers.restoreCheckpointAll = () => ({ ok: false, error: "dirty tree" });
      const failed = await h.send({ type: "session.revert", requestId: "r-3", sessionId: "paseo-1", token: { workUnitId: "A", name: "A-1" }, scope: "files" });
      expect(failed).toMatchObject({ type: "request.failed", error: { message: "dirty tree" } });
    });
  });

  describe("Scenario: Only file revert is offered", () => {
    it("negotiates files revert only", async () => {
      // @step Given Paseo connects to the fspec provider with every capability
      const h = await harness();
      // @step When the connection negotiates capabilities
      const capabilities = h.connection.capabilities;
      // @step Then it includes session.revert.files and excludes session.revert.conversation and session.revert.both
      expect(capabilities).toContain("session.revert.files");
      expect(capabilities).not.toContain("session.revert.conversation");
      expect(capabilities).not.toContain("session.revert.both");
    });
  });
});
