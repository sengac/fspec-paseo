/**
 * Feature: spec/features/fspec-default-model.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runWrite } from "../client/settings-actions.js";
import { defaultModelChoice } from "../client/settings-model.js";
import { createSettingsFeed } from "../server/settings.js";
import * as wire from "../server/wire.js";
import { FakeDaemon, daemonOptions, tempHome } from "./support/fake-daemon.js";
import { CATALOG, disposeHarnesses, harness, type Event } from "./support/provider-harness.js";

const disposers: Array<() => unknown> = [];
afterEach(async () => {
  await disposeHarnesses();
  for (const dispose of disposers.splice(0)) await dispose();
});

function vector(name: string): string {
  const text = readFileSync(fileURLToPath(new URL("./golden/golden-vectors.txt", import.meta.url)), "utf8");
  const line = text.split("\n").find((entry) => entry.startsWith(`${name} `));
  if (line === undefined) throw new Error(`missing golden vector ${name}`);
  return line.slice(name.length + 1).trim();
}

/** Decodes a successful tarpc Response carrying the given service payload. */
function reply(variant: number, payload: string): wire.DecodedResponse {
  const index = Buffer.from(new Uint32Array([variant]).buffer).toString("hex");
  return wire.decodeResponseFrame(new Uint8Array(Buffer.from("0000000000000000" + "00000000" + index + payload, "hex")));
}

async function failedOpen(h: Awaited<ReturnType<typeof harness>>, config: { model?: string }): Promise<Event<"request.failed">> {
  await h.connection.send({
    type: "session.open",
    requestId: "o-1",
    sessionId: "paseo-1",
    config: { cwd: "/work", env: {}, mcpServers: {}, settings: {}, persist: true, ...config },
    history: "skip",
  });
  return h.waitFor("request.failed", (event) => event.requestId === "o-1");
}

async function catalogWith(defaultModel: string | null) {
  const h = await harness();
  h.daemon.handlers.getDefaultModel = () => defaultModel;
  await h.send({ type: "catalog", requestId: "catalog-1" });
  const event = h.ofType("catalog").find((entry) => entry.requestId === "catalog-1")!;
  return event.catalog;
}

describe("Feature: Follow fspec's default model in Paseo", () => {
  describe("Scenario: get_default_model matches the daemon's encoding", () => {
    it("decodes both replies and encodes the request", () => {
      // @step Given the Rust golden vectors for get_default_model answering "anthropic/claude-sonnet-4" and answering nothing
      const some = vector("default_model_some");
      const none = vector("default_model_none");
      // @step When the codec decodes those replies and encodes a get_default_model request
      const decodedSome = reply(127, some);
      const decodedNone = reply(127, none);
      const request = Buffer.from(wire.encodeRequestFrame({ id: 0, message: { method: "getDefaultModel" } })).toString("hex");
      // @step Then the replies decode to the model "anthropic/claude-sonnet-4" and to no model
      expect(decodedSome).toMatchObject({ method: "getDefaultModel", model: "anthropic/claude-sonnet-4" });
      expect(decodedNone).toMatchObject({ method: "getDefaultModel", model: null });
      expect(Buffer.from(wire.encodeResponseFrame({ requestId: 0, message: "getDefaultModel", value: "anthropic/claude-sonnet-4" }).subarray(16)).toString("hex")).toBe(some);
      // @step And the request is variant index 127 with no argument bytes
      expect(wire.FspecMethodIndex.getDefaultModel).toBe(127);
      expect(request.endsWith("7f000000")).toBe(true);
    });
  });

  describe("Scenario: The catalog marks fspec's default model as the default", () => {
    it("uses fspec's default model as the catalog default", async () => {
      // @step Given fspec's default model is "openai/gpt-5" and the catalog lists "anthropic/claude-sonnet-4" then "openai/gpt-5"
      // @step When Paseo asks the provider for its catalog
      const catalog = await catalogWith("openai/gpt-5");
      // @step Then the catalog's defaultModel is "openai/gpt-5" and only that model is marked isDefault
      expect(catalog.models.map((model) => model.id)).toEqual(["anthropic/claude-sonnet-4", "openai/gpt-5"]);
      expect(catalog.defaultModel).toBe("openai/gpt-5");
      expect(catalog.models.filter((model) => model.isDefault).map((model) => model.id)).toEqual(["openai/gpt-5"]);
    });
  });

  describe("Scenario: A default the catalog does not list leaves the catalog without a default", () => {
    it("never makes the first listed model the default", async () => {
      // @step Given fspec's default model is "gone/old-model" and the catalog lists "anthropic/claude-sonnet-4" then "openai/gpt-5"
      // @step When Paseo asks the provider for its catalog
      const catalog = await catalogWith("gone/old-model");
      // @step Then the catalog has no defaultModel and no model is marked isDefault
      expect(catalog.models.map((model) => model.id)).toEqual(["anthropic/claude-sonnet-4", "openai/gpt-5"]);
      expect(catalog.defaultModel).toBeUndefined();
      expect(catalog.models.filter((model) => model.isDefault)).toEqual([]);
    });
  });

  describe("Scenario: An agent opened without a model follows fspec's default model", () => {
    it("applies fspec's default model to the new session", async () => {
      // @step Given fspec's default model is "openai/gpt-5"
      const h = await harness();
      h.daemon.handlers.getDefaultModel = () => "openai/gpt-5";
      // @step When Paseo opens an fspec agent with no model and no saved model
      const opened = await h.open("paseo-1");
      // @step Then the provider set the session's model to provider "openai" and model "gpt-5"
      expect(h.daemon.sent("setSessionModel")).toEqual([
        { method: "setSessionModel", sessionId: "fspec-sess-42", providerId: "openai", modelId: "gpt-5" },
      ]);
      // @step And the committed session.config model is "openai/gpt-5"
      expect(h.ofType("session.config", opened)[0]!.config.model).toBe("openai/gpt-5");
      // @step And fspec's default model was not changed
      expect(h.daemon.sent("setDefaultModel")).toEqual([]);
    });
  });

  describe("Scenario: With no default model an agent with a chosen model fails to open", () => {
    it("fails before creating anything and never writes fspec's default", async () => {
      // @step Given fspec has no default model
      const h = await harness();
      h.daemon.handlers.getDefaultModel = () => null;
      // @step When Paseo opens an fspec agent with model "openai/gpt-5"
      const failed = await failedOpen(h, { model: "openai/gpt-5" });
      // @step Then the open fails with "fspec has no default model — fspec starts every session on its default model, so set one under fspec providers before opening openai/gpt-5"
      expect(failed.error.message).toBe(
        "fspec has no default model — fspec starts every session on its default model, so set one under fspec providers before opening openai/gpt-5",
      );
      // @step And the provider sent no set_default_model and created no session
      expect(h.daemon.sent("setDefaultModel")).toEqual([]);
      expect(h.daemon.sent("createSessionChecked")).toEqual([]);
      expect(h.daemon.sent("createSessionInWorkspace")).toEqual([]);
    });
  });

  describe("Scenario: With no default model an agent without a model fails with what to do", () => {
    it("fails the open naming both fixes", async () => {
      // @step Given fspec has no default model
      const h = await harness();
      h.daemon.handlers.getDefaultModel = () => null;
      // @step When Paseo opens an fspec agent with no model
      const failed = await failedOpen(h, {});
      // @step Then the open fails with "fspec has no default model — choose a model for this agent and set fspec's default model under fspec providers"
      expect(failed.error.message).toBe(
        "fspec has no default model — choose a model for this agent and set fspec's default model under fspec providers",
      );
      // @step And the provider sent no set_default_model, no create_session_checked and no set_session_model
      expect(h.daemon.sent("setDefaultModel")).toEqual([]);
      expect(h.daemon.sent("createSessionChecked")).toEqual([]);
      expect(h.daemon.sent("setSessionModel")).toEqual([]);
    });
  });

  describe("Scenario: A resumed session keeps its own model when none is chosen", () => {
    it("resumes without switching the model", async () => {
      // @step Given fspec's default model is "openai/gpt-5" and a saved session "fspec-sess-7" whose persistence names no model
      const h = await harness();
      h.daemon.handlers.getDefaultModel = () => "openai/gpt-5";
      // @step When Paseo reopens it with no model
      await h.open("paseo-1", {}, { version: 1, data: { sessionId: "fspec-sess-7" } });
      // @step Then the provider resumed "fspec-sess-7" and sent no set_session_model
      expect(h.daemon.sent("resumeSession")).toEqual([{ method: "resumeSession", sessionId: "fspec-sess-7" }]);
      expect(h.daemon.sent("setSessionModel")).toEqual([]);
    });
  });

  describe("Scenario: Resetting an agent's model follows fspec's current default", () => {
    it("applies the current default and fails without one", async () => {
      // @step Given an open fspec agent and fspec's default model is now "openai/gpt-5"
      const h = await harness();
      await h.open("paseo-1");
      h.daemon.handlers.getDefaultModel = () => "openai/gpt-5";
      const before = h.daemon.sent("setSessionModel").length;
      // @step When Paseo resets the agent's model to the default, and later resets it again after fspec's default model was cleared
      const first = await h.send({ type: "session.configure", requestId: "c-1", sessionId: "paseo-1", changes: { model: null } });
      h.daemon.handlers.getDefaultModel = () => null;
      const second = await h.send({ type: "session.configure", requestId: "c-2", sessionId: "paseo-1", changes: { model: null } });
      // @step Then the first reset set the session's model to provider "openai" and model "gpt-5"
      expect(first).toMatchObject({ type: "request.completed" });
      expect(h.daemon.sent("setSessionModel").slice(before)).toEqual([
        { method: "setSessionModel", sessionId: "fspec-sess-42", providerId: "openai", modelId: "gpt-5" },
      ]);
      // @step And the second fails with "fspec has no default model to reset to — choose a model"
      expect(second).toMatchObject({ type: "request.failed", error: { message: "fspec has no default model to reset to — choose a model" } });
    });
  });

  describe("Scenario: The settings screen shows and changes fspec's default model", () => {
    it("lists the default, offers the models and writes the new default", async () => {
      // @step Given fspec's default model is "anthropic/claude-sonnet-4" and the reachable models are "anthropic/claude-sonnet-4" and "openai/gpt-5"
      const home = tempHome();
      home.writeDaemonEntry();
      const daemon = new FakeDaemon();
      daemon.handlers.listProviders = () => CATALOG;
      daemon.handlers.listProviderCredentials = () => [];
      daemon.handlers.getDefaultModel = () => "anthropic/claude-sonnet-4";
      const feed = createSettingsFeed(daemonOptions(home, daemon));
      disposers.push(home.dispose, () => feed.close());
      // @step When the settings list is loaded and the user chooses "openai/gpt-5" as the default model
      const listed = await feed.list({});
      if (listed.state !== "ready") throw new Error(listed.reason);
      const choice = defaultModelChoice(listed);
      const reload = vi.fn(async () => {});
      const refreshPaseo = vi.fn(async () => ({}));
      const outcome = await runWrite({ write: () => feed.setDefaultModel({ model: "openai/gpt-5" }), reload, refreshPaseo });
      // @step Then the Default model row shows "anthropic/claude-sonnet-4" and offers both models
      expect(listed.defaultModel).toBe("anthropic/claude-sonnet-4");
      expect(choice).toEqual({
        value: "anthropic/claude-sonnet-4",
        options: [
          { label: "Claude Sonnet 4 · anthropic/claude-sonnet-4", value: "anthropic/claude-sonnet-4" },
          { label: "GPT-5 · openai/gpt-5", value: "openai/gpt-5" },
        ],
      });
      // @step And the server called set_default_model with "openai/gpt-5"
      expect(outcome).toEqual({ ok: true });
      expect(daemon.sent("setDefaultModel")).toEqual([{ method: "setDefaultModel", model: "openai/gpt-5" }]);
      // @step And the screen reloaded the list and refreshed Paseo's fspec models
      expect(reload).toHaveBeenCalledTimes(1);
      expect(refreshPaseo).toHaveBeenCalledTimes(1);
    });
  });
});
