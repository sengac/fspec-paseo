@done
@provider
@core
@FSPEC-041
Feature: Encode fspec's provider settings and credential RPCs

  """
  Same layout as FSPEC-002: the method index map, FspecServiceRequest/response unions, the encoder/decoder switches and the DecodedResponse union in server/wire.ts; payload struct readers/writers next to the existing ProviderInfo/ModelEntry ones. Golden vectors are appended to test/golden/golden-vectors.txt by /tmp/fspec-golden's main.rs; tests extend test/wire.test.ts or a new test/wire-provider-settings.test.ts.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. Each new FspecService method uses its fixed tarpc variant index from the Rust trait declaration order: set_default_model=30 … rename_profile=38 and list_provider_credentials=88 … oauth_copilot_device_start=101; arguments are encoded in declaration order with the existing bincode 1.3.3 fixed-width LE conventions.
  #   2. Every new payload struct (ProviderCredentialInfo, ProviderCredentialInput, TestConnectionResult, OAuthHeadlessStart, OAuthDeviceStart, CustomModelDefinition, ProfileDefinition, ProviderSettingsConfig, ProviderProfileConfig) is encoded/decoded field-for-field in Rust declaration order, re-read from the fspec source at the commit the vectors are generated from.
  #   3. Golden vectors come from the existing scratch crate /tmp/fspec-golden (outside both repos), with the FspecService trait re-copied verbatim from the current fspec commit; the fspec repo is never modified.
  #   4. A service-level Err(String) from the daemon decodes as data ({ ok: false, error }) through the existing Result handling, never as a thrown codec error.
  #   5. Secret-bearing fields (api_key, custom_api_key, oauth_token, oauth_refresh_token, ProfileDefinition.api_key, pkce_verifier) never appear in any error message or debug string the codec produces.
  #   6. Codec only: no provider, board or UI behaviour changes in this story.
  #   7. All 23 now, in one codec pass with one golden-vector run. FSPEC-044 and FSPEC-045 become pure plugin/UI work. This is a deliberate exception to FSPEC-002 rule [1] for this epic.
  #
  # EXAMPLES:
  #   1. set_provider_credentials("anthropic", { kind: "api_key", api_key: Some("sk-ant-test"), all other Options None }) encodes byte-identical to the Rust golden vector.
  #   2. list_provider_credentials returns two rows — one configured with masked_key Some("sk-ant-••••mnop") and source Some("file"), one unconfigured with both None — and both decode with every field correct.
  #   3. test_provider_connection decodes Ok({ success: false, error: Some("401 Unauthorized"), latency_ms: 812 }) and, separately, Err("unknown provider") as { ok: false } data.
  #   4. get_provider_credential decodes both None (unknown provider) and Some(info).
  #   5. refresh_models_cache("") encodes an empty provider id (all providers) and decodes Ok(Vec<ModelEntry>) with is_custom set on a custom model.
  #   6. list_provider_settings decodes a ProviderSettingsConfig with zero profiles and one with two profiles, including ProfileDefinition streaming: None vs Some(false).
  #   7. oauth_copilot_device_start encodes both None and Some("ghe.example.com") and decodes an OAuthDeviceStart with interval 5.
  #   8. A decode failure while reading a ProviderCredentialInput-bearing frame reports the offset and type but not the api_key bytes.
  #   9. set_default_model("anthropic/claude-sonnet-5-5") encodes byte-identical to the golden vector and decodes Ok(()).
  #   10. add_custom_model, update_custom_model (with original_model_id) and delete_custom_model encode a CustomModelDefinition with some Options Some and some None, byte-identical to the golden vectors.
  #   11. save_provider_settings, save_profile, rename_profile and delete_profile encode a ProfileDefinition (base_url, api_key, every optional field) byte-identical to the golden vectors.
  #   12. oauth_headless_start decodes Ok({ authorize_url, pkce_verifier }); oauth_headless_complete encodes (provider_id, code_with_state, pkce_verifier); oauth_device_start and oauth_device_poll(device_auth_id, interval: u64) round-trip; oauth_get_tokens decodes Ok(true); oauth_clear_tokens and oauth_browser_login decode Ok(()).
  #
  # QUESTIONS (ANSWERED):
  #   Q: Encode all 23 methods now, or only the 7 that FSPEC-042 calls (set_default_model, list/get/set/delete_provider_credentials, test_provider_connection, refresh_models_cache), leaving OAuth (094-101) to FSPEC-044 and profiles/custom models (31-38) to FSPEC-045? FSPEC-002 rule [1] says the codec covers only 'the FspecService method payloads the plugin actually calls'.
  #   A: All 23 now, in one codec pass with one golden-vector run. FSPEC-044 and FSPEC-045 become pure plugin/UI work. This is a deliberate exception to FSPEC-002 rule [1] for this epic.
  #
  # ========================================

  Background: User Story
    As a developer building fspec's provider settings into Paseo
    I want to call the daemon's provider-settings, credential, model-cache and OAuth methods through the existing wire codec
    So that later stories manage providers without writing any bincode themselves

  Scenario: Saving and removing an API key encode byte-identical to Rust
    Given the Rust golden vectors for set_provider_credentials("anthropic", { kind: "api_key", api_key: Some("sk-ant-test"), every other Option None }) and delete_provider_credentials("anthropic")
    When the codec encodes both requests
    Then the bytes equal the golden vectors, using variant indices 90 and 91

  Scenario: Provider credential rows decode configured and unconfigured
    Given the Rust golden vector for a list_provider_credentials response with a configured row and an unconfigured row
    When the codec decodes that response
    Then the configured row has masked_key "sk-ant-••••mnop" and source "file"
    And the unconfigured row has configured false with masked_key and source absent

  Scenario: A connection test decodes both a failed test and a daemon error
    Given the Rust golden vectors for test_provider_connection returning Ok({ success: false, error: Some("401 Unauthorized"), latency_ms: 812 }) and Err("unknown provider")
    When the codec decodes both responses
    Then the first yields { success: false, error: "401 Unauthorized", latencyMs: 812 }
    And the second yields { ok: false, error: "unknown provider" } without throwing

  Scenario: A single credential lookup decodes both absent and present
    Given the Rust golden vectors for get_provider_credential returning None and Some(info)
    When the codec decodes both responses
    Then the first yields no credential and the second yields the full credential row

  Scenario: Refreshing every provider's models uses an empty provider id
    Given the Rust golden vectors for refresh_models_cache("") and its Ok(Vec<ModelEntry>) response containing a custom model
    When the codec encodes the request and decodes the response
    Then the request bytes equal the golden vector with an empty provider id
    And the custom model decodes with isCustom true

  Scenario: Provider settings decode with zero and two profiles
    Given the Rust golden vector for a list_provider_settings response with one provider without profiles and one with two profiles
    When the codec decodes that response
    Then every ProfileDefinition field decodes, including streaming absent versus false

  Scenario: The Copilot device sign-in encodes with and without an enterprise host
    Given the Rust golden vectors for oauth_copilot_device_start(None), oauth_copilot_device_start(Some("ghe.example.com")) and an OAuthDeviceStart response with interval 5
    When the codec encodes both requests and decodes the response
    Then both requests equal their golden vectors
    And the response yields the user code, verification URL, device auth id and interval 5

  Scenario: A decode failure never echoes a secret
    Given a set_provider_credentials request frame whose api_key is "sk-ant-secret" and that is truncated inside the trailing Options
    When the codec decodes that frame
    Then the error names the offset and the type being read
    And the error text does not contain "sk-ant-secret"

  Scenario: Setting the default model encodes byte-identical to Rust
    Given the Rust golden vectors for set_default_model("anthropic/claude-sonnet-5-5") and its Ok(()) response
    When the codec encodes the request and decodes the response
    Then the request bytes equal the golden vector, using variant index 30
    And the response yields { ok: true }

  Scenario: Custom model writes encode byte-identical to Rust
    Given the Rust golden vectors for add_custom_model, update_custom_model and delete_custom_model with a CustomModelDefinition mixing present and absent Options
    When the codec encodes those requests
    Then each equals its golden vector, using variant indices 31, 32 and 33

  Scenario: Profile writes encode byte-identical to Rust
    Given the Rust golden vectors for save_provider_settings, save_profile, rename_profile and delete_profile with a ProfileDefinition setting every optional field
    When the codec encodes those requests
    Then each equals its golden vector, using variant indices 35, 36, 38 and 37

  Scenario: The OAuth sign-in methods round-trip against Rust
    Given the Rust golden vectors for every request and response of oauth_clear_tokens, oauth_get_tokens, oauth_browser_login, oauth_headless_start, oauth_headless_complete, oauth_device_start and oauth_device_poll
    When the codec encodes each request and decodes each response
    Then every request equals its golden vector, using variant indices 94 to 100
    And oauth_headless_start yields its authorize URL and PKCE verifier, and oauth_get_tokens yields true
