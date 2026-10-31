/**
 * Feature: spec/features/fspec-steer-and-queue.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ProviderInput } from "@getpaseo/plugin/server/provider";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as wire from "../server/wire.js";
import { interactionSnapshot } from "./support/fake-daemon.js";
import { disposeHarnesses, harness, toolCall } from "./support/provider-harness.js";

afterEach(disposeHarnesses);

const DAEMON = "fspec-sess-42";

function vector(name: string): string {
  const text = readFileSync(fileURLToPath(new URL("./golden/golden-vectors.txt", import.meta.url)), "utf8");
  const line = text.split("\n").find((entry) => entry.startsWith(`${name} `));
  if (line === undefined) throw new Error(`missing golden vector ${name}`);
  return line.slice(name.length + 1).trim();
}

function steer(text: string, clientMessageId: string, clearPendingPermissions?: boolean): ProviderInput {
  return {
    type: "session.prompt",
    sessionId: "paseo-1",
    prompt: {
      clientMessageId,
      delivery: "steer",
      input: { type: "message", content: [{ type: "text", text }] },
      ...(clearPendingPermissions === undefined ? {} : { clearPendingPermissions }),
    },
  };
}

async function running() {
  const h = await harness();
  await h.open("paseo-1");
  await h.send(h.prompt("paseo-1", "a", "client-a"));
  await h.waitFor("session.turn", (event) => event.turnId === "turn-1" && event.state === "started");
  return h;
}

type H = Awaited<ReturnType<typeof running>>;
const turns = (h: H) => h.ofType("session.turn").map((event) => `${event.turnId}:${event.state}`);
const result = async (h: H, clientMessageId: string) =>
  (await h.waitFor("session.prompt_result", (event) => event.clientMessageId === clientMessageId)).result;

describe("Feature: Steer and queue prompts through fspec's submit_input", () => {
  describe("Scenario: submit_input matches the daemon's encoding", () => {
    it("byte-matches the golden vectors", () => {
      // @step Given the Rust golden vectors for submit_input arguments with modes Queue and Steer and its Ok reply
      const index = "80000000";
      // @step When the codec encodes those requests and decodes the reply
      const hex = (message: wire.FspecServiceRequest) => Buffer.from(wire.encodeRequestFrame({ id: 0, message })).toString("hex");
      const queue = hex({ method: "submitInput", sessionId: "s-1", text: "next", mode: "queue" });
      const steered = hex({ method: "submitInput", sessionId: "s-1", text: "steer", mode: "steer" });
      const reply = wire.decodeResponseFrame(
        new Uint8Array(Buffer.from("0000000000000000" + "00000000" + index + vector("submit_input_ok"), "hex")),
      );
      // @step Then the request bytes after variant index 128 match the golden vectors exactly
      expect(wire.FspecMethodIndex.submitInput).toBe(128);
      expect(queue.endsWith(index + vector("submit_input_args_queue"))).toBe(true);
      expect(steered.endsWith(index + vector("submit_input_args_steer"))).toBe(true);
      // @step And the reply decodes to Ok
      expect(reply).toMatchObject({ ok: true, method: "submitInput", result: { ok: true } });
    });
  });

  describe("Scenario: The provider advertises steering", () => {
    it("negotiates prompt.steer", async () => {
      // @step Given Paseo offers every provider capability
      const h = await harness();
      // @step When the provider connects and opens an fspec session
      const opened = await h.open("paseo-1");
      // @step Then the connection's and the session's capabilities include "prompt.steer"
      expect(h.connection.capabilities).toContain("prompt.steer");
      expect(h.ofType("session.opened", opened)[0]!.capabilities).toContain("prompt.steer");
    });
  });

  describe("Scenario: A steered prompt joins the running turn", () => {
    it("submits a steer and reports it on the running turn", async () => {
      // @step Given an open fspec session whose turn "turn-1" is running
      const h = await running();
      // @step When Paseo sends "use the staging database" with delivery steer
      await h.send(steer("use the staging database", "client-s"));
      // @step Then the provider called submit_input with "use the staging database" and mode Steer
      // @step And it answered session.prompt_result steer for "turn-1" and started no new turn
      expect(await result(h, "client-s")).toEqual({ type: "steer", turnId: "turn-1" });
      expect(h.daemon.sent("submitInput")).toEqual([
        { method: "submitInput", sessionId: DAEMON, text: "use the staging database", mode: "steer" },
      ]);
      expect(h.daemon.sent("sendInput").map((request) => request.text)).toEqual(["a"]);
      expect(turns(h)).toEqual(["turn-1:started"]);
      // @step And the daemon's UserInput "use the staging database" became a user_message carrying the prompt's clientMessageId
      await h.stream(DAEMON, { type: "userInput", text: "use the staging database" });
      expect(h.items("user_message").at(-1)).toMatchObject({ text: "use the staging database", clientMessageId: "client-s" });
      await h.stream(DAEMON, { type: "done" });
      expect(turns(h)).toEqual(["turn-1:started", "turn-1:completed"]);
    });
  });

  describe("Scenario: A steer with no running turn fails", () => {
    it("fails the prompt without calling the daemon", async () => {
      // @step Given an open fspec session with no running turn
      const h = await harness();
      await h.open("paseo-1");
      // @step When Paseo sends "hello" with delivery steer
      await h.send(steer("hello", "client-s"));
      // @step Then the provider answered session.prompt_result failed and called no submit_input
      expect(await result(h, "client-s")).toMatchObject({ type: "failed" });
      expect(h.daemon.sent("submitInput")).toEqual([]);
      expect(h.ofType("session.turn")).toEqual([]);
    });
  });

  describe("Scenario: A steer the daemon rejects fails its prompt", () => {
    it("reports the daemon's error and keeps the turn", async () => {
      // @step Given an open fspec session whose turn "turn-1" is running and whose submit_input answers "Session not found: fspec-sess-42"
      const h = await running();
      h.daemon.handlers.submitInput = () => ({ ok: false, error: `Session not found: ${DAEMON}` });
      // @step When Paseo sends "use the staging database" with delivery steer
      await h.send(steer("use the staging database", "client-s"));
      // @step Then the provider answered session.prompt_result failed with "Session not found: fspec-sess-42"
      const failed = await result(h, "client-s");
      expect(failed).toMatchObject({ type: "failed" });
      expect(failed.type === "failed" && failed.error.message).toContain(`Session not found: ${DAEMON}`);
      // @step And "turn-1" is still running
      expect(turns(h)).toEqual(["turn-1:started"]);
    });
  });

  describe("Scenario: A steer with clearPendingPermissions denies the pause blocking it", () => {
    it("submits the steer, then denies the open approval", async () => {
      // @step Given an open fspec session whose running turn is paused on an approval shown in Paseo
      const h = await running();
      h.daemon.handlers.getInteractionSnapshot = () =>
        interactionSnapshot({ pause: { requestId: "p-1", kind: "Triple", toolName: "Bash", message: "risky" } });
      await h.stream(DAEMON, toolCall("call-1", "Bash", { command: "rm -rf build" }), { type: "sessionStateChange", state: "paused" });
      const shown = await h.waitFor("session.permission");
      // @step When Paseo sends "skip that command" with delivery steer and clearPendingPermissions
      await h.send(steer("skip that command", "client-s", true));
      // @step Then the provider called submit_input with mode Steer before denying the pause through reply_interaction_checked
      // @step And it emitted session.permission_resolved for the approval
      const resolved = await h.waitFor("session.permission_resolved");
      expect(resolved.permissionId).toBe(shown.request.id);
      const methods = h.daemon.requests.map((request) => request.method);
      expect(methods.indexOf("submitInput")).toBeLessThan(methods.indexOf("replyInteractionChecked"));
      expect(h.daemon.sent("replyInteractionChecked")).toEqual([
        { method: "replyInteractionChecked", sessionId: DAEMON, interaction: "pause_triple", requestId: "p-1", arguments: '{"choice":"Deny"}' },
      ]);
      expect(await result(h, "client-s")).toEqual({ type: "steer", turnId: "turn-1" });
    });
  });

  describe("Scenario: A steer the running turn never reached runs as its own turn", () => {
    it("starts an extra turn for the undelivered steer before the queued prompt", async () => {
      // @step Given an open fspec session with "turn-1" running, prompt "b" queued as "turn-2" and a steer "s" sent during "turn-1"
      const h = await running();
      await h.send(h.prompt("paseo-1", "b", "client-b"));
      await h.send(steer("s", "client-s"));
      await result(h, "client-s");
      await vi.waitFor(() => expect(h.daemon.sent("submitInput")).toHaveLength(2));
      // @step When the daemon completes "turn-1" and then echoes UserInput "s"
      await h.stream(DAEMON, { type: "userInput", text: "s" }, { type: "done" }, { type: "userInput", text: "s" });
      // @step Then the provider emitted completed for "turn-1" and started an extra turn "turn-3" for the steer
      expect(turns(h)).toEqual(["turn-1:started", "turn-1:completed", "turn-3:started"]);
      // @step And when that turn is done "turn-2" starts
      await h.stream(DAEMON, { type: "done" });
      expect(turns(h)).toEqual(["turn-1:started", "turn-1:completed", "turn-3:started", "turn-3:completed", "turn-2:started"]);
    });
  });
});
