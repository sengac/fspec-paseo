import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Why the settings cannot be served (no daemon, connection lost, plugin unloaded). */
const unavailableSchema = z.object({ state: z.literal("unavailable"), reason: z.string() });

/**
 * One model a provider offers, as list_providers reports it. A custom model
 * (one a profile defines, FSPEC-047) also says so, with its capabilities.
 */
export const settingsModelSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  contextWindow: z.number(),
  isCustom: z.boolean().optional(),
  supportsReasoning: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
});

/**
 * One provider fspec knows, configured or not. The key only ever arrives
 * masked; `source` says where a configured key lives (explicit, file, env, dotenv).
 */
export const settingsProviderSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  configured: z.boolean(),
  credentialType: z.string(),
  maskedKey: z.string().nullable(),
  source: z.string().nullable(),
  modelCount: z.number(),
  unreachable: z.boolean(),
  models: z.array(settingsModelSchema),
  /** The provider's named profiles (list_provider_settings); never their keys. */
  profiles: z.array(z.object({ name: z.string(), baseUrl: z.string() })),
  /** The base provider (ProviderInfo.provider_id, FSPEC-056); equal to id for a provider row. */
  providerId: z.string(),
  /** The profile a section row is (ProviderInfo.profile_name); null for a provider row. */
  profileName: z.string().nullable(),
});

export const settingsListRpc = defineRpc({
  name: "fspec.settings.list",
  input: z.object({}),
  output: z.discriminatedUnion("state", [
    z.object({
      state: z.literal("ready"),
      workspace: z.string(),
      providers: z.array(settingsProviderSchema),
      /** fspec's default model as "provider/model" (get_default_model), null when none is set. */
      defaultModel: z.string().nullable(),
    }),
    unavailableSchema,
  ]),
});

const failedSchema = z.object({ ok: z.literal(false), error: z.string() });

/** An API key, or a custom OpenAI-compatible endpoint with an optional key. */
export const credentialSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("api_key"), apiKey: z.string().min(1) }),
  z.object({ kind: z.literal("custom"), endpoint: z.string().min(1), apiKey: z.string().nullable() }),
]);

export const saveCredentialsRpc = defineRpc({
  name: "fspec.settings.save-credentials",
  input: z.object({ providerId: z.string(), credential: credentialSchema }),
  output: z.union([z.object({ ok: z.literal(true) }), failedSchema, unavailableSchema]),
});

/** `warning` is set when the removed key will come back from the environment. */
export const removeCredentialsRpc = defineRpc({
  name: "fspec.settings.remove-credentials",
  input: z.object({ providerId: z.string() }),
  output: z.union([z.object({ ok: z.literal(true), warning: z.string().optional() }), failedSchema, unavailableSchema]),
});

export const testProviderRpc = defineRpc({
  name: "fspec.settings.test",
  input: z.object({ providerId: z.string() }),
  output: z.union([
    z.object({ ok: z.literal(true), success: z.boolean(), error: z.string().nullable(), latencyMs: z.number() }),
    failedSchema,
    unavailableSchema,
  ]),
});

/** An empty providerId refreshes every provider's model cache. */
export const refreshModelsRpc = defineRpc({
  name: "fspec.settings.refresh-models",
  input: z.object({ providerId: z.string() }),
  output: z.union([
    z.object({ ok: z.literal(true), models: z.array(settingsModelSchema) }),
    failedSchema,
    unavailableSchema,
  ]),
});

export type SettingsProvider = z.infer<typeof settingsProviderSchema>;
export type SettingsListOutput = z.infer<typeof settingsListRpc.output>;
export type SaveCredentialsInput = z.infer<typeof saveCredentialsRpc.input>;
export type SaveCredentialsOutput = z.infer<typeof saveCredentialsRpc.output>;
export type RemoveCredentialsOutput = z.infer<typeof removeCredentialsRpc.output>;
export type TestProviderOutput = z.infer<typeof testProviderRpc.output>;
export type RefreshModelsOutput = z.infer<typeof refreshModelsRpc.output>;

/**
 * A provider's settings or one profile, as the client edits it: the daemon's
 * ProfileDefinition without the API key (FSPEC-045).
 */
export const definitionSchema = z.object({
  baseUrl: z.string(),
  contextWindow: z.number().nullable(),
  maxOutputTokens: z.number().nullable(),
  compactionThresholdType: z.string().nullable(),
  compactionThresholdValue: z.number().nullable(),
  streaming: z.boolean().nullable(),
  autoContinue: z.number().nullable(),
  preserveThinking: z.boolean().nullable(),
  maxImages: z.number().nullable(),
  loopDetectionEnabled: z.boolean().nullable(),
  loopDetectionWindow: z.number().nullable(),
  loopDetectionMaxRepeats: z.number().nullable(),
  loopDetectionMaxRetries: z.number().nullable(),
});

/** A stored definition as the client sees it: whether a key is set, never the key. */
export const storedDefinitionSchema = definitionSchema.extend({ apiKeySet: z.boolean() });

export const providerSettingsRpc = defineRpc({
  name: "fspec.settings.provider-settings",
  input: z.object({ providerId: z.string() }),
  output: z.discriminatedUnion("state", [
    z.object({
      state: z.literal("ready"),
      settings: storedDefinitionSchema.nullable(),
      profiles: z.array(z.object({ name: z.string(), definition: storedDefinitionSchema })),
    }),
    unavailableSchema,
  ]),
});

const writeOutput = z.union([z.object({ ok: z.literal(true) }), failedSchema, unavailableSchema]);

export const saveSettingsRpc = defineRpc({
  name: "fspec.settings.save-settings",
  input: z.object({ providerId: z.string(), definition: definitionSchema }),
  output: writeOutput,
});

/** `apiKey` null keeps the stored key; a rename happens when `name` differs from `originalName`. */
export const saveProfileRpc = defineRpc({
  name: "fspec.settings.save-profile",
  input: z.object({
    providerId: z.string(),
    originalName: z.string().nullable(),
    name: z.string().min(1),
    definition: definitionSchema,
    apiKey: z.string().nullable(),
  }),
  output: writeOutput,
});

export const deleteProfileRpc = defineRpc({
  name: "fspec.settings.delete-profile",
  input: z.object({ providerId: z.string(), name: z.string() }),
  output: writeOutput,
});

/** A custom model of a profile, as fspec stores it (rpc-types CustomModelDefinition). */
export const customModelDefinitionSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().nullable(),
  facade: z.string().nullable(),
  contextWindow: z.number().nullable(),
  maxOutputTokens: z.number().nullable(),
  compactionThresholdType: z.string().nullable(),
  compactionThresholdValue: z.number().nullable(),
  reasoning: z.boolean().nullable(),
  hasVision: z.boolean().nullable(),
});

/** Adds a custom model to a profile, or replaces the one `originalId` names (FSPEC-047). */
export const saveCustomModelRpc = defineRpc({
  name: "fspec.settings.save-custom-model",
  input: z.object({
    providerId: z.string(),
    profile: z.string(),
    originalId: z.string().nullable(),
    definition: customModelDefinitionSchema,
  }),
  output: writeOutput,
});

export const deleteCustomModelRpc = defineRpc({
  name: "fspec.settings.delete-custom-model",
  input: z.object({ providerId: z.string(), profile: z.string(), id: z.string() }),
  output: writeOutput,
});

export type SettingsModel = z.infer<typeof settingsModelSchema>;
export type CustomModelInput = z.infer<typeof customModelDefinitionSchema>;
export type SaveCustomModelInput = z.infer<typeof saveCustomModelRpc.input>;

/** Makes "provider/model" fspec's default model (set_default_model, FSPEC-046). */
export const setDefaultModelRpc = defineRpc({
  name: "fspec.settings.set-default-model",
  input: z.object({ model: z.string().min(1) }),
  output: writeOutput,
});

export type Definition = z.infer<typeof definitionSchema>;
export type StoredDefinition = z.infer<typeof storedDefinitionSchema>;
export type ProviderSettingsOutput = z.infer<typeof providerSettingsRpc.output>;
export type SaveProfileInput = z.infer<typeof saveProfileRpc.input>;
export type WriteOutput = z.infer<typeof writeOutput>;

/** What a started sign-in shows (FSPEC-044); the PKCE verifier never leaves the server. */
export const oauthStepSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("browser") }),
  z.object({ kind: z.literal("code"), authorizeUrl: z.string() }),
  z.object({ kind: z.literal("device"), userCode: z.string(), verificationUrl: z.string() }),
]);

export const oauthStartRpc = defineRpc({
  name: "fspec.settings.oauth-start",
  input: z.object({
    providerId: z.string(),
    method: z.enum(["browser", "code", "device"]),
    /** GitHub Enterprise host for github-copilot; null for github.com. */
    enterpriseHost: z.string().nullable(),
  }),
  output: z.union([
    z.object({ ok: z.literal(true), loginId: z.string(), step: oauthStepSchema }),
    failedSchema,
    unavailableSchema,
  ]),
});

export const oauthCompleteRpc = defineRpc({
  name: "fspec.settings.oauth-complete",
  input: z.object({ loginId: z.string(), code: z.string().min(1) }),
  output: writeOutput,
});

/** Long-polls a sign-in; answers pending when the server's hold expires first. */
export const oauthStatusRpc = defineRpc({
  name: "fspec.settings.oauth-status",
  input: z.object({ loginId: z.string() }),
  output: z.discriminatedUnion("state", [
    z.object({ state: z.literal("pending") }),
    z.object({ state: z.literal("succeeded") }),
    z.object({ state: z.literal("failed"), error: z.string() }),
    z.object({ state: z.literal("unknown") }),
  ]),
});

export const oauthCancelRpc = defineRpc({
  name: "fspec.settings.oauth-cancel",
  input: z.object({ loginId: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});

export const oauthLogoutRpc = defineRpc({
  name: "fspec.settings.oauth-logout",
  input: z.object({ providerId: z.string() }),
  output: writeOutput,
});

export type OAuthStep = z.infer<typeof oauthStepSchema>;
export type OAuthStartInput = z.infer<typeof oauthStartRpc.input>;
export type OAuthStartOutput = z.infer<typeof oauthStartRpc.output>;
export type OAuthStatusOutput = z.infer<typeof oauthStatusRpc.output>;
