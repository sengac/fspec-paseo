/**
 * Feature: spec/features/fspec-wire-provider-settings.feature
 *
 * The provider settings, credential, model-cache and OAuth RPCs (FspecService
 * variant indices 30-38 and 88-101) byte-match Rust golden vectors produced by
 * bincode-serializing the real codelet-rpc-types values (FSPEC-041 attachment).
 * `<name>_args` vectors are the request bytes after the u32 variant index;
 * `<name>_reply` vectors are the response payload after its u32 variant index.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as wire from "../server/wire.js";

const V = new Map(
  readFileSync(fileURLToPath(new URL("./golden/golden-vectors.txt", import.meta.url)), "utf8")
    .trim()
    .split("\n")
    .map((line) => line.split(" ") as [string, string]),
);

function vector(name: string): string {
  const hex = V.get(name);
  if (hex === undefined) throw new Error(`missing golden vector ${name}`);
  return hex;
}

function index(n: number): string {
  return Buffer.from(new Uint32Array([n]).buffer).toString("hex");
}

/** The request frame tail: u32 variant index + argument bytes. */
function encoded(message: wire.FspecServiceRequest): string {
  return Buffer.from(wire.encodeRequestFrame({ id: 0, message })).toString("hex");
}

function expectTail(message: wire.FspecServiceRequest, variant: number, args: string): void {
  expect(encoded(message).endsWith(index(variant) + args)).toBe(true);
}

/** Decodes a successful tarpc Response carrying the given service payload. */
function reply(variant: number, payload: string): wire.DecodedResponse {
  const frame = "0000000000000000" + "00000000" + index(variant) + payload;
  return wire.decodeResponseFrame(new Uint8Array(Buffer.from(frame, "hex")));
}

const fullProfile: wire.ProfileDefinition = {
  baseUrl: "http://127.0.0.1:1234/v1",
  apiKey: "lm-key",
  contextWindow: 32768,
  maxOutputTokens: 4096,
  compactionThresholdType: "percent",
  compactionThresholdValue: 80,
  streaming: false,
  autoContinue: 3,
  preserveThinking: true,
  maxImages: 4,
  loopDetectionEnabled: true,
  loopDetectionWindow: 20,
  loopDetectionMaxRepeats: 5,
  loopDetectionMaxRetries: 2,
};

const bareProfile: wire.ProfileDefinition = {
  baseUrl: "http://localhost:11434/v1",
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

const customModel: wire.CustomModelDefinition = {
  id: "qwen3-coder",
  displayName: "Qwen3 Coder",
  facade: null,
  contextWindow: 65536,
  maxOutputTokens: null,
  compactionThresholdType: null,
  compactionThresholdValue: null,
  reasoning: true,
  hasVision: false,
};

const configuredRow: wire.ProviderCredentialInfo = {
  providerId: "anthropic",
  displayName: "Anthropic",
  configured: true,
  credentialType: "api_key",
  modelCount: 12,
  maskedKey: "sk-ant-••••mnop",
  source: "file",
};

const apiKeyInput = (apiKey: string): wire.ProviderCredentialInput => ({
  kind: "api_key",
  apiKey,
  oauthToken: null,
  oauthRefreshToken: null,
  customEndpoint: null,
  customApiKey: null,
});

describe("Feature: Encode fspec's provider settings and credential RPCs", () => {
  describe("Scenario: Saving and removing an API key encode byte-identical to Rust", () => {
    it("encodes set_provider_credentials and delete_provider_credentials", () => {
      // @step Given the Rust golden vectors for set_provider_credentials("anthropic", { kind: "api_key", api_key: Some("sk-ant-test"), every other Option None }) and delete_provider_credentials("anthropic")
      const set = vector("set_provider_credentials_args");
      const remove = vector("delete_provider_credentials_args");
      // @step When the codec encodes both requests
      const message: wire.FspecServiceRequest = {
        method: "setProviderCredentials",
        providerId: "anthropic",
        creds: apiKeyInput("sk-ant-test"),
      };
      // @step Then the bytes equal the golden vectors, using variant indices 90 and 91
      expectTail(message, 90, set);
      expectTail({ method: "deleteProviderCredentials", providerId: "anthropic" }, 91, remove);
      // The custom-endpoint form exercises the remaining Option slots.
      expectTail(
        {
          method: "setProviderCredentials",
          providerId: "lmstudio",
          creds: {
            kind: "custom",
            apiKey: null,
            oauthToken: null,
            oauthRefreshToken: null,
            customEndpoint: "http://127.0.0.1:1234/v1",
            customApiKey: "lm-key",
          },
        },
        90,
        vector("set_provider_credentials_custom_args"),
      );
      expect(reply(90, vector("void_ok_reply"))).toMatchObject({
        method: "setProviderCredentials",
        result: { ok: true },
      });
    });
  });

  describe("Scenario: Provider credential rows decode configured and unconfigured", () => {
    it("decodes list_provider_credentials", () => {
      // @step Given the Rust golden vector for a list_provider_credentials response with a configured row and an unconfigured row
      const payload = vector("list_provider_credentials_reply");
      expectTail({ method: "listProviderCredentials" }, 88, "");
      // @step When the codec decodes that response
      const decoded = reply(88, payload);
      expect(decoded).toMatchObject({ ok: true, method: "listProviderCredentials" });
      const rows = (decoded as Extract<wire.DecodedResponse, { method: "listProviderCredentials" }>).credentials;
      // @step Then the configured row has masked_key "sk-ant-••••mnop" and source "file"
      expect(rows[0]).toEqual(configuredRow);
      // @step And the unconfigured row has configured false with masked_key and source absent
      expect(rows[1]).toEqual({
        providerId: "openai",
        displayName: "OpenAI",
        configured: false,
        credentialType: "api_key",
        modelCount: 0,
        maskedKey: null,
        source: null,
      });
    });
  });

  describe("Scenario: A connection test decodes both a failed test and a daemon error", () => {
    it("decodes test_provider_connection Ok and Err", () => {
      // @step Given the Rust golden vectors for test_provider_connection returning Ok({ success: false, error: Some("401 Unauthorized"), latency_ms: 812 }) and Err("unknown provider")
      expectTail({ method: "testProviderConnection", providerId: "anthropic" }, 92, vector("test_provider_connection_args"));
      // @step When the codec decodes both responses
      const failed = reply(92, vector("test_provider_connection_ok_reply"));
      const refused = reply(92, vector("test_provider_connection_err_reply"));
      // @step Then the first yields { success: false, error: "401 Unauthorized", latencyMs: 812 }
      expect(failed).toMatchObject({
        method: "testProviderConnection",
        result: { ok: true, value: { success: false, error: "401 Unauthorized", latencyMs: 812 } },
      });
      // @step And the second yields { ok: false, error: "unknown provider" } without throwing
      expect(refused).toMatchObject({
        method: "testProviderConnection",
        result: { ok: false, error: "unknown provider" },
      });
    });
  });

  describe("Scenario: A single credential lookup decodes both absent and present", () => {
    it("decodes get_provider_credential None and Some", () => {
      // @step Given the Rust golden vectors for get_provider_credential returning None and Some(info)
      expectTail({ method: "getProviderCredential", providerId: "anthropic" }, 89, vector("get_provider_credential_args"));
      // @step When the codec decodes both responses
      const none = reply(89, vector("get_provider_credential_none_reply"));
      const some = reply(89, vector("get_provider_credential_some_reply"));
      // @step Then the first yields no credential and the second yields the full credential row
      expect(none).toMatchObject({ method: "getProviderCredential", credential: null });
      expect(some).toMatchObject({ method: "getProviderCredential", credential: configuredRow });
    });
  });

  describe("Scenario: Refreshing every provider's models uses an empty provider id", () => {
    it("encodes refresh_models_cache(\"\") and decodes its models", () => {
      // @step Given the Rust golden vectors for refresh_models_cache("") and its Ok(Vec<ModelEntry>) response containing a custom model
      const args = vector("refresh_models_cache_all_args");
      // @step When the codec encodes the request and decodes the response
      const decoded = reply(93, vector("refresh_models_cache_reply"));
      // @step Then the request bytes equal the golden vector with an empty provider id
      expectTail({ method: "refreshModelsCache", providerId: "" }, 93, args);
      // @step And the custom model decodes with isCustom true
      expect(decoded).toMatchObject({
        method: "refreshModelsCache",
        result: {
          ok: true,
          value: [
            { id: "claude-sonnet-5-5", contextWindow: 200000, isCustom: false },
            { id: "qwen3-coder", displayName: "Qwen3 Coder", supportsVision: false, isCustom: true },
          ],
        },
      });
    });
  });

  describe("Scenario: Provider settings decode with zero and two profiles", () => {
    it("decodes list_provider_settings", () => {
      // @step Given the Rust golden vector for a list_provider_settings response with one provider without profiles and one with two profiles
      const payload = vector("list_provider_settings_reply");
      expectTail({ method: "listProviderSettings" }, 34, "");
      // @step When the codec decodes that response
      const decoded = reply(34, payload);
      // @step Then every ProfileDefinition field decodes, including streaming absent versus false
      expect(decoded).toMatchObject({
        method: "listProviderSettings",
        result: {
          ok: true,
          value: [
            { providerId: "ollama", settings: bareProfile, profiles: [] },
            {
              providerId: "lmstudio",
              settings: fullProfile,
              profiles: [
                { name: "fast", definition: bareProfile },
                { name: "big", definition: fullProfile },
              ],
            },
          ],
        },
      });
    });
  });

  describe("Scenario: The Copilot device sign-in encodes with and without an enterprise host", () => {
    it("encodes oauth_copilot_device_start and decodes OAuthDeviceStart", () => {
      // @step Given the Rust golden vectors for oauth_copilot_device_start(None), oauth_copilot_device_start(Some("ghe.example.com")) and an OAuthDeviceStart response with interval 5
      const none = vector("oauth_copilot_device_start_none_args");
      const ghe = vector("oauth_copilot_device_start_ghe_args");
      // @step When the codec encodes both requests and decodes the response
      const decoded = reply(101, vector("oauth_device_start_reply"));
      // @step Then both requests equal their golden vectors
      expectTail({ method: "oauthCopilotDeviceStart", enterpriseHost: null }, 101, none);
      expectTail({ method: "oauthCopilotDeviceStart", enterpriseHost: "ghe.example.com" }, 101, ghe);
      // @step And the response yields the user code, verification URL, device auth id and interval 5
      expect(decoded).toMatchObject({
        method: "oauthCopilotDeviceStart",
        result: {
          ok: true,
          value: {
            userCode: "ABCD-1234",
            verificationUrl: "https://github.com/login/device",
            deviceAuthId: "dev-1",
            interval: 5,
          },
        },
      });
    });
  });

  describe("Scenario: A decode failure never echoes a secret", () => {
    it("reports offset and type, not the key", () => {
      // @step Given a set_provider_credentials request frame whose api_key is "sk-ant-secret" and that is truncated inside the trailing Options
      const full = wire.encodeRequestFrame({
        id: 0,
        message: { method: "setProviderCredentials", providerId: "anthropic", creds: apiKeyInput("sk-ant-secret") },
      });
      const truncated = full.slice(0, full.length - 2);
      // @step When the codec decodes that frame
      let message = "";
      try {
        wire.decodeRequestFrame(truncated);
      } catch (error) {
        message = (error as Error).message;
      }
      // @step Then the error names the offset and the type being read
      expect(message).toMatch(/offset \d+/);
      expect(message).toMatch(/ProviderCredentialInput/);
      // @step And the error text does not contain "sk-ant-secret"
      expect(message).not.toContain("sk-ant-secret");
    });
  });

  describe("Scenario: Setting the default model encodes byte-identical to Rust", () => {
    it("encodes set_default_model and decodes Ok(())", () => {
      // @step Given the Rust golden vectors for set_default_model("anthropic/claude-sonnet-5-5") and its Ok(()) response
      const args = vector("set_default_model_args");
      // @step When the codec encodes the request and decodes the response
      const decoded = reply(30, vector("void_ok_reply"));
      // @step Then the request bytes equal the golden vector, using variant index 30
      expectTail({ method: "setDefaultModel", model: "anthropic/claude-sonnet-5-5" }, 30, args);
      // @step And the response yields { ok: true }
      expect(decoded).toMatchObject({ method: "setDefaultModel", result: { ok: true } });
    });
  });

  describe("Scenario: Custom model writes encode byte-identical to Rust", () => {
    it("encodes add/update/delete_custom_model", () => {
      // @step Given the Rust golden vectors for add_custom_model, update_custom_model and delete_custom_model with a CustomModelDefinition mixing present and absent Options
      const add = vector("add_custom_model_args");
      const update = vector("update_custom_model_args");
      const remove = vector("delete_custom_model_args");
      // @step When the codec encodes those requests
      const base = { providerId: "lmstudio", profileName: "default" };
      // @step Then each equals its golden vector, using variant indices 31, 32 and 33
      expectTail({ method: "addCustomModel", ...base, definition: customModel }, 31, add);
      expectTail({ method: "updateCustomModel", ...base, originalModelId: "qwen3", definition: customModel }, 32, update);
      expectTail({ method: "deleteCustomModel", ...base, modelId: "qwen3-coder" }, 33, remove);
      for (const variant of [31, 32, 33]) expect(reply(variant, vector("void_ok_reply"))).toMatchObject({ result: { ok: true } });
    });
  });

  describe("Scenario: Profile writes encode byte-identical to Rust", () => {
    it("encodes the profile writes", () => {
      // @step Given the Rust golden vectors for save_provider_settings, save_profile, rename_profile and delete_profile with a ProfileDefinition setting every optional field
      const saveSettings = vector("save_provider_settings_args");
      const save = vector("save_profile_args");
      const rename = vector("rename_profile_args");
      const remove = vector("delete_profile_args");
      // @step When the codec encodes those requests
      const providerId = "lmstudio";
      // @step Then each equals its golden vector, using variant indices 35, 36, 38 and 37
      expectTail({ method: "saveProviderSettings", providerId, definition: fullProfile }, 35, saveSettings);
      expectTail({ method: "saveProfile", providerId, profileName: "big", definition: fullProfile }, 36, save);
      expectTail({ method: "renameProfile", providerId, oldName: "big", newName: "huge", definition: fullProfile }, 38, rename);
      expectTail({ method: "deleteProfile", providerId, profileName: "fast" }, 37, remove);
      for (const variant of [35, 36, 37, 38]) expect(reply(variant, vector("void_ok_reply"))).toMatchObject({ result: { ok: true } });
    });
  });

  describe("Scenario: The OAuth sign-in methods round-trip against Rust", () => {
    it("encodes every OAuth request and decodes every reply", () => {
      // @step Given the Rust golden vectors for every request and response of oauth_clear_tokens, oauth_get_tokens, oauth_browser_login, oauth_headless_start, oauth_headless_complete, oauth_device_start and oauth_device_poll
      const providerId = "anthropic";
      // @step When the codec encodes each request and decodes each response
      const tokens = reply(95, vector("oauth_get_tokens_reply"));
      const headless = reply(97, vector("oauth_headless_start_reply"));
      const device = reply(99, vector("oauth_device_start_reply"));
      // @step Then every request equals its golden vector, using variant indices 94 to 100
      expectTail({ method: "oauthClearTokens", providerId }, 94, vector("oauth_clear_tokens_args"));
      expectTail({ method: "oauthGetTokens", providerId }, 95, vector("oauth_get_tokens_args"));
      expectTail({ method: "oauthBrowserLogin", providerId }, 96, vector("oauth_browser_login_args"));
      expectTail({ method: "oauthHeadlessStart", providerId }, 97, vector("oauth_headless_start_args"));
      expectTail(
        { method: "oauthHeadlessComplete", providerId, codeWithState: "code#state", pkceVerifier: "verifier-123" },
        98,
        vector("oauth_headless_complete_args"),
      );
      expectTail({ method: "oauthDeviceStart", providerId: "codex" }, 99, vector("oauth_device_start_args"));
      expectTail(
        { method: "oauthDevicePoll", providerId: "codex", deviceAuthId: "dev-1", interval: 5 },
        100,
        vector("oauth_device_poll_args"),
      );
      for (const variant of [94, 96, 98, 100]) expect(reply(variant, vector("void_ok_reply"))).toMatchObject({ result: { ok: true } });
      expect(device).toMatchObject({ method: "oauthDeviceStart", result: { ok: true, value: { deviceAuthId: "dev-1", interval: 5 } } });
      // @step And oauth_headless_start yields its authorize URL and PKCE verifier, and oauth_get_tokens yields true
      expect(headless).toMatchObject({
        method: "oauthHeadlessStart",
        result: {
          ok: true,
          value: { authorizeUrl: "https://claude.ai/oauth/authorize?state=x", pkceVerifier: "verifier-123" },
        },
      });
      expect(tokens).toMatchObject({ method: "oauthGetTokens", result: { ok: true, value: true } });
    });
  });
});
