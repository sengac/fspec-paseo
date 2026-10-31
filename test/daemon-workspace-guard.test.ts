/**
 * Feature: spec/features/fspec-daemon-workspace-guard.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { disposeHarnesses, harness } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

const SESSION_RPCS = ["createSessionChecked", "resumeSession", "setSessionModel", "setThinkingLevel"];

describe("Feature: Refuse sessions outside the fspec daemon's workspace", () => {
  describe("Scenario: An open outside the daemon workspace is refused", () => {
    it("fails the open with both directories and touches no daemon session", async () => {
      // @step Given the fspec daemon serves workspace "/repos/fspec"
      const h = await harness();
      h.daemon.handlers.getWorkspaceInfo = () => ({ cwd: "/repos/fspec", gitBranch: "main" });
      // @step When Paseo opens an fspec session with cwd "/repos/fspec-paseo"
      await h.connection.send({
        type: "session.open",
        requestId: "o-1",
        sessionId: "paseo-1",
        config: { cwd: "/repos/fspec-paseo", env: {}, mcpServers: {}, settings: {}, persist: true },
        history: "skip",
      });
      const failed = await h.waitFor("request.failed", (event) => event.requestId === "o-1");
      // @step Then the open answers request.failed naming "/repos/fspec", "/repos/fspec-paseo" and the fix to start fspec in "/repos/fspec-paseo"
      expect(failed.error.message).toBe(
        "the fspec daemon serves /repos/fspec, not /repos/fspec-paseo — start fspec in /repos/fspec-paseo to use it there",
      );
      expect(h.ofType("session.opened")).toEqual([]);
      // @step And no create_session, resume_session, set_session_model or set_thinking_level was sent
      expect(h.daemon.requests.filter((request) => SESSION_RPCS.includes(request.method))).toEqual([]);
    });
  });

  describe("Scenario: An open inside the daemon workspace proceeds", () => {
    it("checks the workspace first and opens", async () => {
      // @step Given the fspec daemon serves workspace "/repos/fspec"
      const h = await harness();
      h.daemon.handlers.getWorkspaceInfo = () => ({ cwd: "/repos/fspec", gitBranch: "main" });
      // @step When Paseo opens an fspec session with cwd "/repos/fspec/rust"
      const opened = await h.open("paseo-1", { cwd: "/repos/fspec/rust" });
      // @step Then the provider called get_workspace_info before create_session and the open reached session.ready
      const methods = h.daemon.requests.map((request) => request.method);
      expect(methods.indexOf("getWorkspaceInfo")).toBeGreaterThanOrEqual(0);
      expect(methods.indexOf("getWorkspaceInfo")).toBeLessThan(methods.indexOf("createSessionChecked"));
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
});
