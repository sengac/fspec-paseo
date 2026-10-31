/**
 * Feature: spec/features/fspec-provider-settings-forms.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDefinition,
  deletePrompt,
  profileForm,
  setText,
  setToggle,
  settingsForm,
  visibleFields,
} from "../client/settings-form.js";
import { createSettingsFeed } from "../server/settings.js";
import type * as wire from "../server/wire.js";
import type { StoredDefinition } from "../shared/settings.js";
import { FakeDaemon, daemonOptions, tempHome } from "./support/fake-daemon.js";

const disposers: Array<() => unknown> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

function wireDefinition(overrides: Partial<wire.ProfileDefinition> = {}): wire.ProfileDefinition {
  return {
    baseUrl: "",
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
    ...overrides,
  };
}

function stored(overrides: Partial<StoredDefinition> = {}): StoredDefinition {
  const { apiKey: _apiKey, ...rest } = wireDefinition();
  return { ...rest, apiKeySet: false, ...overrides };
}

function built(form: ReturnType<typeof settingsForm>) {
  const result = buildDefinition(form);
  if (!result.ok) throw new Error(result.error);
  return result;
}

function daemonWithStrata() {
  const home = tempHome();
  home.writeDaemonJson();
  const daemon = new FakeDaemon();
  daemon.handlers.listProviderSettings = () => ({
    ok: true,
    value: [
      {
        providerId: "openai",
        settings: wireDefinition({ apiKey: "settings-secret", contextWindow: 128000 }),
        profiles: [
          { name: "Strata", definition: wireDefinition({ baseUrl: "http://10.0.0.5:8080/v1", apiKey: "lm-secret" }) },
          { name: "spark", definition: wireDefinition({ baseUrl: "http://spark:8000/v1" }) },
        ],
      },
    ],
  });
  for (const method of ["saveProviderSettings", "saveProfile", "renameProfile", "deleteProfile"] as const) {
    daemon.handlers[method] = () => ({ ok: true, value: undefined });
  }
  const feed = createSettingsFeed(daemonOptions(home, daemon));
  disposers.push(home.dispose, () => feed.close());
  return { daemon, feed };
}

describe("Feature: Edit fspec provider settings and profiles from Paseo", () => {
  describe("Scenario: A provider's Settings sheet shows the TUI's fields and defaults", () => {
    it("lists the fields with the TUI's placeholders and defaults", () => {
      // @step Given anthropic has no stored settings
      const definition = null;
      // @step When the Settings sheet for anthropic opens
      const form = settingsForm("anthropic", definition);
      const fields = visibleFields(form);
      // @step Then its fields are Context Window, Max Output Tokens, Compaction Threshold, Streaming, Auto-Continue, Preserve Thinking, Max Images, Loop Detection, Loop Window, Loop Repeat and Loop Retries, grouped as Limits, Behaviour and Loop detection
      expect(fields.map((f) => f.label)).toEqual([
        "Context Window",
        "Max Output Tokens",
        "Compaction Threshold",
        "Streaming",
        "Auto-Continue",
        "Preserve Thinking",
        "Max Images",
        "Loop Detection",
        "Loop Window",
        "Loop Repeat",
        "Loop Retries",
      ]);
      expect([...new Set(fields.map((f) => f.group))]).toEqual(["Limits", "Behaviour", "Loop detection"]);
      // @step And Context Window shows the placeholder "Automatic (model-specific)" and Compaction Threshold "80% or 200000"
      const placeholder = (label: string) => fields.find((f) => f.label === label)!.placeholder;
      expect(placeholder("Context Window")).toBe("Automatic (model-specific)");
      expect(placeholder("Compaction Threshold")).toBe("80% or 200000");
      // @step And Streaming, Preserve Thinking and Loop Detection are on, and Max Images, Loop Window, Loop Repeat and Loop Retries are empty with the placeholders "4 (default), 0 = no vision", "160 (default)", "10 (default)" and "10 (default), 0 = never retry"
      expect(form.toggles).toEqual({ streaming: true, preserveThinking: true, loopDetection: true });
      expect([form.text.maxImages, form.text.loopWindow, form.text.loopRepeat, form.text.loopRetries]).toEqual(["", "", "", ""]);
      expect(["Max Images", "Loop Window", "Loop Repeat", "Loop Retries"].map(placeholder)).toEqual([
        "4 (default), 0 = no vision",
        "160 (default)",
        "10 (default)",
        "10 (default), 0 = never retry",
      ]);
      expect(settingsForm("openai", null).toggles.preserveThinking).toBe(false);
    });
  });

  describe("Scenario: The compaction threshold accepts a percentage or a token count", () => {
    it("parses like the TUI", () => {
      // @step Given a Settings form
      const form = settingsForm("openai", null);
      // @step When Compaction Threshold is "80%", then "200000", then "500", then "150%"
      const results = ["80%", "200000", "500", "150%"].map((raw) => built(setText(form, "compactionThreshold", raw)).definition);
      // @step Then the definition carries percentage 80, then tokens 200000, then no threshold, then no threshold
      expect(results.map((d) => [d.compactionThresholdType, d.compactionThresholdValue])).toEqual([
        ["percentage", 80],
        ["tokens", 200000],
        [null, null],
        [null, null],
      ]);
      expect(settingsForm("openai", stored({ compactionThresholdType: "percentage", compactionThresholdValue: 75 })).text.compactionThreshold).toBe("75%");
    });
  });

  describe("Scenario: An invalid number is refused with the TUI's message", () => {
    it("refuses with the TUI's messages", () => {
      // @step Given a Settings form
      const form = settingsForm("openai", null);
      // @step When Context Window is "abc", or Auto-Continue is "-1"
      const window = buildDefinition(setText(form, "contextWindow", "abc"));
      const auto = buildDefinition(setText(form, "autoContinue", "-1"));
      // @step Then the form is refused with "Context Window must be a positive whole number, or empty for Automatic", or "Auto-Continue must be 0 (off) or a positive integer budget (e.g. 300)"
      expect(window).toEqual({ ok: false, error: "Context Window must be a positive whole number, or empty for Automatic" });
      expect(auto).toEqual({ ok: false, error: "Auto-Continue must be 0 (off) or a positive integer budget (e.g. 300)" });
      expect(buildDefinition(setText(form, "maxImages", "x"))).toEqual({
        ok: false,
        error: "Max Images must be a whole number (0 = no vision, 4 = default)",
      });
      expect(built(setText(setText(form, "contextWindow", "100000"), "autoContinue", "0")).definition).toMatchObject({
        contextWindow: 100000,
        autoContinue: 0,
      });
    });
  });

  describe("Scenario: Untouched toggles keep the daemon's default on inherited forms", () => {
    it("sends a toggle only once it is changed", () => {
      // @step Given gemini's Settings form opened from a definition without streaming
      const form = settingsForm("gemini", stored({ contextWindow: 64000 }));
      // @step When it is saved without touching Streaming, and again after turning Streaming off
      const untouched = built(form).definition;
      const off = built(setToggle(form, "streaming", false)).definition;
      // @step Then the first definition has streaming absent and the second has streaming false
      expect(untouched.streaming).toBeNull();
      expect(off.streaming).toBe(false);
      expect(untouched.contextWindow).toBe(64000);
    });
  });

  describe("Scenario: Profile forms follow the provider's authentication rules", () => {
    it("requires auth for openai and inherits it elsewhere", () => {
      // @step Given a new profile form for openai and one for anthropic
      const openai = profileForm("openai", null, null);
      const anthropic = profileForm("anthropic", null, null);
      // @step When the openai form is saved without an API key, and the anthropic form is saved as "fast" with Context Window 100000
      const refused = buildDefinition(setText(openai, "name", "lm"));
      const saved = built(setText(setText(anthropic, "name", "fast"), "contextWindow", "100000"));
      // @step Then the openai form is refused with "Enter the Base URL and API key"
      expect(refused).toEqual({ ok: false, error: "Enter the Base URL and API key" });
      // @step And the openai form's Base URL starts as "http://localhost:8888"
      expect(openai.baseUrl).toBe("http://localhost:8888");
      expect(visibleFields(openai).slice(0, 3).map((f) => f.label)).toEqual(["Name", "Base URL", "API Key"]);
      // @step And the anthropic profile saves with an empty base URL and key and its untouched toggles absent
      expect(saved.name).toBe("fast");
      expect(saved.apiKey).toBeNull();
      expect(saved.definition).toMatchObject({
        baseUrl: "",
        contextWindow: 100000,
        streaming: null,
        preserveThinking: null,
        loopDetectionEnabled: null,
      });
      expect(anthropic.toggles.preserveThinking).toBe(true);
      expect(anthropic.inheritedAuth).toBe(true);
      expect(buildDefinition(anthropic)).toEqual({ ok: false, error: "Enter a profile name" });
      const withKey = built(setText(setText(setText(openai, "name", "lm"), "apiKey", "sk-1"), "baseUrl", "http://h:1/v1"));
      expect(withKey).toMatchObject({ apiKey: "sk-1", definition: { baseUrl: "http://h:1/v1", streaming: true } });
    });
  });

  describe("Scenario: Provider settings reach the client without profile keys", () => {
    it("masks every key", async () => {
      // @step Given the daemon stores openai's Strata profile with key "lm-secret"
      const { feed } = daemonWithStrata();
      // @step When the client reads openai's provider settings
      const answer = await feed.providerSettings({ providerId: "openai" });
      // @step Then Strata's definition shows its base URL and that a key is stored
      if (answer.state !== "ready") throw new Error(answer.reason);
      expect(answer.settings).toMatchObject({ contextWindow: 128000, apiKeySet: true });
      expect(answer.profiles).toEqual([
        { name: "Strata", definition: expect.objectContaining({ baseUrl: "http://10.0.0.5:8080/v1", apiKeySet: true }) },
        { name: "spark", definition: expect.objectContaining({ baseUrl: "http://spark:8000/v1", apiKeySet: false }) },
      ]);
      // @step And the response does not contain "lm-secret"
      expect(JSON.stringify(answer)).not.toContain("lm-secret");
      expect(JSON.stringify(answer)).not.toContain("settings-secret");
      const form = profileForm("openai", "Strata", answer.profiles[0]!.definition);
      expect(form).toMatchObject({ name: "Strata", baseUrl: "http://10.0.0.5:8080/v1", apiKeySet: true, apiKey: "" });
      expect(form.text).toMatchObject({ maxImages: "4", loopWindow: "160", loopRepeat: "10", loopRetries: "10" });
    });
  });

  describe("Scenario: Saving settings and profiles goes to the right daemon call", () => {
    it("routes each write and keeps stored keys", async () => {
      // @step Given openai's Strata profile with key "lm-secret"
      const { daemon, feed } = daemonWithStrata();
      const { apiKey: _key, ...definition } = wireDefinition({ baseUrl: "http://10.0.0.5:8080/v1", contextWindow: 32768 });
      // @step When the client saves openai's settings, saves Strata with an empty key, renames Strata to "Strata2", and deletes "spark"
      const answers = [
        await feed.saveSettings({ providerId: "openai", definition: { ...definition, baseUrl: "" } }),
        await feed.saveProfile({ providerId: "openai", originalName: "Strata", name: "Strata", definition, apiKey: null }),
        await feed.saveProfile({ providerId: "openai", originalName: "Strata", name: "Strata2", definition, apiKey: null }),
        await feed.deleteProfile({ providerId: "openai", name: "spark" }),
      ];
      // @step Then the daemon receives save_provider_settings, save_profile with key "lm-secret", rename_profile from "Strata" to "Strata2", and delete_profile "spark"
      expect(answers).toEqual([{ ok: true }, { ok: true }, { ok: true }, { ok: true }]);
      expect(daemon.sent("saveProviderSettings")[0]!.definition).toMatchObject({ apiKey: "settings-secret", contextWindow: 32768 });
      expect(daemon.sent("saveProfile")[0]).toMatchObject({
        providerId: "openai",
        profileName: "Strata",
        definition: { apiKey: "lm-secret", contextWindow: 32768 },
      });
      expect(daemon.sent("renameProfile")[0]).toMatchObject({
        oldName: "Strata",
        newName: "Strata2",
        definition: { apiKey: "lm-secret" },
      });
      expect(daemon.sent("deleteProfile")[0]).toMatchObject({ providerId: "openai", profileName: "spark" });
      await feed.saveProfile({ providerId: "openai", originalName: null, name: "new", definition, apiKey: "sk-new" });
      expect(daemon.sent("saveProfile")[1]!.definition.apiKey).toBe("sk-new");
    });
  });

  describe("Scenario: Deleting a profile asks first", () => {
    it("names the profile and provider", () => {
      // @step Given OpenAI's spark profile
      const profile = "spark";
      // @step When the user asks to delete it
      const prompt = deletePrompt(profile, "OpenAI");
      // @step Then the confirmation reads "Delete the spark profile of OpenAI?"
      expect(prompt).toBe("Delete the spark profile of OpenAI?");
    });
  });
});
