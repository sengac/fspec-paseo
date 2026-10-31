/**
 * Feature: spec/features/fspec-session-commands.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderInput } from "@getpaseo/plugin/server/provider";
import * as wire from "../server/wire.js";
import { disposeHarnesses, harness } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

const DAEMON = "fspec-sess-42";
let message = 0;

function command(name: string, args = ""): ProviderInput {
  return {
    type: "session.prompt",
    sessionId: "paseo-1",
    prompt: { clientMessageId: `cmd-${++message}`, delivery: "auto", input: { type: "command", name, arguments: args } },
  };
}

async function opened() {
  const h = await harness();
  await h.open("paseo-1");
  return h;
}

/** Sends a command and returns its prompt_result. */
async function run(h: Awaited<ReturnType<typeof opened>>, name: string, args = "") {
  const input = command(name, args) as Extract<ProviderInput, { type: "session.prompt" }>;
  await h.send(input);
  return h.waitFor("session.prompt_result", (event) => event.clientMessageId === input.prompt.clientMessageId);
}

function vector(name: string): string {
  const text = readFileSync(fileURLToPath(new URL("./golden/golden-vectors.txt", import.meta.url)), "utf8");
  return text.split("\n").find((line) => line.startsWith(`${name} `))!.slice(name.length + 1).trim();
}

describe("Feature: Offer fspec session commands in the Paseo composer", () => {
  describe("Scenario: Opening a session publishes the fspec commands", () => {
    it("publishes the commands between config and ready", async () => {
      // @step Given the fspec daemon is reachable
      const h = await harness();
      // @step When Paseo opens an fspec session
      const events = await h.open("paseo-1");
      // @step Then the provider published session.commands with compact, clear, continue, goal and focus after session.config and before session.ready
      expect(events.map((event) => event.type)).toEqual(["session.opened", "session.config", "session.commands", "session.ready"]);
      const commands = h.ofType("session.commands")[0]!.commands;
      expect(commands.map((entry) => entry.name)).toEqual(["compact", "clear", "continue", "goal", "focus"]);
      expect(commands.find((entry) => entry.name === "focus")).toMatchObject({ argumentHint: "<work-unit-id|none>" });
    });
  });

  describe("Scenario: Compact reports the token savings without a turn", () => {
    it("compacts and reports", async () => {
      // @step Given an open fspec session
      const h = await opened();
      // @step When Paseo sends the command /compact
      const result = await run(h, "compact");
      // @step Then the provider called compact_session, answered prompt_result completed and published a notice "Compacted 90000 -> 30000 tokens"
      expect(h.daemon.sent("compactSession")).toEqual([{ method: "compactSession", sessionId: DAEMON }]);
      expect(result.result).toEqual({ type: "completed" });
      expect(h.ofType("session.notice").at(-1)!.notice).toMatchObject({ severity: "info", title: "Compacted 90000 -> 30000 tokens" });
      // @step And no session.turn was emitted
      expect(h.ofType("session.turn")).toEqual([]);
    });
  });

  describe("Scenario: Continue mirrors the fspec TUI", () => {
    it("sets the budget and refuses off while a goal is active", async () => {
      // @step Given an open fspec session without a goal
      const h = await opened();
      // @step When Paseo sends /continue 25
      const set = await run(h, "continue", "25");
      // @step Then the provider called set_continue_state(session, true, 25) and answered completed
      expect(h.daemon.sent("setContinueState")).toEqual([{ method: "setContinueState", sessionId: DAEMON, enabled: true, budget: 25 }]);
      expect(set.result).toEqual({ type: "completed" });
      // @step And with goal "ship" active, /continue off is answered failed "auto-continue: a goal is active — clear the goal first (/goal clear)"
      h.daemon.handlers.getGoalState = () => ({ text: "ship", verify: null });
      const off = await run(h, "continue", "off");
      expect(off.result).toEqual({ type: "failed", error: { message: "auto-continue: a goal is active — clear the goal first (/goal clear)" } });
      expect(h.daemon.sent("setContinueState")).toHaveLength(1);
    });
  });

  describe("Scenario: Goal sets, verifies and clears the session goal", () => {
    it("writes the goal state", async () => {
      // @step Given an open fspec session
      const h = await opened();
      // @step When Paseo sends /goal ship, then /goal verify npm test, then /goal clear
      await run(h, "goal", "ship");
      h.daemon.handlers.getGoalState = () => ({ text: "ship", verify: null });
      await run(h, "goal", "verify npm test");
      await run(h, "goal", "clear");
      // @step Then the provider called set_goal_state with ("ship", none), then ("ship", "npm test"), then none
      expect(h.daemon.sent("setGoalState").map((request) => request.goal)).toEqual([
        { text: "ship", verify: null },
        { text: "ship", verify: "npm test" },
        null,
      ]);
    });
  });

  describe("Scenario: Focus sets the work unit the agent works on", () => {
    it("sets and clears the focus", async () => {
      // @step Given an open fspec session
      const h = await opened();
      // @step When Paseo sends /focus FSPEC-001 and then /focus none
      await run(h, "focus", "FSPEC-001");
      await run(h, "focus", "none");
      // @step Then the provider called set_work_unit_focus(session, "FSPEC-001", "paseo") and then set_work_unit_focus(session, none, "paseo")
      expect(h.daemon.sent("setWorkUnitFocus")).toEqual([
        { method: "setWorkUnitFocus", sessionId: DAEMON, workUnitId: "FSPEC-001", source: "paseo" },
        { method: "setWorkUnitFocus", sessionId: DAEMON, workUnitId: null, source: "paseo" },
      ]);
    });
  });

  describe("Scenario: Clear and unknown commands", () => {
    it("clears history and rejects unknown commands", async () => {
      // @step Given an open fspec session
      const h = await opened();
      // @step When Paseo sends /clear and then /bogus
      const cleared = await run(h, "clear");
      const bogus = await run(h, "bogus");
      // @step Then the provider called clear_history and answered completed for /clear
      expect(h.daemon.sent("clearHistory")).toEqual([{ method: "clearHistory", sessionId: DAEMON }]);
      expect(cleared.result).toEqual({ type: "completed" });
      // @step And it answered /bogus with prompt_result failed "Unknown fspec command /bogus"
      expect(bogus.result).toEqual({ type: "failed", error: { message: "Unknown fspec command /bogus" } });
      await vi.waitFor(() => expect(h.ofType("session.turn")).toEqual([]));
    });
  });

  describe("Scenario: Command RPCs match the daemon's encoding", () => {
    it("byte-matches the golden vectors", () => {
      // @step Given bincode golden vectors for the continue, goal and focus arguments and replies
      const tail = (message: wire.FspecServiceRequest) => Buffer.from(wire.encodeRequestFrame({ id: 0, message })).toString("hex");
      const reply = (index: number, payload: string) =>
        wire.decodeResponseFrame(new Uint8Array(Buffer.from("0000000000000000" + "00000000" + index.toString(16).padStart(2, "0") + "000000" + payload, "hex")));
      // @step When the codec encodes the requests and decodes the replies
      const continueArgs = tail({ method: "setContinueState", sessionId: "s", enabled: true, budget: 25 });
      const goalArgs = tail({ method: "setGoalState", sessionId: "s", goal: { text: "ship", verify: "npm test" } });
      const focusArgs = tail({ method: "setWorkUnitFocus", sessionId: "s", workUnitId: "FSPEC-001", source: "paseo" });
      // @step Then the bytes match the golden vectors
      expect(continueArgs.endsWith("28000000" + vector("set_continue_args"))).toBe(true);
      expect(goalArgs.endsWith("2a000000" + vector("set_goal_args"))).toBe(true);
      expect(focusArgs.endsWith("39000000" + vector("set_focus_args"))).toBe(true);
      expect(reply(0x29, vector("continue_state"))).toMatchObject({ method: "getContinueState", state: { enabled: true, budget: 25 } });
      expect(reply(0x2b, vector("goal_state"))).toMatchObject({ method: "getGoalState", goal: { text: "ship", verify: "npm test" } });
    });
  });
});
