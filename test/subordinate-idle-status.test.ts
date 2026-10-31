/**
 * Feature: spec/features/fspec-subordinate-idle-status.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it } from "vitest";
import type * as wire from "../server/wire.js";
import { disposeHarnesses, harness, text } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

const PARENT = "fspec-sess-42";
const CHILD = "paseo-1:sub:sub-9";
const done: wire.StreamChunk = { type: "done" };

async function withParent() {
  const h = await harness();
  await h.open("paseo-1");
  h.daemon.handlers.getSupervisors = (request) =>
    request.method === "getSupervisors" && request.sessionId === "sub-9" ? [PARENT] : [];
  return h;
}

/** sub-9 runs once ("working", then done) and is now idle. */
async function idleChild() {
  const h = await withParent();
  await h.stream("sub-9", text("working"));
  await h.waitFor("session.opened", (event) => event.sessionId === CHILD);
  await h.stream("sub-9", done);
  await h.waitFor("session.turn", (event) => event.sessionId === CHILD && event.state === "completed");
  return h;
}

/** session.turn events and timeline items of the child, as compact strings in order. */
function childLog(h: Awaited<ReturnType<typeof harness>>): string[] {
  return h.events.flatMap((event) => {
    if (!("sessionId" in event) || event.sessionId !== CHILD) return [];
    if (event.type === "session.turn") return [`turn ${event.state} ${event.turnId}`];
    if (event.type === "timeline.item" && event.item.type === "assistant_message") return [`text ${event.item.text}`];
    return [];
  });
}

describe("Feature: Show idle fspec sub-agents as finished in Paseo", () => {
  describe("Scenario: A sub-agent's run settles when it goes idle", () => {
    it("wraps the supervisor-driven run in a started/completed turn", async () => {
      // @step Given an open Paseo session "paseo-1" mapped to daemon session "fspec-sess-42"
      const h = await withParent();
      // @step When the daemon streams a Text chunk "working" for sub-agent "sub-9" supervised by "fspec-sess-42", then a done chunk
      await h.stream("sub-9", text("working"));
      await h.waitFor("session.opened", (event) => event.sessionId === CHILD);
      await h.stream("sub-9", done);
      await h.waitFor("session.turn", (event) => event.sessionId === CHILD && event.state === "completed");
      // @step Then the child "paseo-1:sub:sub-9" received session.turn started "turn-1" before the assistant text
      // @step And it received session.turn completed "turn-1" after it
      expect(childLog(h)).toEqual(["turn started turn-1", "text working", "turn completed turn-1"]);
    });
  });

  describe("Scenario: Each new supervisor-driven run of an idle sub-agent is its own turn", () => {
    it("starts and completes a second turn", async () => {
      // @step Given an open Paseo child session "paseo-1:sub:sub-9" whose turn "turn-1" completed
      const h = await idleChild();
      // @step When the daemon streams a userInput chunk and then a done chunk for "sub-9"
      await h.stream("sub-9", { type: "userInput", text: "review FSPEC-030" }, done);
      await h.waitFor("session.turn", (event) => event.sessionId === CHILD && event.turnId === "turn-2" && event.state === "completed");
      // @step Then the child received session.turn started "turn-2" and then session.turn completed "turn-2"
      expect(childLog(h).filter((line) => line.startsWith("turn"))).toEqual([
        "turn started turn-1",
        "turn completed turn-1",
        "turn started turn-2",
        "turn completed turn-2",
      ]);
    });
  });

  describe("Scenario: Non-work chunks do not mark an idle sub-agent running", () => {
    it("ignores token updates for turn tracking", async () => {
      // @step Given an open Paseo child session "paseo-1:sub:sub-9" whose turn "turn-1" completed
      const h = await idleChild();
      const before = h.ofType("session.turn").length;
      // @step When the daemon streams a tokenUpdate chunk for "sub-9"
      await h.stream("sub-9", {
        type: "tokenUpdate",
        tokens: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          tokensPerSecond: null,
          cumulativeBilledInput: null,
          cumulativeBilledOutput: null,
          reasoningTokens: null,
        },
      });
      await h.waitFor("session.usage", (event) => event.sessionId === CHILD);
      // @step Then the child received no further session.turn
      expect(h.ofType("session.turn")).toHaveLength(before);
    });
  });

  describe("Scenario: Owned sessions start turns only from Paseo prompts", () => {
    it("publishes unprompted output without a turn", async () => {
      // @step Given an open Paseo session "paseo-1" mapped to daemon session "fspec-sess-42"
      const h = await withParent();
      // @step When the daemon streams a Text chunk "hello" for "fspec-sess-42" without a Paseo prompt
      await h.stream(PARENT, text("hello"));
      await h.waitFor("timeline.item", (event) => event.sessionId === "paseo-1");
      // @step Then the provider emitted no session.turn for "paseo-1"
      expect(h.ofType("session.turn").filter((event) => event.sessionId === "paseo-1")).toEqual([]);
    });
  });
});
