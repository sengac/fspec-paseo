/**
 * Feature: spec/features/fspec-custom-models.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCustomModel,
  customModelFormFor,
  deleteCustomModelPrompt,
  newCustomModelForm,
} from "../client/custom-model-form.js";
import { runWrite } from "../client/settings-actions.js";
import { buildTree, sheetFor } from "../client/settings-model.js";
import { createSettingsFeed } from "../server/settings.js";
import * as wire from "../server/wire.js";
import type { SettingsProvider } from "../shared/settings.js";
import { FakeDaemon, daemonOptions, tempHome } from "./support/fake-daemon.js";

const disposers: Array<() => unknown> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

function row(id: string, overrides: Partial<SettingsProvider> = {}): SettingsProvider {
  return {
    id,
    displayName: id,
    configured: true,
    credentialType: "custom",
    maskedKey: null,
    source: null,
    modelCount: 0,
    unreachable: false,
    models: [],
    profiles: [],
    providerId: id,
    profileName: null,
    ...overrides,
  };
}

const QWEN = { id: "qwen3-coder", displayName: "Qwen3 Coder", contextWindow: 32768, isCustom: true, supportsReasoning: true, supportsVision: false };

function setup() {
  const home = tempHome();
  home.writeDaemonEntry();
  const daemon = new FakeDaemon();
  daemon.handlers.addCustomModel = () => ({ ok: true, value: undefined });
  daemon.handlers.updateCustomModel = () => ({ ok: true, value: undefined });
  daemon.handlers.deleteCustomModel = () => ({ ok: true, value: undefined });
  const feed = createSettingsFeed(daemonOptions(home, daemon));
  disposers.push(home.dispose, () => feed.close());
  return { daemon, feed };
}

function spies() {
  return { reload: vi.fn(async () => {}), refreshPaseo: vi.fn(async () => ({})) };
}

describe("Feature: Manage fspec custom models from Paseo", () => {
  describe("Scenario: Custom models show under their profile in the provider tree", () => {
    it("lists custom model rows under the profile", () => {
      // @step Given the openai profile "Strata" at "http://10.0.0.5:8080/v1" serves the custom model "qwen3-coder" named "Qwen3 Coder" and the plain model "llama3"
      const rows = [
        row("openai", { displayName: "OpenAI", credentialType: "api_key", profiles: [{ name: "Strata", baseUrl: "http://10.0.0.5:8080/v1" }] }),
        row("openai:Strata", { displayName: "Strata", providerId: "openai", profileName: "Strata", models: [QWEN, { id: "llama3", displayName: "llama3", contextWindow: 8192 }] }),
      ];
      // @step When the screen builds the provider tree
      const openai = buildTree(rows).find((provider) => provider.id === "openai")!;
      const labels = openai.rows.map((entry) => entry.label);
      // @step Then the OpenAI rows include "📁 Strata → http://10.0.0.5:8080/v1", "◆ Qwen3 Coder" and "+ Add model to Strata" in that order
      expect(labels).toEqual(["⚙ Settings", "📁 Strata → http://10.0.0.5:8080/v1", "◆ Qwen3 Coder", "+ Add model to Strata", "+ Add profile"]);
      // @step And "llama3" has no custom model row
      expect(labels.some((label) => label.includes("llama3"))).toBe(false);
      expect(openai.rows[2]).toMatchObject({ kind: "customModel", profile: "Strata", model: { id: "qwen3-coder" } });
    });
  });

  describe("Scenario: Adding a custom model writes it to the profile", () => {
    it("sends add_custom_model and refreshes", async () => {
      // @step Given the custom model sheet for a new model in profile "Strata"
      const { daemon, feed } = setup();
      const form = newCustomModelForm();
      // @step When the user enters Model ID "qwen3-coder", Display Name "Qwen3 Coder", Facade "openai", Context Window "32768", Compaction Trigger "80%" and turns Reasoning on, then saves
      const built = buildCustomModel({
        ...form,
        id: "qwen3-coder",
        displayName: "Qwen3 Coder",
        facade: "openai",
        contextWindow: "32768",
        compactionTrigger: "80%",
        reasoning: true,
      });
      if (!built.ok) throw new Error(built.error);
      const { reload, refreshPaseo } = spies();
      const outcome = await runWrite({
        write: () => feed.saveCustomModel({ providerId: "openai", profile: "Strata", originalId: built.originalId, definition: built.definition }),
        reload,
        refreshPaseo,
      });
      // @step Then the daemon received add_custom_model for provider "openai" and profile "Strata" with id "qwen3-coder", facade "openai", context window 32768, a percentage trigger of 80, reasoning on and vision off
      expect(outcome).toEqual({ ok: true });
      expect(daemon.sent("addCustomModel")).toEqual([
        {
          method: "addCustomModel",
          providerId: "openai",
          profileName: "Strata",
          definition: {
            id: "qwen3-coder",
            displayName: "Qwen3 Coder",
            facade: "openai",
            contextWindow: 32768,
            maxOutputTokens: null,
            compactionThresholdType: "percentage",
            compactionThresholdValue: 80,
            reasoning: true,
            hasVision: false,
          },
        },
      ]);
      // @step And the screen reloaded the list and refreshed Paseo's fspec models
      expect(reload).toHaveBeenCalledTimes(1);
      expect(refreshPaseo).toHaveBeenCalledTimes(1);
    });
  });

  describe("Scenario: Editing a custom model replaces it by its original id", () => {
    it("sends update_custom_model with the original id", async () => {
      // @step Given the custom model sheet for "qwen3" in profile "Strata", prefilled from the listed model
      const { daemon, feed } = setup();
      const form = customModelFormFor({ id: "qwen3", displayName: "qwen3", contextWindow: 32768, isCustom: true, supportsReasoning: false, supportsVision: true });
      // @step When the user changes the Model ID to "qwen3-coder" and saves
      const built = buildCustomModel({ ...form, id: "qwen3-coder" });
      if (!built.ok) throw new Error(built.error);
      await feed.saveCustomModel({ providerId: "openai", profile: "Strata", originalId: built.originalId, definition: built.definition });
      // @step Then the daemon received update_custom_model for provider "openai", profile "Strata" and original id "qwen3" with id "qwen3-coder"
      expect(daemon.sent("addCustomModel")).toEqual([]);
      expect(daemon.sent("updateCustomModel")).toEqual([
        {
          method: "updateCustomModel",
          providerId: "openai",
          profileName: "Strata",
          originalModelId: "qwen3",
          definition: {
            id: "qwen3-coder",
            displayName: null,
            facade: null,
            contextWindow: 32768,
            maxOutputTokens: null,
            compactionThresholdType: null,
            compactionThresholdValue: null,
            reasoning: false,
            hasVision: true,
          },
        },
      ]);
      // @step And the prefilled display name was blank because the listed name equals the id
      expect(form.displayName).toBe("");
    });
  });

  describe("Scenario: Deleting a custom model asks first", () => {
    it("confirms and sends delete_custom_model", async () => {
      // @step Given the custom model sheet for "qwen3-coder" named "Qwen3 Coder" in profile "Strata"
      const { daemon, feed } = setup();
      // @step When the user deletes it and confirms
      const prompt = deleteCustomModelPrompt("Qwen3 Coder", "Strata");
      await feed.deleteCustomModel({ providerId: "openai", profile: "Strata", id: "qwen3-coder" });
      // @step Then the confirmation read "Delete the custom model Qwen3 Coder from Strata?"
      expect(prompt).toBe("Delete the custom model Qwen3 Coder from Strata?");
      // @step And the daemon received delete_custom_model for provider "openai", profile "Strata" and id "qwen3-coder"
      expect(daemon.sent("deleteCustomModel")).toEqual([
        { method: "deleteCustomModel", providerId: "openai", profileName: "Strata", modelId: "qwen3-coder" },
      ]);
    });
  });

  describe("Scenario: A custom model needs a model id and whole-number limits", () => {
    it("refuses the form before anything is sent", () => {
      // @step Given the custom model sheet for a new model in profile "Strata"
      const { daemon } = setup();
      const form = newCustomModelForm();
      // @step When the user saves with an empty Model ID, and then with Context Window "lots"
      const empty = buildCustomModel({ ...form, id: "  " });
      const lots = buildCustomModel({ ...form, id: "qwen3", contextWindow: "lots" });
      // @step Then the form shows "Enter the model ID" and then "Context Window must be a whole number"
      expect(empty).toEqual({ ok: false, error: "Enter the model ID" });
      expect(lots).toEqual({ ok: false, error: "Context Window must be a whole number" });
      // @step And nothing was sent to the daemon
      expect(daemon.requests).toEqual([]);
    });
  });

  describe("Scenario: A refused write is shown and changes nothing", () => {
    it("returns the daemon's error and does not reload", async () => {
      // @step Given add_custom_model answers "Profile 'Strata' not found"
      const { daemon, feed } = setup();
      daemon.handlers.addCustomModel = () => ({ ok: false, error: "Profile 'Strata' not found" });
      const built = buildCustomModel({ ...newCustomModelForm(), id: "qwen3" });
      if (!built.ok) throw new Error(built.error);
      const { reload, refreshPaseo } = spies();
      // @step When the user saves a new custom model
      const outcome = await runWrite({
        write: () => feed.saveCustomModel({ providerId: "openai", profile: "Strata", originalId: null, definition: built.definition }),
        reload,
        refreshPaseo,
      });
      // @step Then the sheet shows "Profile 'Strata' not found"
      expect(outcome).toEqual({ ok: false, error: "Profile 'Strata' not found" });
      // @step And the list was not reloaded
      expect(reload).not.toHaveBeenCalled();
      expect(refreshPaseo).not.toHaveBeenCalled();
    });
  });

  describe("Scenario: ProviderInfo carries its base provider as its last field", () => {
    it("decodes and re-encodes provider_id", () => {
      // @step Given the Rust golden vectors for ProviderInfo of the "openai:lab" profile section with provider_id "openai" and of the "anthropic" provider
      const profile = golden("provider_info_profile");
      const cloud = golden("provider_info_cloud");
      // @step When the codec decodes and re-encodes them
      const decoded = listProviders([profile, cloud]);
      const encoded = Buffer.from(
        wire.encodeResponseFrame({ requestId: 0, message: "listProviders", value: decoded }),
      ).toString("hex");
      // @step Then the profile section decodes to key "openai:lab", profile "lab" and provider id "openai", the cloud provider to provider id "anthropic"
      expect(decoded).toEqual([
        { key: "openai:lab", displayName: "OpenAI: lab", models: [], profileName: "lab", isUnreachable: false, providerId: "openai" },
        { key: "anthropic", displayName: "Anthropic", models: [], profileName: null, isUnreachable: false, providerId: "anthropic" },
      ]);
      // @step And both re-encode to the golden bytes
      expect(encoded).toBe(LIST_PROVIDERS_HEAD + "0200000000000000" + profile + cloud);
    });
  });

  describe("Scenario: Profile sections fold under the provider their provider id names", () => {
    it("folds by provider id and profile name and writes with the section's provider id", async () => {
      // @step Given list_providers lists a section keyed "lab-section" with provider id "openai", profile "Lab" and the custom model "qwen3-coder", and OpenAI's settings list the profile "Lab"
      const { daemon, feed } = setup();
      daemon.handlers.listProviderCredentials = (): wire.ProviderCredentialInfo[] => [
        { providerId: "openai", displayName: "OpenAI", configured: true, credentialType: "api_key", modelCount: 0, maskedKey: null, source: null },
      ];
      daemon.handlers.listProviders = (): wire.ProviderInfo[] => [
        {
          key: "lab-section",
          displayName: "Lab",
          models: [{ id: "qwen3-coder", displayName: "Qwen3 Coder", contextWindow: 32768, supportsReasoning: true, supportsVision: false, isCustom: true }],
          profileName: "Lab",
          isUnreachable: false,
          providerId: "openai",
        },
      ];
      daemon.handlers.listProviderSettings = () => ({
        ok: true,
        value: [{ providerId: "openai", settings: emptyDefinition(""), profiles: [{ name: "Lab", definition: emptyDefinition("http://lab:8080/v1") }] }],
      });
      // @step When the settings list is loaded and the screen builds the provider tree
      const list = await feed.list({});
      if (!("providers" in list)) throw new Error(JSON.stringify(list));
      const openai = buildTree(list.providers).find((provider) => provider.id === "openai")!;
      // @step Then the OpenAI rows include "📁 Lab → http://lab:8080/v1", "◆ Qwen3 Coder" and "+ Add model to Lab"
      expect(openai.rows.map((entry) => entry.label)).toEqual([
        "⚙ Settings",
        "📁 Lab → http://lab:8080/v1",
        "◆ Qwen3 Coder",
        "+ Add model to Lab",
        "+ Add profile",
      ]);
      expect(buildTree(list.providers).some((provider) => provider.id === "lab-section")).toBe(false);
      // @step And the custom model row and the add row carry provider id "openai", which saving the custom model sends
      const custom = sheetFor(openai.id, openai.rows[2]!);
      const add = sheetFor(openai.id, openai.rows[3]!);
      expect(custom).toMatchObject({ kind: "customModel", providerId: "openai", profile: "Lab" });
      expect(add).toMatchObject({ kind: "customModel", providerId: "openai", profile: "Lab", model: null });
      const built = buildCustomModel({ ...newCustomModelForm(), id: "qwen3" });
      if (!built.ok || add.kind !== "customModel") throw new Error("not a custom model sheet");
      await feed.saveCustomModel({ providerId: add.providerId, profile: add.profile, originalId: null, definition: built.definition });
      expect(daemon.sent("addCustomModel")[0]).toMatchObject({ providerId: "openai", profileName: "Lab" });
    });
  });

  describe("Scenario: A refused custom model delete is shown and changes nothing", () => {
    it("returns the daemon's error and does not reload", async () => {
      // @step Given delete_custom_model answers "Model 'qwen3' not found in profile 'Strata'"
      const { daemon, feed } = setup();
      daemon.handlers.deleteCustomModel = () => ({ ok: false, error: "Model 'qwen3' not found in profile 'Strata'" });
      const { reload, refreshPaseo } = spies();
      // @step When the user deletes the custom model "qwen3" from "Strata"
      const outcome = await runWrite({
        write: () => feed.deleteCustomModel({ providerId: "openai", profile: "Strata", id: "qwen3" }),
        reload,
        refreshPaseo,
      });
      // @step Then the sheet shows "Model 'qwen3' not found in profile 'Strata'"
      expect(outcome).toEqual({ ok: false, error: "Model 'qwen3' not found in profile 'Strata'" });
      // @step And the list was not reloaded
      expect(reload).not.toHaveBeenCalled();
      expect(refreshPaseo).not.toHaveBeenCalled();
    });
  });
});

const GOLDEN = new Map(
  readFileSync(fileURLToPath(new URL("./golden/golden-vectors.txt", import.meta.url)), "utf8")
    .trim()
    .split("\n")
    .map((line) => line.split(" ") as [string, string]),
);

function golden(name: string): string {
  const hex = GOLDEN.get(name);
  if (hex === undefined) throw new Error(`missing golden vector ${name}`);
  return hex;
}

/** A list_providers (idx 28) Response header: request id 0, Ok, variant 28. */
const LIST_PROVIDERS_HEAD = "0000000000000000" + "00000000" + "1c000000";

function listProviders(items: string[]): wire.ProviderInfo[] {
  const count = Buffer.alloc(8);
  count.writeBigUInt64LE(BigInt(items.length));
  const frame = LIST_PROVIDERS_HEAD + count.toString("hex") + items.join("");
  const decoded = wire.decodeResponseFrame(new Uint8Array(Buffer.from(frame, "hex")));
  if (!decoded.ok || decoded.method !== "listProviders") throw new Error("not a list_providers reply");
  return decoded.providers;
}

function emptyDefinition(baseUrl: string): wire.ProfileDefinition {
  return {
    baseUrl,
    apiKey: "",
    contextWindow: null,
    maxOutputTokens: null,
    compactionThresholdType: null,
    compactionThresholdValue: null,
    streaming: null,
    autoContinue: null,
    preserveThinking: null,
    maxImages: null,
    loopDetectionEnabled: null,
    loopDetectionWindow: null,
    loopDetectionMaxRepeats: null,
    loopDetectionMaxRetries: null,
  };
}
