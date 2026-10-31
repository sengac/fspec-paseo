/**
 * Feature: spec/features/fspec-session-lifecycle.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 *
 * Paseo is simulated as the host seam (real ProviderInput in, events parsed by
 * ProviderEventSchema out); the daemon is the wire-level fake from
 * test/support/fake-daemon.ts, so every RPC is a real encoded tarpc frame.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { disposeHarnesses, harness, type Event } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

describe("Feature: Drive the fspec session lifecycle from Paseo", () => {
  describe("Scenario: Opening a session creates and remembers the daemon session", () => {
    it("creates once, persists the daemon id, and reuses it on reopen", async () => {
      // @step Given Paseo opens a fresh fspec session without persistence
      const h = await harness();
      const opened = await h.open("paseo-1");
      // @step When the provider creates the daemon session via create_session and receives daemon id `fspec-sess-42`
      expect(h.daemon.sent("createSessionChecked")).toHaveLength(1);
      // @step Then the provider maps the daemon session id into the Paseo session
      const openedEvent = h.ofType("session.opened", opened)[0]!;
      // @step And the session's persistence is `{ version: 1, data: { sessionId: "fspec-sess-42" } }`
      expect(openedEvent.persistence).toMatchObject({ version: 1, data: { sessionId: "fspec-sess-42" } });
      // @step And reopening with that same persistence reuses the existing daemon session instead of creating a new one
      const reopened = await h.open("paseo-1-reopened", {}, openedEvent.persistence);
      expect(h.daemon.sent("createSessionChecked")).toHaveLength(1);
      expect(h.ofType("session.opened", reopened)[0]!.persistence).toMatchObject({
        data: { sessionId: "fspec-sess-42" },
      });
      await h.send(h.prompt("paseo-1-reopened", "hello"));
      await vi.waitFor(() => expect(h.daemon.sent("sendInput")).toHaveLength(1));
      expect(h.daemon.sent("sendInput")[0]!.sessionId).toBe("fspec-sess-42");
    });
  });

  describe("Scenario: A prompt is sent with send_input whatever the thinking level", () => {
    it("always sends send_input and leaves thinking to the daemon", async () => {
      // @step Given an open fspec session whose thinking level is Off
      const h = await harness();
      await h.open("paseo-1", { model: "anthropic/claude-sonnet-4", thinkingOption: "off" });
      // @step When the provider sends the prompt `fix the login bug` to the daemon
      await h.send(h.prompt("paseo-1", "fix the login bug"));
      // @step Then the provider sent `send_input(session_id, "fix the login bug")`
      await vi.waitFor(() => expect(h.daemon.sent("sendInput")).toHaveLength(1));
      expect(h.daemon.sent("sendInput")[0]).toEqual({
        method: "sendInput",
        sessionId: "fspec-sess-42",
        text: "fix the login bug",
      });
      // @step And prompting the same session after set_thinking_level High still sends `send_input(session_id, "fix the login bug")`, leaving the daemon to build the provider thinking settings
      h.daemon.push("fspec-sess-42", { type: "done" });
      await h.waitFor("session.turn", (event) => event.state === "completed");
      await h.send({
        type: "session.configure",
        requestId: h.next(),
        sessionId: "paseo-1",
        changes: { thinkingOption: "high" },
      });
      expect(h.daemon.sent("setThinkingLevel").at(-1)).toMatchObject({ level: "high" });
      await h.send(h.prompt("paseo-1", "fix the login bug"));
      await vi.waitFor(() => expect(h.daemon.sent("sendInput")).toHaveLength(2));
      expect(h.daemon.sent("sendInputWithThinking")).toEqual([]);
    });
  });

  describe("Scenario: A successful session.open emits the exact open event sequence", () => {
    it("emits opened, config, ready in order and exactly once", async () => {
      // @step Given Paseo opens an fspec session with `persist: true`, committed model `anthropic/claude-sonnet-4`, and thinking `high`
      const h = await harness();
      // @step When the provider completes the open
      const opened = await h.open("paseo-1", {
        persist: true,
        model: "anthropic/claude-sonnet-4",
        thinkingOption: "high",
      });
      // @step Then it emitted, in order and exactly once each: session.opened (requestId, sessionId, persistence, restoration `core`, committed config), session.config (committed model/thinking), session.commands (the fspec commands), session.ready (requestId, sessionId)
      expect(opened.map((event) => event.type)).toEqual([
        "session.opened",
        "session.config",
        "session.commands",
        "session.ready",
      ]);
      const [openedEvent, configEvent, , readyEvent] = opened as [
        Event<"session.opened">,
        Event<"session.config">,
        Event<"session.commands">,
        Event<"session.ready">,
      ];
      expect(openedEvent).toMatchObject({
        requestId: "open-1",
        sessionId: "paseo-1",
        restoration: "core",
        cwd: "/work",
        persistence: {
          version: 1,
          data: { sessionId: "fspec-sess-42", model: "anthropic/claude-sonnet-4", thinkingOption: "high" },
        },
      });
      expect(configEvent.config).toMatchObject({ model: "anthropic/claude-sonnet-4", thinkingOption: "high" });
      expect(readyEvent).toEqual({ type: "session.ready", requestId: "open-1", sessionId: "paseo-1" });
      // @step And no other open-time events were interleaved
      expect(opened).toHaveLength(4);
    });
  });

  describe("Scenario: Each prompt publishes one prompt result and one terminal turn", () => {
    it("mints a turn per prompt with exactly one terminal each", async () => {
      // @step Given an open fspec session with no active turn
      const h = await harness();
      await h.open("paseo-1");
      // @step When the provider accepts the first prompt
      await h.send(h.prompt("paseo-1", "first", "client-a"));
      await h.waitFor("session.turn", (event) => event.state === "started");
      // @step Then it minted turn `turn-1` and emitted exactly one session.prompt_result `{ result: { type: "turn", turnId: "turn-1" } }` followed by exactly one session.turn `{ turnId: "turn-1", state: "started" }`
      const results = h.ofType("session.prompt_result");
      expect(results).toEqual([
        {
          type: "session.prompt_result",
          sessionId: "paseo-1",
          clientMessageId: "client-a",
          result: { type: "turn", turnId: "turn-1" },
        },
      ]);
      expect(h.events.indexOf(results[0]!)).toBeLessThan(
        h.events.findIndex((event) => event.type === "session.turn"),
      );
      expect(h.ofType("session.turn")).toEqual([
        { type: "session.turn", sessionId: "paseo-1", turnId: "turn-1", state: "started" },
      ]);
      // @step And when the daemon stream yields the Done terminal chunk it emitted exactly one session.turn `{ turnId: "turn-1", state: "completed" }` and no further terminal for that turn
      h.daemon.push("fspec-sess-42", { type: "done" });
      await h.waitFor("session.turn", (event) => event.state === "completed");
      h.daemon.push("fspec-sess-42", { type: "done" });
      // @step And a second prompt minted a new turn `turn-2` and never re-emitted the terminal for `turn-1`
      await h.send(h.prompt("paseo-1", "second", "client-b"));
      await h.waitFor("session.turn", (event) => event.turnId === "turn-2" && event.state === "started");
      h.daemon.push("fspec-sess-42", { type: "done" });
      await h.waitFor("session.turn", (event) => event.turnId === "turn-2" && event.state === "completed");
      const terminals = h.ofType("session.turn").filter((event) => event.state !== "started");
      expect(terminals.map((event) => [event.turnId, event.state])).toEqual([
        ["turn-1", "completed"],
        ["turn-2", "completed"],
      ]);
      expect(h.ofType("session.prompt_result")).toHaveLength(2);
    });
  });

  describe("Scenario: Stop settles the turn via the daemon's terminal chunk", () => {
    it("completes the interrupt request first and cancels on the daemon chunk", async () => {
      // @step Given an open fspec session with an active turn running
      const h = await harness();
      await h.open("paseo-1");
      await h.send(h.prompt("paseo-1", "long task"));
      await h.waitFor("session.turn", (event) => event.state === "started");
      // @step When the user clicks Stop and the provider answers the session.interrupt input
      const requestId = h.next();
      const answer = await h.send({ type: "session.interrupt", requestId, sessionId: "paseo-1" });
      // @step Then the provider answered request.completed as soon as the stop was accepted and issued the daemon interrupt RPC for the session
      expect(answer).toEqual({ type: "request.completed", requestId });
      await vi.waitFor(() =>
        expect(h.daemon.sent("interrupt")).toEqual([{ method: "interrupt", sessionId: "fspec-sess-42" }]),
      );
      expect(h.ofType("session.turn").filter((event) => event.state !== "started")).toEqual([]);
      // @step And the turn's terminal session.turn `{ state: "canceled" }` event was driven by the daemon's Interrupted/InterruptedWithReason terminal chunk, not by the stop click itself
      h.daemon.push("fspec-sess-42", { type: "interruptedWithReason", queuedInputs: [], reason: "user" });
      const canceled = await h.waitFor("session.turn", (event) => event.state === "canceled");
      expect(canceled).toMatchObject({ turnId: "turn-1", sessionId: "paseo-1" });
      h.daemon.push("fspec-sess-42", { type: "interrupted", queuedInputs: [] });
      expect(h.ofType("session.turn").filter((event) => event.state !== "started")).toHaveLength(1);
    });
  });

  describe("Scenario: Opening applies the requested model and thinking after creation", () => {
    it("calls set_session_model then set_thinking_level after create_session", async () => {
      // @step Given Paseo opens an fspec session with model `anthropic/claude-sonnet-4` and thinkingOption `high`
      const h = await harness();
      // @step When the provider completes the open
      const opened = await h.open("paseo-1", { model: "anthropic/claude-sonnet-4", thinkingOption: "high" });
      // @step Then it called set_session_model(session_id, "anthropic", "claude-sonnet-4") then set_thinking_level(session_id, High) after create_session
      const sessionRpcs = h.daemon.requests.filter((request) =>
        ["createSessionChecked", "setSessionModel", "setThinkingLevel"].includes(request.method),
      );
      expect(sessionRpcs).toEqual([
        { method: "createSessionChecked", role: null },
        { method: "setSessionModel", sessionId: "fspec-sess-42", providerId: "anthropic", modelId: "claude-sonnet-4" },
        { method: "setThinkingLevel", sessionId: "fspec-sess-42", level: "high" },
      ]);
      // @step And the committed session.config reflects exactly those values
      expect(h.ofType("session.config", opened)[0]!.config).toMatchObject({
        model: "anthropic/claude-sonnet-4",
        thinkingOption: "high",
      });
      // @step And opening with model/thinking omitted falls back to the catalog defaults instead of inventing values
      const defaults = await h.open("paseo-2");
      expect(h.daemon.sent("setSessionModel").at(-1)).toEqual({
        method: "setSessionModel",
        sessionId: "fspec-sess-43",
        providerId: "anthropic",
        modelId: "claude-sonnet-4",
      });
      expect(h.daemon.sent("setThinkingLevel").at(-1)).toEqual({
        method: "setThinkingLevel",
        sessionId: "fspec-sess-43",
        level: "off",
      });
      expect(h.ofType("session.config", defaults)[0]!.config).toMatchObject({
        model: "anthropic/claude-sonnet-4",
        thinkingOption: "off",
      });
    });
  });

  describe("Scenario: Closing a session destroys it and answers the request", () => {
    it("destroys, emits closed then completed, and no-ops on unknown ids", async () => {
      // @step Given an open fspec session mapped to daemon id `fspec-sess-42`
      const h = await harness();
      await h.open("paseo-1");
      // @step When Paseo closes the session
      const requestId = h.next();
      const from = h.events.length;
      await h.send({ type: "session.close", requestId, sessionId: "paseo-1" });
      // @step Then the provider called destroy_session("fspec-sess-42"), removed it from the registry, and emitted session.closed followed by request.completed
      expect(h.daemon.sent("destroySession")).toEqual([{ method: "destroySession", sessionId: "fspec-sess-42" }]);
      expect(h.events.slice(from)).toEqual([
        { type: "session.closed", sessionId: "paseo-1" },
        { type: "request.completed", requestId },
      ]);
      // @step And closing an already-unknown or already-closed session id is a no-op that still answers request.completed, and the session no longer accepts prompts
      const again = h.next();
      expect(await h.send({ type: "session.close", requestId: again, sessionId: "paseo-1" })).toEqual({
        type: "request.completed",
        requestId: again,
      });
      expect(h.daemon.sent("destroySession")).toHaveLength(1);
      await expect(h.connection.send(h.prompt("paseo-1", "hello"))).rejects.toThrow(/Unknown session/);
    });
  });

  describe("Scenario: Configure applies a model or thinking change to one session only", () => {
    it("applies changes to the targeted session and publishes committed config", async () => {
      // @step Given an open fspec session
      const h = await harness();
      await h.open("paseo-1", { model: "anthropic/claude-sonnet-4" });
      await h.open("paseo-2", { model: "anthropic/claude-sonnet-4" });
      const before = h.daemon.requests.length;
      // @step When the provider receives session.configure with `changes.model = "openai/gpt-5"`
      const requestId = h.next();
      const from = h.events.length;
      await h.send({ type: "session.configure", requestId, sessionId: "paseo-1", changes: { model: "openai/gpt-5" } });
      // @step Then it called set_session_model(session_id, "openai", "gpt-5") for that session only
      expect(h.daemon.requests.slice(before)).toEqual([
        { method: "setSessionModel", sessionId: "fspec-sess-42", providerId: "openai", modelId: "gpt-5" },
      ]);
      // @step And it published the committed session.config reflecting the new model and answered request.completed
      const after = h.events.slice(from);
      expect(after.map((event) => event.type)).toEqual(["session.config", "request.completed"]);
      expect((after[0] as Event<"session.config">)).toMatchObject({
        sessionId: "paseo-1",
        config: { model: "openai/gpt-5" },
      });
      // @step And a `changes.thinkingOption = null` clears the thinking level via set_thinking_level Off
      await h.send({ type: "session.configure", requestId: h.next(), sessionId: "paseo-1", changes: { thinkingOption: null } });
      expect(h.daemon.sent("setThinkingLevel").at(-1)).toEqual({
        method: "setThinkingLevel",
        sessionId: "fspec-sess-42",
        level: "off",
      });
      expect(h.ofType("session.config").at(-1)!.config.thinkingOption).toBe("off");
    });
  });

  describe("Scenario: Inputs targeting an unknown session are rejected", () => {
    it("throws for prompts and fails request inputs, completing unknown closes", async () => {
      // @step Given a sessionId the provider never opened or has already closed
      const h = await harness();
      // @step When the provider receives a session.prompt for that sessionId
      const rejected = h.connection.send(h.prompt("ghost", "hello"));
      // @step Then it rejected the input synchronously with a clear `Unknown session` error and emitted no prompt_result or turn
      await expect(rejected).rejects.toThrow("Unknown session: ghost");
      expect(h.ofType("session.prompt_result")).toEqual([]);
      expect(h.ofType("session.turn")).toEqual([]);
      // @step And the equivalent session.interrupt, session.configure, and session.close inputs for that unknown id surface as request.failed with the same `Unknown session` error, while close of an unknown id is still answered as request.completed
      const interrupt = await h.send({ type: "session.interrupt", requestId: "i-1", sessionId: "ghost" });
      const configure = await h.send({ type: "session.configure", requestId: "c-1", sessionId: "ghost", changes: { model: "openai/gpt-5" } });
      const close = await h.send({ type: "session.close", requestId: "x-1", sessionId: "ghost" });
      expect(interrupt).toMatchObject({ type: "request.failed", requestId: "i-1", error: { message: "Unknown session: ghost" } });
      expect(configure).toMatchObject({ type: "request.failed", requestId: "c-1", error: { message: "Unknown session: ghost" } });
      expect(close).toEqual({ type: "request.completed", requestId: "x-1" });
      expect(h.daemon.sent("interrupt")).toEqual([]);
      expect(h.daemon.sent("setSessionModel")).toEqual([]);
    });
  });

  describe("Scenario: Closing the connection releases every open session", () => {
    it("destroys all sessions, swallows failures, and is idempotent", async () => {
      // @step Given the provider has 3 open fspec sessions mapped to daemon ids A, B, and C
      const h = await harness();
      const ids = ["A", "B", "C"];
      h.daemon.handlers.createSessionChecked = () => ({ ok: true, value: ids.shift()! });
      await h.open("paseo-a");
      await h.open("paseo-b");
      await h.open("paseo-c");
      h.daemon.handlers.destroySession = (request) => {
        if (request.method === "destroySession" && request.sessionId === "B") throw new Error("boom");
        return { ok: true, value: undefined };
      };
      const count = h.events.length;
      // @step When the provider connection is closed
      await expect(h.connection.close()).resolves.toBeUndefined();
      // @step Then destroy_session was issued for A, B, and C and the session registry was cleared
      expect(h.daemon.sent("destroySession").map((request) => request.sessionId).sort()).toEqual(["A", "B", "C"]);
      await expect(h.connection.send(h.prompt("paseo-a", "hello"))).rejects.toThrow(/closed/);
      // @step And close resolved without throwing even when one destroy failed, is idempotent on a second call, and emitted no events after close
      await expect(h.connection.close()).resolves.toBeUndefined();
      expect(h.daemon.sent("destroySession")).toHaveLength(3);
      h.daemon.push("A", { type: "done" });
      expect(h.events).toHaveLength(count);
    });
  });
});
