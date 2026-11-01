/**
 * Feature: spec/features/fspec-provider-settings-screen.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerSettings, SETTINGS_SCREEN_ID } from "../client/register.js";
import { runWrite } from "../client/settings-actions.js";
import { buildTree, removePrompt, screenState, sheetFor, testBadge, toggleExpanded } from "../client/settings-model.js";
import { createSettingsFeed } from "../server/settings.js";
import type * as wire from "../server/wire.js";
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
    configured: false,
    credentialType: "api_key",
    maskedKey: null,
    source: null,
    modelCount: 0,
    unreachable: true,
    models: [],
    profiles: [],
    providerId: id,
    profileName: null,
    ...overrides,
  };
}

/** The feed's rows for the credentials used across the tree scenarios. */
const feedRows: SettingsProvider[] = [
  row("anthropic", { displayName: "Anthropic", configured: true, credentialType: "oauth", modelCount: 17, unreachable: false }),
  row("openai", {
    displayName: "OpenAI",
    configured: true,
    maskedKey: "sk-••••abcd",
    source: "env",
    modelCount: 30,
    unreachable: false,
    profiles: [
      { name: "Strata", baseUrl: "http://10.0.0.5:8080/v1" },
      { name: "spark", baseUrl: "http://spark:8000/v1" },
    ],
  }),
  row("openai:Strata", { displayName: "Strata", providerId: "openai", profileName: "Strata", configured: true, credentialType: "custom", modelCount: 1 }),
  row("openai:spark", { displayName: "spark", providerId: "openai", profileName: "spark", configured: true, credentialType: "custom", modelCount: 1 }),
  row("gemini", { displayName: "Gemini" }),
];

function profileDefinition(baseUrl: string, apiKey: string): wire.ProfileDefinition {
  return {
    baseUrl,
    apiKey,
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

const labels = (rows: ReadonlyArray<{ label: string }>) => rows.map((r) => r.label);

describe("Feature: Manage fspec providers from a Paseo settings screen", () => {
  describe("Scenario: The settings screen opens from Settings, the Command Center and a slash command", () => {
    it("registers the screen and both entry points", () => {
      // @step Given the fspec plugin's client contributions are registered
      const screens: Array<{ id: string; title: string }> = [];
      const items: Array<{ id: string; title: string; context: string; onSelect(context: unknown): void }> = [];
      const commands: Array<{ name: string; context: string; onSubmit(context: unknown): void }> = [];
      const Screen = () => null;
      registerSettings(
        {
          addSettingsScreen: (screen: { id: string; title: string }) => (screens.push(screen), () => {}),
          addCommandCenterItem: (item: never) => (items.push(item), () => {}),
          addSlashCommand: (command: never) => (commands.push(command), () => {}),
        } as never,
        Screen,
      );
      // @step Then a settings screen "fspec-providers" titled "fspec providers" is added
      expect(SETTINGS_SCREEN_ID).toBe("fspec-providers");
      expect(screens).toEqual([expect.objectContaining({ id: "fspec-providers", title: "fspec providers", Component: Screen })]);
      // @step And a global Command Center item "fspec providers" and the slash command /fspec-providers open that screen with openSettings
      expect(items).toEqual([expect.objectContaining({ title: "fspec providers", context: "global" })]);
      expect(commands).toEqual([expect.objectContaining({ name: "fspec-providers" })]);
      const openSettings = vi.fn();
      items[0]!.onSelect({ openSettings });
      commands[0]!.onSubmit({ openSettings, args: "" });
      expect(openSettings.mock.calls).toEqual([["fspec-providers"], ["fspec-providers"]]);
    });
  });

  describe("Scenario: The provider list carries each provider's profiles without their keys", () => {
    it("adds profile names and base URLs from list_provider_settings", async () => {
      // @step Given the daemon reports provider settings with openai profiles Strata (http://10.0.0.5:8080/v1, key "lm-secret") and spark (http://spark:8000/v1)
      const home = tempHome();
      home.writeDaemonEntry();
      const daemon = new FakeDaemon();
      daemon.handlers.listProviderCredentials = (): wire.ProviderCredentialInfo[] => [
        {
          providerId: "openai",
          displayName: "OpenAI",
          configured: true,
          credentialType: "api_key",
          modelCount: 0,
          maskedKey: "sk-••••abcd",
          source: "env",
        },
      ];
      daemon.handlers.listProviderSettings = () => ({
        ok: true,
        value: [
          {
            providerId: "openai",
            settings: profileDefinition("", ""),
            profiles: [
              { name: "Strata", definition: profileDefinition("http://10.0.0.5:8080/v1", "lm-secret") },
              { name: "spark", definition: profileDefinition("http://spark:8000/v1", "") },
            ],
          },
        ],
      });
      const feed = createSettingsFeed(daemonOptions(home, daemon));
      disposers.push(home.dispose, () => feed.close());
      // @step When the client calls fspec.settings.list
      const listed = await feed.list({});
      // @step Then the openai row lists profiles Strata and spark with their base URLs
      if (listed.state !== "ready") throw new Error(listed.reason);
      expect(listed.providers.find((p) => p.id === "openai")!.profiles).toEqual([
        { name: "Strata", baseUrl: "http://10.0.0.5:8080/v1" },
        { name: "spark", baseUrl: "http://spark:8000/v1" },
      ]);
      // @step And the response does not contain "lm-secret"
      expect(JSON.stringify(listed)).not.toContain("lm-secret");
    });
  });

  describe("Scenario: Profiles fold under their provider and headers read like the fspec TUI", () => {
    it("folds and describes the providers", () => {
      // @step Given credentials for anthropic (OAuth, 17 models), openai (key "sk-••••abcd" from env, profiles Strata and spark), openai:Strata and openai:spark (custom) and gemini (unconfigured)
      const rows = [feedRows[4]!, ...feedRows.slice(0, 4)];
      // @step When the screen builds the provider tree
      const tree = buildTree(rows);
      // @step Then the providers are Anthropic, OpenAI and Gemini in that order
      expect(tree.map((p) => p.displayName)).toEqual(["Anthropic", "OpenAI", "Gemini"]);
      // @step And their headers read "✓ OAuth [Claude]", "✓ sk-••••abcd [env] (2 profiles)" and "(not configured)"
      expect(tree.map((p) => p.status)).toEqual(["✓ OAuth [Claude]", "✓ sk-••••abcd [env] (2 profiles)", "(not configured)"]);
    });
  });

  describe("Scenario: An expanded OpenAI shows Settings and its profiles but no API key row", () => {
    it("lists OpenAI's rows", () => {
      // @step Given the provider tree from the credentials above
      const openai = buildTree(feedRows).find((p) => p.id === "openai")!;
      // @step When the user expands OpenAI
      const expanded = toggleExpanded(new Set(), "openai");
      expect(expanded.has("openai")).toBe(true);
      // @step Then its rows are "⚙ Settings", "📁 Strata → http://10.0.0.5:8080/v1", "+ Add model to Strata", "📁 spark → http://spark:8000/v1", "+ Add model to spark" and "+ Add profile"
      expect(labels(openai.rows)).toEqual([
        "⚙ Settings",
        "📁 Strata → http://10.0.0.5:8080/v1",
        "+ Add model to Strata",
        "📁 spark → http://spark:8000/v1",
        "+ Add model to spark",
        "+ Add profile",
      ]);
      // @step And the header offers Test and Refresh models
      expect(openai).toMatchObject({ canTest: true, canRefresh: true });
    });
  });

  describe("Scenario: An expanded OAuth provider shows its sign-in rows first", () => {
    it("lists Anthropic's rows", () => {
      // @step Given the provider tree from the credentials above
      const anthropic = buildTree(feedRows).find((p) => p.id === "anthropic")!;
      // @step When the user expands Anthropic
      const expanded = toggleExpanded(new Set(), "anthropic");
      expect(expanded.has("anthropic")).toBe(true);
      // @step Then its rows are "✓ Logged in [Claude]", "🔑 Sign in with browser", "🔑 Sign in with code", "⚙ Settings" and "+ Add profile"
      expect(labels(anthropic.rows)).toEqual([
        "✓ Logged in [Claude]",
        "🔑 Sign in with browser",
        "🔑 Sign in with code",
        "⚙ Settings",
        "+ Add profile",
      ]);
      const codex = buildTree([row("codex", { credentialType: "oauth" })])[0]!;
      expect(labels(codex.rows).slice(0, 2)).toEqual(["🔑 Sign in with browser", "🔑 Sign in with device code"]);
      const copilot = buildTree([row("github-copilot", { credentialType: "oauth" })])[0]!;
      expect(labels(copilot.rows)[0]).toBe("🔑 Sign in with device code");
    });
  });

  describe("Scenario: An expanded API-key provider shows its key row, and each row opens its own sheet", () => {
    it("lists Gemini's rows and routes them to sheets", () => {
      // @step Given the provider tree from the credentials above
      const gemini = buildTree(feedRows).find((p) => p.id === "gemini")!;
      // @step When the user expands Gemini and taps its rows
      let expanded = toggleExpanded(new Set(), "gemini");
      const sheets = gemini.rows.map((r) => sheetFor(gemini.id, r));
      // @step Then its rows are "🔑 API key (not set)", "⚙ Settings" and "+ Add profile"
      expect(labels(gemini.rows)).toEqual(["🔑 API key (not set)", "⚙ Settings", "+ Add profile"]);
      // @step And they open the API key sheet, the Settings sheet and the new-profile sheet for gemini
      expect(sheets).toEqual([
        { kind: "apiKey", providerId: "gemini" },
        { kind: "settings", providerId: "gemini" },
        { kind: "profile", providerId: "gemini", profile: null },
      ]);
      const openai = buildTree(feedRows).find((p) => p.id === "openai")!;
      expect(sheetFor("openai", openai.rows[1]!)).toEqual({ kind: "profile", providerId: "openai", profile: "Strata" });
      const anthropic = buildTree(feedRows).find((p) => p.id === "anthropic")!;
      expect(sheetFor("anthropic", anthropic.rows[2]!)).toEqual({ kind: "oauthLogin", providerId: "anthropic", method: "code" });
      // @step And tapping the Gemini header again collapses it
      expanded = toggleExpanded(expanded, "gemini");
      expect(expanded.has("gemini")).toBe(false);
    });
  });

  describe("Scenario: Saving a key reloads the list and refreshes Paseo's fspec models", () => {
    it("runs the write, then reloads, refreshes and clears", async () => {
      // @step Given gemini is unconfigured
      expect(feedRows[4]!.configured).toBe(false);
      const order: string[] = [];
      const write = vi.fn(async (_input: unknown) => (order.push("write"), { ok: true as const }));
      const reload = vi.fn(async () => void order.push("reload"));
      const refreshPaseo = vi.fn(async () => void order.push("refresh"));
      const onSuccess = vi.fn(() => void order.push("clear"));
      // @step When the user saves the Gemini key "AIza-test"
      const input = { providerId: "gemini", credential: { kind: "api_key" as const, apiKey: "AIza-test" } };
      const outcome = await runWrite({ write: () => write(input), reload, refreshPaseo, onSuccess });
      // @step Then save-credentials is called with kind "api_key" and key "AIza-test"
      expect(write).toHaveBeenCalledWith(input);
      expect(outcome).toEqual({ ok: true });
      // @step And the list is reloaded and Paseo is asked to refresh the fspec provider
      expect(reload).toHaveBeenCalledOnce();
      expect(refreshPaseo).toHaveBeenCalledOnce();
      // @step And the key field is cleared
      expect(onSuccess).toHaveBeenCalledOnce();
      expect(order).toEqual(["write", "clear", "reload", "refresh"]);
    });
  });

  describe("Scenario: A saved key whose refresh fails reports the refresh failure as a warning", () => {
    it("keeps the write ok and adds one warning line per failed refresh", async () => {
      // @step Given saving the Gemini key succeeds with the warning "The key returns when the fspec daemon restarts unless removed from the environment."
      const warning = "The key returns when the fspec daemon restarts unless removed from the environment.";
      // @step When reloading the list fails with "socket closed" and refreshing Paseo's models fails with "provider busy"
      const outcome = await runWrite({
        write: async () => ({ ok: true as const, warning }),
        reload: async () => {
          throw new Error("socket closed");
        },
        refreshPaseo: async () => {
          throw new Error("provider busy");
        },
      });
      // @step Then the save is ok with the warning lines "The key returns when the fspec daemon restarts unless removed from the environment.", "Saved, but the provider list could not be reloaded: socket closed" and "Saved, but Paseo's fspec models could not be refreshed: provider busy"
      expect(outcome).toEqual({
        ok: true,
        warning: [
          warning,
          "Saved, but the provider list could not be reloaded: socket closed",
          "Saved, but Paseo's fspec models could not be refreshed: provider busy",
        ].join("\n"),
      });
    });
  });

  describe("Scenario: Removing a key asks first and passes on the environment warning", () => {
    it("names the provider and returns the warning", async () => {
      // @step Given gemini's key comes from the environment
      const gemini = row("gemini", { displayName: "Gemini", configured: true, maskedKey: "AIza••••", source: "env" });
      const warning = "The key returns when the fspec daemon restarts unless removed from the environment.";
      // @step When the user asks to remove gemini's key
      const prompt = removePrompt(gemini);
      // @step Then the confirmation reads "Remove the Gemini key from fspec?"
      expect(prompt).toBe("Remove the Gemini key from fspec?");
      // @step And after confirming, the feed's warning that the key returns when the daemon restarts is shown
      const outcome = await runWrite({
        write: async () => ({ ok: true as const, warning }),
        reload: async () => {},
        refreshPaseo: async () => {},
      });
      expect(outcome).toEqual({ ok: true, warning });
    });
  });

  describe("Scenario: A connection test shows its result on the provider header", () => {
    it("describes success and failure", () => {
      // @step Given the feed answers a test of anthropic with success in 812 ms, and a second test with "401 Unauthorized"
      const passed = { ok: true as const, success: true, error: null, latencyMs: 812 };
      const failed = { ok: true as const, success: false, error: "401 Unauthorized", latencyMs: 90 };
      // @step When the screen describes each result
      const first = testBadge(passed);
      const second = testBadge(failed);
      // @step Then the header shows "✓ 812 ms" and then "✗ 401 Unauthorized"
      expect(first).toBe("✓ 812 ms");
      expect(second).toBe("✗ 401 Unauthorized");
      expect(testBadge({ ok: false, error: "unknown provider" })).toBe("✗ unknown provider");
      expect(testBadge({ state: "unavailable", reason: "no daemon" })).toBe("✗ no daemon");
    });
  });

  describe("Scenario: An unreachable daemon shows the reason and a Retry action", () => {
    it("renders the unavailable state", () => {
      // @step Given the feed answers list with state "unavailable" and reason "no fspec daemon is running — no live entry in /h/.fspec/daemons; start fspec daemon first"
      const reason = "no fspec daemon is running — no live entry in /h/.fspec/daemons; start fspec daemon first";
      // @step When the screen renders that answer
      const state = screenState({ state: "unavailable", reason });
      // @step Then it shows that reason with a Retry action, not an empty list
      expect(state).toEqual({ kind: "unavailable", reason, retry: true });
      expect(screenState(null)).toEqual({ kind: "loading" });
      const ready = screenState({ state: "ready", workspace: "/w", providers: feedRows, defaultModel: null });
      expect(ready).toMatchObject({ kind: "ready", workspace: "/w" });
      expect(ready.kind === "ready" && ready.tree.map((p) => p.id)).toEqual(["anthropic", "openai", "gemini"]);
    });
  });

  describe("Scenario: A failed action leaves the list alone and reports the daemon's error", () => {
    it("does not reload or refresh", async () => {
      // @step Given the feed answers save-credentials with { ok: false, error: "credentials file is read-only" }
      const reload = vi.fn();
      const refreshPaseo = vi.fn();
      const onSuccess = vi.fn();
      // @step When the user saves a key
      const outcome = await runWrite({
        write: async () => ({ ok: false as const, error: "credentials file is read-only" }),
        reload,
        refreshPaseo,
        onSuccess,
      });
      // @step Then the list is not reloaded and Paseo is not asked to refresh
      expect(reload).not.toHaveBeenCalled();
      expect(refreshPaseo).not.toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
      // @step And the sheet shows "credentials file is read-only"
      expect(outcome).toEqual({ ok: false, error: "credentials file is read-only" });
      expect(
        await runWrite({ write: async () => ({ state: "unavailable" as const, reason: "daemon gone" }), reload, refreshPaseo }),
      ).toEqual({ ok: false, error: "daemon gone" });
      expect(
        await runWrite({ write: async () => Promise.reject(new Error("rpc timed out")), reload, refreshPaseo }),
      ).toEqual({ ok: false, error: "rpc timed out" });
    });
  });
});
