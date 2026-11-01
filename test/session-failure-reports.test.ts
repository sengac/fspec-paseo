/**
 * Feature: spec/features/fspec-session-failure-reports.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import type { ProviderInput } from "@getpaseo/plugin/server/provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { interactionSnapshot } from "./support/fake-daemon.js";
import { disposeHarnesses, harness, text, toolCall, toolResult } from "./support/provider-harness.js";

const DAEMON = "fspec-sess-42";
let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await disposeHarnesses();
  logged.mockRestore();
});

type Harness = Awaited<ReturnType<typeof harness>>;

/** The warning notice titled `title` on `sessionId`. */
async function notice(h: Harness, sessionId: string, title: string) {
  const shown = await h.waitFor("session.notice", (event) => event.sessionId === sessionId && event.notice.title === title);
  expect(shown.notice.severity).toBe("warning");
  return shown.notice;
}

async function openFails(h: Harness): Promise<string> {
  await h.connection.send({
    type: "session.open",
    requestId: "o-1",
    sessionId: "paseo-1",
    config: { cwd: "/work", env: {}, mcpServers: {}, settings: {}, persist: true },
    history: "skip",
  });
  return (await h.waitFor("request.failed", (event) => event.requestId === "o-1")).error.message;
}

describe("Feature: Report every failed background daemon call of an fspec session", () => {
  describe("Scenario: A failed active mark is reported on the session", () => {
    it("shows a warning notice and logs it", async () => {
      // @step Given set_active_session fails with "board busy"
      const h = await harness();
      h.daemon.handlers.setActiveSession = () => {
        throw new Error("board busy");
      };
      // @step When Paseo opens an fspec session
      await h.open("paseo-1");
      // @step Then the session shows a warning notice "fspec could not mark this session active on its board" naming "board busy"
      const shown = await notice(h, "paseo-1", "fspec could not mark this session active on its board");
      expect(shown.description).toContain("board busy");
      // @step And the plugin log has the failure
      expect(logged).toHaveBeenCalledWith(
        expect.stringMatching(/^\[fspec\] fspec could not mark this session active on its board \(paseo-1\): .*board busy/),
      );
    });
  });

  describe("Scenario: A failed stop fails the interrupt request", () => {
    it("answers request.failed and never request.completed", async () => {
      // @step Given an open fspec session whose interrupt fails with "Session not found"
      const h = await harness();
      await h.open("paseo-1");
      h.daemon.handlers.interrupt = () => {
        throw new Error("Session not found");
      };
      // @step When Paseo interrupts the session
      const settled = await h.send({ type: "session.interrupt", requestId: "stop-1", sessionId: "paseo-1" });
      // @step Then the interrupt answers request.failed naming "Session not found" and no request.completed
      expect(settled).toMatchObject({ type: "request.failed" });
      expect(settled?.type === "request.failed" && settled.error.message).toContain("Session not found");
      expect(h.ofType("request.completed").filter((event) => event.requestId === "stop-1")).toEqual([]);
    });
  });

  describe("Scenario: A failed cleanup after a failed open keeps the original error first", () => {
    it("names the original error, then the failed destroy", async () => {
      // @step Given set_session_model fails with "unknown model" and destroy_session fails with "busy"
      const h = await harness();
      h.daemon.handlers.setSessionModel = () => ({ ok: false, error: "unknown model" });
      h.daemon.handlers.destroySession = () => ({ ok: false, error: "busy" });
      // @step When Paseo opens a fresh fspec session
      const message = await openFails(h);
      // @step Then the open fails with "fspec daemon set_session_model failed: unknown model; the fspec session fspec-sess-42 it created could not be destroyed: fspec daemon destroy_session failed: busy"
      expect(message).toBe(
        "fspec daemon set_session_model failed: unknown model; the fspec session fspec-sess-42 it created could not be destroyed: fspec daemon destroy_session failed: busy",
      );
    });
  });

  describe("Scenario: Checkpoints that cannot be listed fail the open before anything is created", () => {
    it("fails the open without creating a session", async () => {
      // @step Given list_checkpoints fails with "repository locked"
      const h = await harness();
      h.daemon.handlers.listCheckpoints = () => {
        throw new Error("repository locked");
      };
      // @step When Paseo opens a fresh fspec session
      const message = await openFails(h);
      // @step Then the open fails naming "repository locked" and no daemon session was created
      expect(message).toContain("repository locked");
      expect(h.daemon.sent("createSessionChecked")).toEqual([]);
      expect(h.daemon.sent("createSessionInWorkspace")).toEqual([]);
    });
  });

  describe("Scenario: Work unit focus that cannot be read is reported", () => {
    it("shows a warning notice", async () => {
      // @step Given get_work_unit_focus answers the error "focus store unreadable"
      const h = await harness();
      h.daemon.handlers.getWorkUnitFocus = () => ({ ok: false, error: "focus store unreadable" });
      // @step When Paseo opens an fspec session
      await h.open("paseo-1");
      // @step Then the session shows a warning notice "fspec work unit focus could not be read" naming "focus store unreadable"
      expect((await notice(h, "paseo-1", "fspec work unit focus could not be read")).description).toContain("focus store unreadable");
    });
  });

  describe("Scenario: A checkpoint lookup that fails after an fspec call is reported", () => {
    it("shows a warning notice", async () => {
      // @step Given an open fspec session whose list_checkpoints fails with "repository locked" after it opened
      const h = await harness();
      await h.open("paseo-1");
      await h.send(h.prompt("paseo-1", "work"));
      h.daemon.handlers.listCheckpoints = () => {
        throw new Error("repository locked");
      };
      // @step When an fspec tool call of the session completes
      await h.stream(DAEMON, toolCall("call-3", "fspec", { command: "checkpoint" }), toolResult("call-3", "ok"));
      // @step Then the session shows a warning notice "fspec checkpoints could not be read — this fspec call has no revert point" naming "repository locked"
      const shown = await notice(h, "paseo-1", "fspec checkpoints could not be read — this fspec call has no revert point");
      expect(shown.description).toContain("repository locked");
    });
  });

  describe("Scenario: A steer whose deny fails is reported and the request stays shown", () => {
    it("reports the failed deny and keeps the approval", async () => {
      // @step Given an open fspec session paused on an approval while its turn runs, whose reply_interaction_checked answers the error "pause moved on"
      const h = await harness();
      await h.open("paseo-1");
      await h.send(h.prompt("paseo-1", "a", "client-a"));
      await h.waitFor("session.turn", (event) => event.state === "started");
      h.daemon.handlers.getInteractionSnapshot = () =>
        interactionSnapshot({ pause: { requestId: "p-1", kind: "Triple", toolName: "Bash", message: "risky" } });
      h.daemon.handlers.replyInteractionChecked = () => ({ ok: false, error: "pause moved on" });
      await h.stream(DAEMON, toolCall("call-1", "Bash", { command: "rm -rf build" }), { type: "sessionStateChange", state: "paused" });
      await h.waitFor("session.permission");
      // @step When Paseo steers the turn with clearPendingPermissions
      const steer: ProviderInput = {
        type: "session.prompt",
        sessionId: "paseo-1",
        prompt: {
          clientMessageId: "client-s",
          delivery: "steer",
          input: { type: "message", content: [{ type: "text", text: "skip it" }] },
          clearPendingPermissions: true,
        },
      };
      await h.send(steer);
      // @step Then the session shows a warning notice "fspec could not deny the request blocking the steer" naming "pause moved on"
      expect((await notice(h, "paseo-1", "fspec could not deny the request blocking the steer")).description).toContain("pause moved on");
      // @step And the approval is not resolved
      expect(h.ofType("session.permission_resolved")).toEqual([]);
    });
  });

  describe("Scenario: A sub-agent active mark that cannot be cleared is reported on its parent", () => {
    it("shows the failure on the parent", async () => {
      // @step Given an open child session "paseo-1:sub:sub-9" that is fspec's active session, whose clear_active_session fails with "board busy"
      const h = await harness();
      await h.open("paseo-1");
      await h.send(h.prompt("paseo-1", "delegate"));
      await h.waitFor("session.turn", (event) => event.state === "started");
      h.daemon.handlers.getSupervisors = (request) =>
        request.method === "getSupervisors" && request.sessionId === "sub-9" ? [DAEMON] : [];
      await h.stream("sub-9", text("working"));
      await h.waitFor("session.opened", (event) => event.sessionId === "paseo-1:sub:sub-9");
      h.daemon.handlers.getActiveSession = () => "sub-9";
      h.daemon.handlers.clearActiveSession = () => {
        throw new Error("board busy");
      };
      // @step When the daemon reports "sub-9" removed
      h.daemon.pushEnvelope({ kind: "sessionEvent", event: { type: "removed", sessionId: "sub-9" } });
      // @step Then "paseo-1" shows a warning notice "fspec could not clear the closed sub-agent's active mark" naming "board busy"
      expect((await notice(h, "paseo-1", "fspec could not clear the closed sub-agent's active mark")).description).toContain("board busy");
    });
  });
});
