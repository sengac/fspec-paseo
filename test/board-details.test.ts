/**
 * Feature: spec/features/fspec-board-details.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createBoardFeed } from "../server/board.js";
import { FakeDaemon, daemonOptions, tempHome } from "./support/fake-daemon.js";

const disposers: Array<() => unknown> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

describe("Feature: Show full fspec work unit details from the Paseo board", () => {
  describe("Scenario: Full details come from get_work_unit_details", () => {
    it("answers the record from the daemon's JSON envelope", async () => {
      // @step Given the daemon answers get_work_unit_details for "FSPEC-001" with its JSON envelope
      const home = tempHome();
      home.writeDaemonJson();
      const daemon = new FakeDaemon();
      daemon.handlers.getWorkspaceInfo = () => ({ cwd: "/ws", gitBranch: null });
      const record = { id: "FSPEC-001", title: "Scaffold", status: "done", rules: [] };
      daemon.handlers.getWorkUnitDetails = (request) => {
        if (request.method !== "getWorkUnitDetails") throw new Error("unexpected request");
        if (request.id !== "FSPEC-001") return { ok: false, error: `work unit ${request.id} not found` };
        return { ok: true, value: JSON.stringify({ id: "FSPEC-001", workspace: "/ws", workUnit: record }) };
      };
      const feed = createBoardFeed(daemonOptions(home, daemon));
      disposers.push(home.dispose, () => feed.close());
      // @step When the panel calls fspec.board.details for "FSPEC-001" in "/ws"
      const details = await feed.details({ cwd: "/ws", id: "FSPEC-001" });
      // @step Then it answers state ready with the work unit record
      expect(details).toEqual({ state: "ready", id: "FSPEC-001", workUnit: record });
      expect(daemon.sent("getWorkUnitDetails")).toEqual([{ method: "getWorkUnitDetails", id: "FSPEC-001" }]);
      // @step And a daemon error "work unit NOPE-1 not found" answers state unavailable with that reason
      await expect(feed.details({ cwd: "/ws", id: "NOPE-1" })).resolves.toEqual({
        state: "unavailable",
        reason: "work unit NOPE-1 not found",
      });
      await expect(feed.details({ cwd: "/elsewhere", id: "FSPEC-001" })).resolves.toMatchObject({
        state: "unavailable",
        reason: "the fspec daemon serves /ws, not /elsewhere — start fspec in /elsewhere to use it there",
      });
    });
  });
});
