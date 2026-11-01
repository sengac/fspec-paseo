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

  describe("Scenario: A default the catalog does not list leaves the first model as the default", () => {
    it("falls back to the first reachable model", async () => {
      // @step Given fspec's default model is "gone/old-model" and the catalog lists "anthropic/claude-sonnet-4" then "openai/gpt-5"
      // @step When Paseo asks the provider for its catalog
      const catalog = await catalogWith("gone/old-model");
      // @step Then the catalog's defaultModel is "anthropic/claude-sonnet-4"
      expect(catalog.defaultModel).toBe("anthropic/claude-sonnet-4");
      expect(catalog.models.filter((model) => model.isDefault).map((model) => model.id)).toEqual(["anthropic/claude-sonnet-4"]);
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

  describe("Scenario: With no default model the chosen model becomes fspec's default", () => {
    it("sets fspec's default model before creating the session", async () => {
      // @step Given fspec has no default model
      const h = await harness();
      h.daemon.handlers.getDefaultModel = () => null;
      // @step When Paseo opens an fspec agent with model "openai/gpt-5"
      await h.open("paseo-1", { model: "openai/gpt-5" });
      // @step Then the provider called set_default_model with "openai/gpt-5" before create_session_checked
      const methods = h.daemon.requests.map((request) => request.method);
      expect(h.daemon.sent("setDefaultModel")).toEqual([{ method: "setDefaultModel", model: "openai/gpt-5" }]);
      expect(methods.indexOf("setDefaultModel")).toBeLessThan(methods.indexOf("createSessionChecked"));
      // @step And the session's model is set to provider "openai" and model "gpt-5"
      expect(h.daemon.sent("setSessionModel")).toEqual([
        { method: "setSessionModel", sessionId: "fspec-sess-42", providerId: "openai", modelId: "gpt-5" },
      ]);
    });
  });

  describe("Scenario: A session fspec declines for want of a default model fails the open with the reason", () => {
    it("fails the open instead of using an empty session id", async () => {
      // @step Given fspec has no default model and create_session_checked answers an empty session id
      const h = await harness();
      h.daemon.handlers.listProviders = () => [];
      h.daemon.handlers.getDefaultModel = () => null;
      h.daemon.handlers.createSessionChecked = () => ({ ok: true, value: "" });
      // @step When Paseo opens an fspec agent
      await h.connection.send({
        type: "session.open",
        requestId: "o-1",
        sessionId: "paseo-1",
        config: { cwd: "/work", env: {}, mcpServers: {}, settings: {}, persist: true },
        history: "skip",
      });
      const failed: Event<"request.failed"> = await h.waitFor("request.failed", (event) => event.requestId === "o-1");
      // @step Then the open fails with "fspec could not create a session: fspec has no default model — choose one under fspec providers"
      expect(failed.error.message).toBe("fspec could not create a session: fspec has no default model — choose one under fspec providers");
      // @step And the provider sent no set_session_model
      expect(h.daemon.sent("setSessionModel")).toEqual([]);
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
