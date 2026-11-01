/**
 * Feature: spec/features/fspec-provider-settings-feed.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import contribute from "../index.server.js";
import { createFspecProvider } from "../server/provider.js";
import { createSettingsFeed, type SettingsFeed } from "../server/settings.js";
import type * as wire from "../server/wire.js";
import { FakeDaemon, daemonOptions, tempHome } from "./support/fake-daemon.js";

const disposers: Array<() => unknown> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dispose of disposers.splice(0)) await dispose();
});

const anthropic: wire.ProviderCredentialInfo = {
  providerId: "anthropic",
  displayName: "Anthropic",
  configured: true,
  credentialType: "api_key",
  modelCount: 12,
  maskedKey: "sk-ant-••••mnop",
  source: "file",
};

const openai: wire.ProviderCredentialInfo = {
  providerId: "openai",
  displayName: "OpenAI",
  configured: false,
  credentialType: "api_key",
  modelCount: 0,
  maskedKey: null,
  source: null,
};

function model(id: string): wire.ModelEntry {
  return { id, displayName: id, contextWindow: 200000, supportsReasoning: true, supportsVision: false, isCustom: false };
}

const anthropicModels = Array.from({ length: 12 }, (_, i) => model(`claude-${i}`));

function setup(credentials: wire.ProviderCredentialInfo[] = [openai, anthropic]) {
  const home = tempHome();
  home.writeDaemonEntry();
  const daemon = new FakeDaemon();
  daemon.handlers.getWorkspaceInfo = () => ({ cwd: "/work/app", gitBranch: null });
  daemon.handlers.listProviderCredentials = () => credentials;
  daemon.handlers.listProviders = (): wire.ProviderInfo[] => [
    { key: "anthropic", displayName: "Anthropic", models: anthropicModels, profileName: null, isUnreachable: false, providerId: "anthropic" },
  ];
  daemon.handlers.getProviderCredential = (request) =>
    credentials.find((row) => row.providerId === (request as { providerId: string }).providerId) ?? null;
  daemon.handlers.setProviderCredentials = () => ({ ok: true, value: undefined });
  daemon.handlers.deleteProviderCredentials = () => ({ ok: true, value: undefined });
  const feed: SettingsFeed = createSettingsFeed(daemonOptions(home, daemon));
  disposers.push(home.dispose, () => feed.close());
  return { home, daemon, feed };
}

/** Every console line the plugin writes during `run`, joined. */
async function consoleDuring(run: () => Promise<unknown>): Promise<{ result: unknown; logged: string }> {
  const lines: string[] = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
    });
  }
  const result = await run();
  return { result, logged: lines.join("\n") };
}

describe("Feature: Serve fspec provider settings to Paseo plugin UI", () => {
  describe("Scenario: The provider list merges credentials and models, configured first", () => {
    it("answers the workspace and merged rows", async () => {
      // @step Given the fspec daemon serves /work/app with anthropic configured from file (masked key "sk-ant-••••mnop", 12 models) and openai unconfigured
      const { feed } = setup();
      const handled: string[] = [];
      contribute({ registerProvider: () => {}, handle: (rpc: { name: string }) => void handled.push(rpc.name) } as never);
      expect(handled).toEqual(
        expect.arrayContaining([
          "fspec.settings.list",
          "fspec.settings.save-credentials",
          "fspec.settings.remove-credentials",
          "fspec.settings.test",
          "fspec.settings.refresh-models",
        ]),
      );
      // @step When the client calls fspec.settings.list
      const listed = await feed.list({});
      // @step Then it answers state "ready" with workspace "/work/app"
      expect(listed).toMatchObject({ state: "ready", workspace: "/work/app" });
      if (listed.state !== "ready") throw new Error(listed.reason);
      // @step And the rows are anthropic then openai
      expect(listed.providers.map((row) => row.id)).toEqual(["anthropic", "openai"]);
      // @step And anthropic has masked key "sk-ant-••••mnop", source "file" and its 12 models
      expect(listed.providers[0]).toMatchObject({
        displayName: "Anthropic",
        configured: true,
        credentialType: "api_key",
        maskedKey: "sk-ant-••••mnop",
        source: "file",
        listing: "reachable",
      });
      expect(listed.providers[0]!.models).toHaveLength(12);
      expect(listed.providers[1]).toMatchObject({ configured: false, maskedKey: null, source: null, models: [] });
    });
  });

  describe("Scenario: Saving an API key never echoes the key", () => {
    it("sends the key to the daemon only", async () => {
      // @step Given the fspec daemon accepts set_provider_credentials for openai
      const { daemon, feed } = setup();
      // @step When the client saves the OpenAI key "sk-proj-abc" with fspec.settings.save-credentials
      const { result, logged } = await consoleDuring(() =>
        feed.saveCredentials({ providerId: "openai", credential: { kind: "api_key", apiKey: "sk-proj-abc" } }),
      );
      // @step Then the daemon receives kind "api_key" with api_key "sk-proj-abc" and every other field absent
      expect(daemon.sent("setProviderCredentials")).toEqual([
        {
          method: "setProviderCredentials",
          providerId: "openai",
          creds: {
            kind: "api_key",
            apiKey: "sk-proj-abc",
            oauthToken: null,
            oauthRefreshToken: null,
            customEndpoint: null,
            customApiKey: null,
          },
        },
      ]);
      // @step And the client gets { ok: true }
      expect(result).toEqual({ ok: true });
      // @step And neither the response nor any plugin log line contains "sk-proj-abc"
      expect(JSON.stringify(result)).not.toContain("sk-proj-abc");
      expect(logged).not.toContain("sk-proj-abc");
    });

    it("keeps the key out of a daemon refusal too", async () => {
      const { daemon, feed } = setup();
      daemon.handlers.setProviderCredentials = () => ({ ok: false, error: "credentials file is read-only" });
      const { result, logged } = await consoleDuring(() =>
        feed.saveCredentials({ providerId: "openai", credential: { kind: "api_key", apiKey: "sk-proj-abc" } }),
      );
      expect(result).toEqual({ ok: false, error: "credentials file is read-only" });
      expect(JSON.stringify(result) + logged).not.toContain("sk-proj-abc");
    });
  });

  describe("Scenario: Saving a custom endpoint sends only the custom fields", () => {
    it("sends kind custom", async () => {
      // @step Given the fspec daemon accepts set_provider_credentials for lmstudio
      const { daemon, feed } = setup();
      // @step When the client saves endpoint "http://127.0.0.1:1234/v1" with key "lm-key" for lmstudio
      const result = await feed.saveCredentials({
        providerId: "lmstudio",
        credential: { kind: "custom", endpoint: "http://127.0.0.1:1234/v1", apiKey: "lm-key" },
      });
      // @step Then the daemon receives kind "custom" with custom_endpoint and custom_api_key set and every other field absent
      expect(result).toEqual({ ok: true });
      expect(daemon.sent("setProviderCredentials")[0]!.creds).toEqual({
        kind: "custom",
        apiKey: null,
        oauthToken: null,
        oauthRefreshToken: null,
        customEndpoint: "http://127.0.0.1:1234/v1",
        customApiKey: "lm-key",
      });
    });
  });

  describe("Scenario: Removing an environment key warns that it returns on restart", () => {
    it("removes and warns", async () => {
      // @step Given openai is configured from source "env"
      const { daemon, feed } = setup([anthropic, { ...openai, configured: true, maskedKey: "sk-••••abcd", source: "env" }]);
      // @step When the client removes openai's credentials with fspec.settings.remove-credentials
      const result = await feed.removeCredentials({ providerId: "openai" });
      // @step Then the daemon receives delete_provider_credentials("openai")
      expect(daemon.sent("deleteProviderCredentials")).toEqual([
        { method: "deleteProviderCredentials", providerId: "openai" },
      ]);
      // @step And the client gets { ok: true } with a warning that the key returns when the fspec daemon restarts unless removed from the environment
      expect(result).toMatchObject({ ok: true });
      expect((result as { warning?: string }).warning).toMatch(/returns when the fspec daemon restarts/);
      expect((result as { warning?: string }).warning).toMatch(/environment/);
    });

    it("gives no warning for a file key", async () => {
      const { feed } = setup();
      expect(await feed.removeCredentials({ providerId: "anthropic" })).toEqual({ ok: true });
    });
  });

  describe("Scenario: A connection test reports failure and refusal as data", () => {
    it("answers both as data", async () => {
      // @step Given the daemon answers test_provider_connection for anthropic with success false, error "401 Unauthorized", 812 ms
      const { daemon, feed } = setup();
      // @step And the daemon answers test_provider_connection for "nope" with Err("unknown provider")
      daemon.handlers.testProviderConnection = (request) =>
        (request as { providerId: string }).providerId === "anthropic"
          ? { ok: true, value: { success: false, error: "401 Unauthorized", latencyMs: 812 } }
          : { ok: false, error: "unknown provider" };
      // @step When the client tests anthropic and then "nope" with fspec.settings.test
      const first = await feed.test({ providerId: "anthropic" });
      const second = await feed.test({ providerId: "nope" });
      // @step Then the first answer is { ok: true, success: false, error: "401 Unauthorized", latencyMs: 812 }
      expect(first).toEqual({ ok: true, success: false, error: "401 Unauthorized", latencyMs: 812 });
      // @step And the second answer is { ok: false, error: "unknown provider" }
      expect(second).toEqual({ ok: false, error: "unknown provider" });
    });
  });

  describe("Scenario: Refreshing models for one provider or all of them", () => {
    it("refreshes one, then all", async () => {
      // @step Given the daemon answers refresh_models_cache with two models
      const { daemon, feed } = setup();
      daemon.handlers.refreshModelsCache = () => ({ ok: true, value: [model("a"), model("b")] });
      // @step When the client refreshes anthropic and then refreshes all providers with fspec.settings.refresh-models
      const one = await feed.refreshModels({ providerId: "anthropic" });
      const all = await feed.refreshModels({ providerId: "" });
      // @step Then the daemon receives refresh_models_cache("anthropic") and then refresh_models_cache("")
      expect(daemon.sent("refreshModelsCache").map((request) => request.providerId)).toEqual(["anthropic", ""]);
      // @step And each answer carries the two models
      for (const answer of [one, all]) {
        expect(answer).toMatchObject({ ok: true, models: [{ id: "a" }, { id: "b" }] });
      }
    });
  });

  describe("Scenario: Every settings RPC reports an unreachable daemon", () => {
    it("answers unavailable with the provider's diagnostic", async () => {
      // @step Given no fspec daemon is running
      const home = tempHome();
      const feed = createSettingsFeed({ env: {}, homeDir: home.homeDir });
      disposers.push(home.dispose, () => feed.close());
      // @step When the client calls each fspec.settings RPC
      const answers = [
        await feed.list({}),
        await feed.saveCredentials({ providerId: "openai", credential: { kind: "api_key", apiKey: "k" } }),
        await feed.removeCredentials({ providerId: "openai" }),
        await feed.test({ providerId: "openai" }),
        await feed.refreshModels({ providerId: "" }),
      ];
      // @step Then each answers state "unavailable" with the reason "no fspec daemon is running — no live entry in …; start fspec daemon first"
      for (const answer of answers) {
        expect(answer).toMatchObject({ state: "unavailable" });
        expect((answer as { reason: string }).reason).toMatch(/^no fspec daemon is running — no live entry in .*; start fspec daemon first$/);
      }
    });
  });

  describe("Scenario: Credential changes made anywhere change the catalog cache key", () => {
    it("derives the key from the daemon's credential state", async () => {
      // @step Given Paseo has the fspec catalog cache key for the current credentials
      const home = tempHome();
      home.writeDaemonEntry();
      disposers.push(home.dispose);
      const daemon = new FakeDaemon();
      let rows: wire.ProviderCredentialInfo[] = [anthropic, openai];
      daemon.handlers.listProviderCredentials = () => rows;
      const provider = createFspecProvider(daemonOptions(home, daemon));
      const before = await provider.getCatalogCacheKey!({ scope: "global" });
      expect(before).toEqual(expect.any(String));
      expect(await provider.getCatalogCacheKey!({ scope: "global" })).toBe(before);
      // @step When a key is added for openai, from Paseo or from the fspec TUI
      rows = [anthropic, { ...openai, configured: true, maskedKey: "sk-••••abcd", source: "file", modelCount: 30 }];
      // @step Then the fspec provider's next catalog cache key differs, so Paseo re-fetches the catalog and lists OpenAI's models
      const after = await provider.getCatalogCacheKey!({ scope: "global" });
      expect(after).toEqual(expect.any(String));
      expect(after).not.toBe(before);
      // The key never carries a masked key in clear.
      expect(after).not.toContain("abcd");
      // Each lookup releases its socket.
      expect(daemon.sockets.every((socket) => socket.readyState !== 1)).toBe(true);
    });
  });

  describe("Scenario: The catalog cache key lookup fails with the daemon's reason", () => {
    it("rejects with the discovery error", async () => {
      // @step Given no fspec daemon is running
      const home = tempHome();
      disposers.push(home.dispose);
      const provider = createFspecProvider({ env: {}, homeDir: home.homeDir });
      // @step When Paseo asks the fspec provider for its catalog cache key
      const key = provider.getCatalogCacheKey!({ scope: "global" });
      // @step Then the lookup rejects with "no fspec daemon is running — no live entry in …; start fspec daemon first", which Paseo shows as the provider's error
      await expect(key).rejects.toThrow(/^no fspec daemon is running — no live entry in .*; start fspec daemon first$/);
    });
  });

  describe("Scenario: A refused credential listing fails the catalog cache key", () => {
    it("rejects with the daemon's error", async () => {
      // @step Given list_provider_credentials answers the error "credential store locked"
      const home = tempHome();
      home.writeDaemonEntry();
      disposers.push(home.dispose);
      const daemon = new FakeDaemon();
      daemon.handlers.listProviderCredentials = () => {
        throw new Error("credential store locked");
      };
      const provider = createFspecProvider(daemonOptions(home, daemon));
      // @step When Paseo asks the fspec provider for its catalog cache key
      const key = provider.getCatalogCacheKey!({ scope: "global" });
      // @step Then the lookup rejects with "fspec daemon list_provider_credentials failed: credential store locked"
      await expect(key).rejects.toThrow("fspec daemon list_provider_credentials failed: credential store locked");
      expect(daemon.sockets.every((socket) => socket.readyState !== 1)).toBe(true);
    });
  });

  describe("Scenario: A credential row fspec lists no provider for is unlisted", () => {
    it("answers listing from the provider section, or unlisted without one", async () => {
      // @step Given the fspec daemon lists credentials for anthropic and openai but list_providers has a reachable section only for anthropic
      const { feed } = setup();
      // @step When the client calls fspec.settings.list
      const listed = await feed.list({});
      if (listed.state !== "ready") throw new Error(listed.reason);
      const byId = new Map(listed.providers.map((row) => [row.id, row]));
      // @step Then anthropic has listing "reachable"
      expect(byId.get("anthropic")?.listing).toBe("reachable");
      // @step And openai has listing "unlisted" and no models
      expect(byId.get("openai")).toMatchObject({ listing: "unlisted", models: [] });
    });
  });

  describe("Scenario: A provider section with no credential row reports no configuration", () => {
    it("answers configured and credential type null, listing from the section", async () => {
      // @step Given the fspec daemon lists no credential row for openai and list_providers has a reachable section "openai:Strata" for profile "Strata" and an unreachable section "openai:spark" for profile "spark"
      const { daemon, feed } = setup([anthropic]);
      daemon.handlers.listProviders = (): wire.ProviderInfo[] => [
        { key: "openai:Strata", displayName: "openai: Strata", models: [model("qwen")], profileName: "Strata", isUnreachable: false, providerId: "openai" },
        { key: "openai:spark", displayName: "openai: spark", models: [], profileName: "spark", isUnreachable: true, providerId: "openai" },
      ];
      // @step When the client calls fspec.settings.list
      const listed = await feed.list({});
      if (listed.state !== "ready") throw new Error(listed.reason);
      const byId = new Map(listed.providers.map((row) => [row.id, row]));
      // @step Then "openai:Strata" has configured null, credential type null and listing "reachable"
      expect(byId.get("openai:Strata")).toMatchObject({ configured: null, credentialType: null, listing: "reachable" });
      // @step And "openai:spark" has configured null, credential type null and listing "unreachable"
      expect(byId.get("openai:spark")).toMatchObject({ configured: null, credentialType: null, listing: "unreachable" });
    });
  });
});
