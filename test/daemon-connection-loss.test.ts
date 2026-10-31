/**
 * Feature: spec/features/fspec-daemon-connection-loss.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { disposeHarnesses, harness, toolCall } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

const DAEMON = "fspec-sess-42";

describe("Feature: Fail open sessions when the daemon connection is lost", () => {
  describe("Scenario: A dropped connection fails the running session after terminalizing its rows", () => {
    it("cancels running rows, then emits one runtime failure and no turn terminal", async () => {
      // @step Given an open fspec session whose turn "turn-1" has a running tool call "call-1"
      const h = await harness();
      await h.open("paseo-1");
      await h.send(h.prompt("paseo-1", "go"));
      await h.waitFor("session.turn", (event) => event.state === "started");
      await h.stream(DAEMON, toolCall("call-1", "Bash", { command: "sleep 100" }));
      const socket = h.daemon.sockets.at(-1)!;
      // @step When the daemon socket closes with code 1001
      socket.close(1001);
      // @step Then the provider re-published "tool:call-1" with status canceled
      const failure = await h.waitFor("session.runtime_failed");
      const canceled = h.ofType("timeline.item").find(
        (event) => event.item.type === "tool_call" && event.item.status === "canceled",
      );
      expect(canceled?.item).toMatchObject({ id: "tool:call-1" });
      // @step And it then emitted one session.runtime_failed whose error says the fspec daemon connection was lost and to reopen the session
      expect(h.events.indexOf(canceled!)).toBeLessThan(h.events.indexOf(failure));
      expect(h.ofType("session.runtime_failed")).toHaveLength(1);
      expect(failure).toMatchObject({ sessionId: "paseo-1" });
      expect(failure.error.message).toMatch(/fspec daemon connection was lost: server going away \(close 1001\)/);
      expect(failure.error.message).toMatch(/reopen the session/);
      // @step And it emitted no session.turn for "turn-1", even when a late Done chunk arrives
      socket.readyState = 1;
      socket.serverFrame({ kind: "event", sessionId: DAEMON, chunk: { type: "done" } });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(h.ofType("session.turn").filter((event) => event.state !== "started")).toEqual([]);
    });
  });

  describe("Scenario: Idle sessions are failed too", () => {
    it("fails an idle session on the drop", async () => {
      // @step Given an open fspec session with no active turn
      const h = await harness();
      await h.open("paseo-1");
      // @step When the daemon socket closes with code 1001
      h.daemon.sockets.at(-1)!.close(1001);
      // @step Then the provider emitted one session.runtime_failed for that session
      await h.waitFor("session.runtime_failed");
      expect(h.ofType("session.runtime_failed").map((event) => event.sessionId)).toEqual(["paseo-1"]);
    });
  });

  describe("Scenario: A failed session can be reopened and resumed", () => {
    it("rejects prompts, then reopens through a new socket and resumes", async () => {
      // @step Given a session that was failed by a dropped daemon connection
      const h = await harness();
      const opened = await h.open("paseo-1");
      const persistence = h.ofType("session.opened", opened)[0]!.persistence!;
      h.daemon.sockets.at(-1)!.close(1001);
      await h.waitFor("session.runtime_failed");
      // @step When Paseo sends a prompt to it
      const prompt = h.connection.send(h.prompt("paseo-1", "hello?"));
      // @step Then the prompt is rejected with Unknown session
      await expect(prompt).rejects.toThrow("Unknown session: paseo-1");
      // @step And reopening it with its persistence opens a new daemon socket, calls resume_session for the saved daemon id and reaches session.ready
      const sockets = h.daemon.sockets.length;
      await h.send({ type: "session.close", requestId: h.next(), sessionId: "paseo-1" });
      const reopened = await h.open("paseo-1", {}, persistence);
      expect(h.daemon.sockets.length).toBe(sockets + 1);
      expect(h.daemon.sent("resumeSession")).toEqual([{ method: "resumeSession", sessionId: DAEMON }]);
      expect(reopened.at(-1)).toMatchObject({ type: "session.ready", sessionId: "paseo-1" });
      await h.send(h.prompt("paseo-1", "back"));
      await vi.waitFor(() => expect(h.daemon.sent("sendInput")).toHaveLength(1));
    });
  });
});
