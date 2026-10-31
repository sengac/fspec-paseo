/**
 * Feature: spec/features/fspec-provider-settings-feed.feature
 *
 * fspec's provider settings for Paseo plugin UI (FSPEC-042): the provider list
 * with credential state, saving and removing keys, connection tests and model
 * refreshes, each through the daemon's own RPCs. One daemon client of its own,
 * opened on first use. Keys travel to the daemon only: nothing here returns,
 * logs or echoes one.
 */
import type {
  OAuthStartInput,
  OAuthStartOutput,
  OAuthStatusOutput,
  Definition,
  ProviderSettingsOutput,
  RefreshModelsOutput,
  RemoveCredentialsOutput,
  SaveCredentialsInput,
  SaveCredentialsOutput,
  SaveProfileInput,
  SettingsListOutput,
  SettingsProvider,
  StoredDefinition,
  TestProviderOutput,
  WriteOutput,
} from "../shared/settings.js";
import {
  createFspecDaemonClient,
  type DaemonClientOptions,
  type DaemonConnection,
  type FspecDaemonClient,
} from "./daemon.js";
import { createOAuthLogins } from "./oauth.js";
import type {
  DecodedResponse,
  FspecServiceRequest,
  ModelEntry,
  ProfileDefinition,
  ProviderCredentialInput,
  ProviderSettingsConfig,
} from "./wire.js";

export interface SettingsFeed {
  list(input: Record<string, never>): Promise<SettingsListOutput>;
  saveCredentials(input: SaveCredentialsInput): Promise<SaveCredentialsOutput>;
  removeCredentials(input: { providerId: string }): Promise<RemoveCredentialsOutput>;
  test(input: { providerId: string }): Promise<TestProviderOutput>;
  refreshModels(input: { providerId: string }): Promise<RefreshModelsOutput>;
  /** A provider's settings and profiles (FSPEC-045), every key replaced by apiKeySet. */
  providerSettings(input: { providerId: string }): Promise<ProviderSettingsOutput>;
  saveSettings(input: { providerId: string; definition: Definition }): Promise<WriteOutput>;
  saveProfile(input: SaveProfileInput): Promise<WriteOutput>;
  deleteProfile(input: { providerId: string; name: string }): Promise<WriteOutput>;
  /** Makes a "provider/model" fspec's default model (FSPEC-046). */
  setDefaultModel(input: { model: string }): Promise<WriteOutput>;
  /** OAuth sign-in and log-out (FSPEC-044). */
  oauthStart(input: OAuthStartInput): Promise<OAuthStartOutput>;
  oauthComplete(input: { loginId: string; code: string }): Promise<WriteOutput>;
  oauthStatus(input: { loginId: string }): Promise<OAuthStatusOutput>;
  oauthCancel(input: { loginId: string }): Promise<{ ok: true }>;
  oauthLogout(input: { providerId: string }): Promise<WriteOutput>;
  close(): Promise<void>;
}

/** Shown when a removed key lives in the daemon's environment and will come back. */
export const ENVIRONMENT_KEY_WARNING =
  "The key was removed from the running fspec daemon, but it returns when the fspec daemon restarts unless you also remove it from the environment or .env file it came from.";

const UNLOADED = { state: "unavailable", reason: "the fspec plugin was unloaded" } as const;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function models(entries: readonly ModelEntry[]) {
  return entries.map((entry) => ({ id: entry.id, displayName: entry.displayName, contextWindow: entry.contextWindow }));
}

/** A stored definition for the client: the key becomes a flag. */
function stored(definition: ProfileDefinition): StoredDefinition {
  const { apiKey, ...rest } = definition;
  return { ...rest, apiKeySet: apiKey !== "" };
}

/** The daemon's struct from a client definition plus the key to store. */
function profileDefinition(definition: Definition, apiKey: string): ProfileDefinition {
  return { ...definition, apiKey };
}

/** The daemon's flat credential struct from a Paseo credential form. */
function credentialInput(credential: SaveCredentialsInput["credential"]): ProviderCredentialInput {
  const empty = { apiKey: null, oauthToken: null, oauthRefreshToken: null, customEndpoint: null, customApiKey: null };
  return credential.kind === "api_key"
    ? { ...empty, kind: "api_key", apiKey: credential.apiKey }
    : { ...empty, kind: "custom", customEndpoint: credential.endpoint, customApiKey: credential.apiKey };
}

export function createSettingsFeed(
  options: DaemonClientOptions = {},
  tuning: { oauthHoldMs?: number } = {},
): SettingsFeed {
  let closed = false;
  let daemon: FspecDaemonClient | null = null;
  let live: Promise<DaemonConnection> | null = null;

  function client(): FspecDaemonClient {
    if (daemon !== null) return daemon;
    const created = createFspecDaemonClient(options);
    created.onEvent((event) => {
      if (event.type === "connection-lost") live = null;
    });
    daemon = created;
    return created;
  }

  /** The connection, (re)connecting after a loss; one attempt at a time. */
  function connection(): Promise<DaemonConnection> {
    if (live !== null) return live;
    const attempt = client().connect();
    live = attempt;
    attempt.catch(() => {
      if (live === attempt) live = null;
    });
    return attempt;
  }

  async function call<M extends FspecServiceRequest["method"]>(
    request: Extract<FspecServiceRequest, { method: M }>,
    callOptions: { deadlineMs?: number } = {},
  ): Promise<Extract<DecodedResponse, { ok: true; method: M }>> {
    const response = await (await connection()).request(request, callOptions);
    // Never echo the request: it may carry a key.
    if (!response.ok) throw new Error(`fspec daemon ${request.method} failed: ${response.error}`);
    return response as Extract<DecodedResponse, { ok: true; method: M }>;
  }

  /** Runs one settings operation; any failure to reach the daemon is "unavailable". */
  async function guarded<T>(run: () => Promise<T>): Promise<T | { state: "unavailable"; reason: string }> {
    if (closed) return UNLOADED;
    try {
      return await run();
    } catch (error) {
      return { state: "unavailable", reason: message(error) };
    }
  }

  const logins = createOAuthLogins(call, tuning.oauthHoldMs);

  /** One provider's stored settings and profiles, keys included: server-side only. */
  async function settingsOf(providerId: string): Promise<ProviderSettingsConfig | null> {
    const { result } = await call({ method: "listProviderSettings" });
    if (!result.ok) throw new Error(result.error);
    return result.value.find((config) => config.providerId === providerId) ?? null;
  }

  function written(result: { ok: true } | { ok: false; error: string }): WriteOutput {
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }

  return {
    list: () =>
      guarded(async () => {
        const { workspace } = await call({ method: "getWorkspaceInfo" });
        const { credentials } = await call({ method: "listProviderCredentials" });
        const { providers } = await call({ method: "listProviders" });
        const settings = await call({ method: "listProviderSettings" });
        const { model: defaultModel } = await call({ method: "getDefaultModel" });
        // Profile names and base URLs only: a profile's api_key never leaves the server.
        const profilesOf = new Map(
          (settings.result.ok ? settings.result.value : []).map((config) => [
            config.providerId,
            config.profiles.map((profile) => ({ name: profile.name, baseUrl: profile.definition.baseUrl })),
          ]),
        );
        const catalog = new Map(providers.map((provider) => [provider.key, provider]));
        const rows: SettingsProvider[] = credentials.map((row) => {
          const provider = catalog.get(row.providerId);
          catalog.delete(row.providerId);
          return {
            id: row.providerId,
            displayName: row.displayName,
            configured: row.configured,
            credentialType: row.credentialType,
            maskedKey: row.maskedKey,
            source: row.source,
            // The daemon's model_count reads 0 for OAuth providers; the listed models are authoritative.
            modelCount: provider?.models.length ?? row.modelCount,
            unreachable: provider?.isUnreachable ?? !row.configured,
            models: models(provider?.models ?? []),
            profiles: profilesOf.get(row.providerId) ?? [],
          };
        });
        // Providers with models but no credential row (custom servers) still show.
        for (const provider of catalog.values()) {
          rows.push({
            id: provider.key,
            displayName: provider.displayName,
            configured: !provider.isUnreachable,
            credentialType: "custom",
            maskedKey: null,
            source: null,
            modelCount: provider.models.length,
            unreachable: provider.isUnreachable,
            models: models(provider.models),
            profiles: profilesOf.get(provider.key) ?? [],
          });
        }
        // Configured first; otherwise the daemon's order (Array#sort is stable).
        rows.sort((a, b) => Number(b.configured) - Number(a.configured));
        return { state: "ready", workspace: workspace.cwd, providers: rows, defaultModel };
      }),

    saveCredentials: ({ providerId, credential }) =>
      guarded(async () => {
        const { result } = await call({
          method: "setProviderCredentials",
          providerId,
          creds: credentialInput(credential),
        });
        return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
      }),

    removeCredentials: ({ providerId }) =>
      guarded(async () => {
        const { credential } = await call({ method: "getProviderCredential", providerId });
        const { result } = await call({ method: "deleteProviderCredentials", providerId });
        if (!result.ok) return { ok: false as const, error: result.error };
        const fromEnvironment = credential?.source === "env" || credential?.source === "dotenv";
        return fromEnvironment ? { ok: true as const, warning: ENVIRONMENT_KEY_WARNING } : { ok: true as const };
      }),

    test: ({ providerId }) =>
      guarded(async () => {
        const { result } = await call({ method: "testProviderConnection", providerId });
        if (!result.ok) return { ok: false as const, error: result.error };
        return { ok: true as const, ...result.value };
      }),

    refreshModels: ({ providerId }) =>
      guarded(async () => {
        const { result } = await call({ method: "refreshModelsCache", providerId });
        return result.ok ? { ok: true as const, models: models(result.value) } : { ok: false as const, error: result.error };
      }),

    providerSettings: ({ providerId }) =>
      guarded(async () => {
        const config = await settingsOf(providerId);
        return {
          state: "ready" as const,
          settings: config === null ? null : stored(config.settings),
          profiles: (config?.profiles ?? []).map((profile) => ({ name: profile.name, definition: stored(profile.definition) })),
        };
      }),

    saveSettings: ({ providerId, definition }) =>
      guarded(async () => {
        // The settings form never edits the key: keep the stored one.
        const config = await settingsOf(providerId);
        const { result } = await call({
          method: "saveProviderSettings",
          providerId,
          definition: profileDefinition(definition, config?.settings.apiKey ?? ""),
        });
        return written(result);
      }),

    saveProfile: ({ providerId, originalName, name, definition, apiKey }) =>
      guarded(async () => {
        let key = apiKey;
        if (key === null) {
          // An untouched key field keeps the profile's stored key.
          const config = await settingsOf(providerId);
          key = config?.profiles.find((profile) => profile.name === (originalName ?? name))?.definition.apiKey ?? "";
        }
        const full = profileDefinition(definition, key);
        const { result } =
          originalName !== null && originalName !== name
            ? await call({ method: "renameProfile", providerId, oldName: originalName, newName: name, definition: full })
            : await call({ method: "saveProfile", providerId, profileName: name, definition: full });
        return written(result);
      }),

    deleteProfile: ({ providerId, name }) =>
      guarded(async () => {
        const { result } = await call({ method: "deleteProfile", providerId, profileName: name });
        return written(result);
      }),

    setDefaultModel: ({ model }) =>
      guarded(async () => written((await call({ method: "setDefaultModel", model })).result)),

    oauthStart: (input) => guarded(() => logins.start(input)),
    oauthComplete: (input) => guarded(() => logins.complete(input)),
    oauthStatus: async (input) => (closed ? { state: "unknown" as const } : logins.status(input)),
    oauthCancel: async (input) => logins.cancel(input),
    oauthLogout: (input) => guarded(() => logins.logout(input)),

    async close() {
      if (closed) return;
      closed = true;
      logins.close();
      await daemon?.close();
    },
  };
}
