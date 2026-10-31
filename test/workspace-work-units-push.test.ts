/**
 * Feature: spec/features/fspec-workspace-work-units-push.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createBoardFeed } from "../server/board.js";
import { createFspecDaemonClient } from "../server/daemon.js";
import * as wire from "../server/wire.js";
import { FakeDaemon, daemonOptions, tempHome } from "./support/fake-daemon.js";

const disposers: Array<() => unknown> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

function vector(name: string): string {
  const text = readFileSync(fileURLToPath(new URL("./golden/golden-vectors.txt", import.meta.url)), "utf8");
  const line = text.split("\n").find((entry) => entry.startsWith(`${name} `));
  if (line === undefined) throw new Error(`missing golden vector ${name}`);
  return line.slice(name.length + 1).trim();
}

function unit(id: string): wire.WorkUnitInfo {
  return {
    id,
    title: `${id} title`,
    workType: "story",
    status: "backlog",
    description: null,
    estimate: null,
    epic: null,
    attachments: [],
    lastStateChangeAt: null,
  };
}

function fakeDaemon() {
  const home = tempHome();
  home.writeDaemonJson();
  const daemon = new FakeDaemon();
  disposers.push(home.dispose);
  return { home, daemon };
}

describe("Feature: Decode fspec's WorkspaceWorkUnitsUpdate envelope instead of dropping it", () => {
  describe("Scenario: The WorkspaceWorkUnitsUpdate envelope matches the daemon's encoding", () => {
    it("decodes and re-encodes the golden vector", () => {
      // @step Given the Rust golden vector for Envelope index 9 carrying WorkspaceWorkUnits for workspace "/w" with no units
      const bytes = new Uint8Array(Buffer.from(vector("env_workspace_workunits"), "hex"));
      expect(vector("env_workspace_workunits")).toBe("09000000" + vector("workspace_work_units"));
      // @step When the codec decodes it and encodes the decoded value
      const decoded = wire.decodeEnvelope(bytes);
      const encoded = wire.encodeEnvelope(decoded);
      // @step Then it decodes to a workspaceWorkUnitsUpdate envelope for "/w" with no units at variant index 9
      expect(decoded).toEqual({ kind: "workspaceWorkUnitsUpdate", workspace: "/w", units: [] });
      expect(wire.envelopeVariantIndex(decoded)).toBe(9);
      expect(wire.ENVELOPE_VARIANTS[9]).toBe("WorkspaceWorkUnitsUpdate");
      // @step And the encoded bytes match the golden vector exactly
      expect(Buffer.from(encoded).toString("hex")).toBe(vector("env_workspace_workunits"));
    });
  });

  describe("Scenario: The daemon client delivers a workspace push to its listeners", () => {
    it("hands the push to onEnvelope listeners", async () => {
      // @step Given an established daemon connection with an envelope listener
      const { home, daemon } = fakeDaemon();
      const client = createFspecDaemonClient(daemonOptions(home, daemon));
      disposers.push(() => client.close());
      const connection = await client.connect();
      const seen: wire.Envelope[] = [];
      connection.onEnvelope((envelope) => seen.push(envelope));
      // @step When the daemon pushes WorkspaceWorkUnitsUpdate for "/other" with work unit "OTHER-001"
      daemon.pushEnvelope({ kind: "workspaceWorkUnitsUpdate", workspace: "/other", units: [unit("OTHER-001")] });
      await new Promise((resolve) => setTimeout(resolve, 0));
      // @step Then the listener receives that push with workspace "/other" and work unit "OTHER-001"
      expect(seen).toEqual([{ kind: "workspaceWorkUnitsUpdate", workspace: "/other", units: [unit("OTHER-001")] }]);
    });
  });

  describe("Scenario: A push for another workspace leaves the start workspace's board alone", () => {
    it("keeps holding and keeps the start workspace's units", async () => {
      // @step Given the board of "/work" is held at its current revision showing "FSPEC-001"
      const { home, daemon } = fakeDaemon();
      daemon.initialWorkUnits = [unit("FSPEC-001")];
      const feed = createBoardFeed(daemonOptions(home, daemon));
      disposers.push(() => feed.close());
      const first = await feed.watch({ cwd: "/work", sinceRevision: null });
      if (first.state !== "ready") throw new Error(first.reason);
      let answered = false;
      const held = feed.watch({ cwd: "/work", sinceRevision: first.revision }).then((board) => {
        answered = true;
        return board;
      });
      // @step When the daemon pushes WorkspaceWorkUnitsUpdate for "/other" with work unit "OTHER-001"
      daemon.pushEnvelope({ kind: "workspaceWorkUnitsUpdate", workspace: "/other", units: [unit("OTHER-001")] });
      await new Promise((resolve) => setTimeout(resolve, 20));
      // @step Then the held watch is still waiting
      expect(answered).toBe(false);
      // @step And the next board for "/work" still shows only "FSPEC-001" at the same revision
      const next = await feed.watch({ cwd: "/work", sinceRevision: null });
      expect(next).toMatchObject({ state: "ready", revision: first.revision, units: [unit("FSPEC-001")] });
      await feed.close();
      await held;
    });
  });
});
