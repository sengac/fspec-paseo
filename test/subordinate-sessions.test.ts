/**
 * Feature: spec/features/fspec-subordinate-sessions.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { disposeHarnesses, harness, text, toolCall, toolResult } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

const PARENT = "fspec-sess-42";
const CHILD = "paseo-1:sub:sub-9";

/** paseo-1 spawns sub-9 with AgentManager call-9, then sub-9 streams "working". */
async function withChild() {
  const h = await harness();
  await h.open("paseo-1");
  await h.send(h.prompt("paseo-1", "delegate"));
  await h.waitFor("session.turn", (event) => event.state === "started");
  h.daemon.handlers.getSupervisors = (request) =>
    request.method === "getSupervisors" && request.sessionId === "sub-9" ? [PARENT] : [];
  await h.stream(
    PARENT,
    toolCall("call-9", "AgentManager", { action: "spawn", role: "Reviewer" }),
    toolResult("call-9", '{"status":"spawned","session_id":"sub-9"}'),
  );
  await h.stream("sub-9", text("working"));
  const opened = await h.waitFor("session.opened", (event) => event.sessionId === CHILD);
  return { h, opened };
}

describe("Feature: Show fspec subordinate agents as Paseo child sessions", () => {
  describe("Scenario: A spawned sub-agent opens as a Paseo child session", () => {
    it("opens the child under the parent and replays buffered output", async () => {
      // @step Given Paseo session "paseo-1" mapped to daemon session "fspec-sess-42" whose AgentManager tool call "call-9" returned a result mentioning "sub-9"
      // @step When the daemon streams a Text chunk "working" for daemon session "sub-9" whose supervisor is "fspec-sess-42"
      const { h, opened } = await withChild();
      // @step Then the provider emitted session.opened for "paseo-1:sub:sub-9" with parentSessionId "paseo-1", restoration parent and toolCallId "call-9", followed by session.config
      expect(opened).toMatchObject({ parentSessionId: "paseo-1", restoration: "parent", toolCallId: "call-9", cwd: "/work" });
      // Paseo only accepts children under a parent that negotiated session.subsession.
      const parentOpened = h.ofType("session.opened").find((event) => event.sessionId === "paseo-1")!;
      expect(parentOpened.capabilities).toContain("session.subsession");
      expect(h.connection.capabilities).toContain("session.subsession");
      const childEvents = h.events.filter((event) => "sessionId" in event && event.sessionId === CHILD);
      expect(childEvents[1]?.type).toBe("session.config");
      // @step And it published the buffered text "working" as an assistant_message in the child session
      await vi.waitFor(() =>
        expect(h.ofType("timeline.item").filter((event) => event.sessionId === CHILD).map((event) => event.item)).toEqual([
          expect.objectContaining({ type: "assistant_message", text: "working" }),
        ]),
      );
    });
  });

  describe("Scenario: Sessions driven by other clients are ignored", () => {
    it("looks up an unknown session once and ignores it", async () => {
      // @step Given an open Paseo session "paseo-1"
      const h = await harness();
      await h.open("paseo-1");
      const before = h.events.length;
      // @step When the daemon streams two chunks for daemon session "tui-5" whose supervisors are empty
      await h.stream("tui-5", text("a"), text("b"));
      await new Promise((resolve) => setTimeout(resolve, 10));
      // @step Then the provider called get_supervisors once for "tui-5" and emitted no event for it
      expect(h.daemon.sent("getSupervisors")).toEqual([{ method: "getSupervisors", sessionId: "tui-5" }]);
      expect(h.events.slice(before)).toEqual([]);
    });
  });

  describe("Scenario: A child session can be prompted", () => {
    it("sends input to the subordinate without creating or destroying it", async () => {
      // @step Given an open Paseo child session "paseo-1:sub:sub-9" for daemon session "sub-9"
      const { h } = await withChild();
      // @step When Paseo prompts the child with "status?"
      await h.send(h.prompt(CHILD, "status?"));
      // @step Then the provider sent send_input("sub-9", "status?") and never created or destroyed a daemon session for the child
      await vi.waitFor(() => expect(h.daemon.sent("sendInput").at(-1)).toEqual({ method: "sendInput", sessionId: "sub-9", text: "status?" }));
      expect(h.daemon.sent("createSessionChecked")).toHaveLength(1);
      expect(h.daemon.sent("destroySession")).toEqual([]);
    });
  });

  describe("Scenario: A removed sub-agent closes its child session", () => {
    it("closes the child on a removed session event", async () => {
      // @step Given an open Paseo child session "paseo-1:sub:sub-9" for daemon session "sub-9"
      const { h } = await withChild();
      // @step When the daemon reports session event removed for "sub-9"
      h.daemon.pushEnvelope({ kind: "sessionEvent", event: { type: "removed", sessionId: "sub-9" } });
      // @step Then the provider emitted session.closed for "paseo-1:sub:sub-9" and sent no destroy_session
      await h.waitFor("session.closed", (event) => event.sessionId === CHILD);
      expect(h.daemon.sent("destroySession")).toEqual([]);
    });
  });
});
