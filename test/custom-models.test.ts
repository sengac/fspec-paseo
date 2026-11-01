/**
 * Feature: spec/features/fspec-custom-models.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCustomModel,
  customModelFormFor,
  deleteCustomModelPrompt,
  newCustomModelForm,
} from "../client/custom-model-form.js";
import { runWrite } from "../client/settings-actions.js";
import { buildTree } from "../client/settings-model.js";
import { createSettingsFeed } from "../server/settings.js";
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
    ...overrides,
  };
}

const QWEN = { id: "qwen3-coder", displayName: "Qwen3 Coder", contextWindow: 32768, isCustom: true, supportsReasoning: true, supportsVision: false };

function setup() {
  const home = tempHome();
  home.writeDaemonJson();
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
        row("openai:Strata", { displayName: "Strata", models: [QWEN, { id: "llama3", displayName: "llama3", contextWindow: 8192 }] }),
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
});
