/**
 * Feature: spec/features/fspec-subordinate-close.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it } from "vitest";
import { disposeHarnesses, harness, text } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

const PARENT = "fspec-sess-42";
const CHILD = "paseo-1:sub:sub-9";

/** Wires the fake daemon's chain of command: subordinate -> its supervisors. */
async function withTree(supervisorsOf: Record<string, string[]>) {
  const h = await harness();
  await h.open("paseo-1");
  h.daemon.handlers.getSupervisors = (request) =>
    request.method === "getSupervisors" ? (supervisorsOf[request.sessionId] ?? []) : [];
  h.daemon.handlers.getSubordinates = (request) =>
    request.method === "getSubordinates"
      ? Object.keys(supervisorsOf).filter((id) => supervisorsOf[id]!.includes(request.sessionId))
      : [];
  return h;
}

const destroyed = (h: Awaited<ReturnType<typeof harness>>) =>
  h.daemon.sent("destroySession").map((request) => request.sessionId);

describe("Feature: Close fspec sub-agent sessions when their Paseo parent closes", () => {
  describe("Scenario: Closing a parent destroys its whole sub-agent tree", () => {
    it("destroys sub-agents deepest first, then the parent", async () => {
      // @step Given an open Paseo session "paseo-1" mapped to daemon session "fspec-sess-42" with child "paseo-1:sub:sub-9"
      // @step And daemon session "sub-9" is supervised by "fspec-sess-42" and supervises "sub-10"
      const h = await withTree({ "sub-9": [PARENT], "sub-10": ["sub-9"] });
      await h.stream("sub-9", text("working"));
      await h.waitFor("session.opened", (event) => event.sessionId === CHILD);
      // @step When Paseo closes "paseo-1"
      await h.send({ type: "session.close", requestId: "close-1", sessionId: "paseo-1" });
      // @step Then the provider sent destroy_session for "sub-10", then "sub-9", then "fspec-sess-42"
      expect(destroyed(h)).toEqual(["sub-10", "sub-9", PARENT]);
      // @step And it emitted session.closed for "paseo-1:sub:sub-9" and "paseo-1"
      expect(h.ofType("session.closed").map((event) => event.sessionId)).toEqual([CHILD, "paseo-1"]);
    });
  });

  describe("Scenario: A sub-agent shared with another supervisor is left running", () => {
    it("destroys only the parent", async () => {
      // @step Given an open Paseo session "paseo-1" mapped to daemon session "fspec-sess-42"
      // @step And daemon session "sub-9" is supervised by "fspec-sess-42" and "tui-5"
      const h = await withTree({ "sub-9": [PARENT, "tui-5"], "sub-10": ["sub-9"] });
      // @step When Paseo closes "paseo-1"
      await h.send({ type: "session.close", requestId: "close-1", sessionId: "paseo-1" });
      // @step Then the provider sent destroy_session only for "fspec-sess-42"
      expect(destroyed(h)).toEqual([PARENT]);
    });
  });

  describe("Scenario: A failed sub-agent destroy does not stop the parent closing", () => {
    it("still destroys and closes the parent", async () => {
      // @step Given an open Paseo session "paseo-1" mapped to daemon session "fspec-sess-42"
      // @step And daemon session "sub-9" is supervised by "fspec-sess-42" and its destroy_session fails
      const h = await withTree({ "sub-9": [PARENT] });
      h.daemon.handlers.destroySession = (request) =>
        request.method === "destroySession" && request.sessionId === "sub-9"
          ? { ok: false, error: "busy" }
          : { ok: true, value: undefined };
      // @step When Paseo closes "paseo-1"
      const settled = await h.send({ type: "session.close", requestId: "close-1", sessionId: "paseo-1" });
      // @step Then the provider sent destroy_session for "fspec-sess-42" and emitted session.closed for "paseo-1"
      expect(destroyed(h)).toEqual(["sub-9", PARENT]);
      expect(settled?.type).toBe("request.completed");
      expect(h.ofType("session.closed").map((event) => event.sessionId)).toEqual(["paseo-1"]);
    });
  });

  describe("Scenario: Provider shutdown destroys sub-agents too", () => {
    it("cleans up the tree on close of the connection", async () => {
      // @step Given an open Paseo session "paseo-1" mapped to daemon session "fspec-sess-42"
      // @step And daemon session "sub-9" is supervised by "fspec-sess-42"
      const h = await withTree({ "sub-9": [PARENT] });
      // @step When the provider shuts down
      await h.connection.close();
      // @step Then the provider sent destroy_session for "sub-9" and "fspec-sess-42"
      expect(destroyed(h)).toEqual(["sub-9", PARENT]);
    });
  });
});
