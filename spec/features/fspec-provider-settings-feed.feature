@done
@provider
@core
@FSPEC-042
@FSPEC-065
Feature: Serve fspec provider settings to Paseo plugin UI
  """
  RPCs (shared/settings.ts, defineRpc + zod, like shared/board.ts): fspec.settings.list, fspec.settings.save-credentials {providerId, kind: api_key|custom, apiKey?, customEndpoint?, customApiKey?}, fspec.settings.remove-credentials, fspec.settings.test, fspec.settings.refresh-models {providerId | ''}. server/settings.ts createSettingsFeed() owns one FspecDaemonClient (lazy, reconnects after connection-lost), registered in index.server.ts. getCatalogCacheKey on the registration in server/provider.ts: a hash of list_provider_credentials (providerId, configured, credentialType, modelCount) + daemon target; FSPEC-065: a lookup that fails rejects with its reason, which Paseo shows as the provider's error. The client-side paseo.providers.refresh call after writes belongs to FSPEC-043 (the screen).
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. The settings feed is a plugin-RPC server module (shared/settings.ts schemas + server/settings.ts) built like the board feed: one lazily opened daemon client of its own, registered with server.handle in index.server.ts and closed in the plugin cleanup.
  #   2. No RPC ever returns a raw key: only masked_key from list_provider_credentials crosses back to the client, and no secret appears in any plugin error, log line or RPC output.
  #   3. Writes (save key, save custom endpoint, remove, test, refresh models) answer { ok: true, ... } or { ok: false, error } from the daemon's own error text; they never throw into the UI.
  #   4. When the daemon is unreachable every settings RPC answers { state: 'unavailable', reason } with the same diagnostic the provider status reports.
  #   5. After any successful write the fspec model catalog Paseo shows reflects the change without restarting Paseo or the plugin.
  #   6. Allow Remove and override on env/dotenv-sourced rows, with a warning that the key returns when the daemon restarts unless it is removed from the shell environment or .env.
  #   7. Both: the settings screen refreshes Paseo after its own writes (paseo.providers.refresh), and the fspec provider registers getCatalogCacheKey derived from the daemon's credential state so edits made in the fspec TUI are picked up too.
  #   8. No default-model control in this story (see the follow-up card that depends on an fspec get_default_model RPC).
  #   9. settings.list answers the daemon's workspace (get_workspace_info cwd) and one row per provider fspec knows — configured or not, configured first — merged from list_provider_credentials and list_providers: id, display name, configured, credential type, masked key, source, model count, unreachable flag and models.
  #
  # EXAMPLES:
  #   1. With anthropic configured from file and openai unconfigured, settings.list answers both rows, anthropic first, with anthropic's masked key 'sk-ant-••••mnop' and source 'file' and its 12 models.
  #   2. Saving an OpenAI key 'sk-proj-abc' answers { ok: true }; the next settings.list shows openai configured with only its masked key, and the response JSON never contains 'sk-proj-abc'.
  #   3. Saving a custom endpoint for lmstudio sends kind 'custom' with custom_endpoint and custom_api_key, leaving the other fields absent.
  #   4. Testing anthropic with a bad key answers { ok: true, success: false, error: '401 Unauthorized', latencyMs: 812 }; testing an unknown provider answers { ok: false, error: 'unknown provider' }.
  #   5. Refreshing anthropic's models answers the new model list; 'Refresh all' sends refresh_models_cache('').
  #   6. With no daemon.json, settings.list answers { state: 'unavailable', reason: 'no daemon.json found at … — start fspec daemon first' }.
  #   7. After saving an OpenAI key, a new agent's model picker in Paseo lists OpenAI's models.
  #   8. Removing an env-sourced openai key answers { ok: true, warning: 'returns when the fspec daemon restarts unless removed from the environment' }.
  #   9. A key added in the fspec TUI changes the fspec catalog cache key, so Paseo's next catalog lookup re-fetches and shows the new provider's models.
  #
  # QUESTIONS (ANSWERED):
  #   Q: Default model: fspec's set_default_model persists a default, but no RPC reads it back, and the plugin always applies the catalog's first model when it opens a session, overriding fspec's default. Drop default-model from this card, or make fspec's default actually drive Paseo (needs a get_default_model RPC added to fspec, or the plugin reading fspec's default-model file)?
  #   A: Add a get_default_model RPC to fspec so Paseo follows fspec's default. That is fspec-repo work, so it is split out: FSPEC-042 ships without a default-model control, and a new card (Follow fspec's default model in Paseo) depends on the fspec RPC and makes set_default_model + the catalog default work end to end.
  #
  #   Q: Env-sourced keys: delete_provider_credentials clears the key from the daemon's own environment, but it returns when the daemon restarts because it comes from the shell. Allow Remove on env/dotenv rows with that warning, or make those rows read-only in Paseo?
  #   A: Allow Remove and override on env/dotenv-sourced rows, with a warning that the key returns when the daemon restarts unless it is removed from the shell environment or .env.
  #
  #   Q: Keeping Paseo's model picker in step: refresh it from the settings screen after its own writes (paseo.providers.refresh), or also make the provider's catalog cache key change whenever fspec's credentials change, so edits made in the fspec TUI show up too (one extra daemon call per catalog lookup)?
  #   A: Both: the settings screen refreshes Paseo after its own writes (paseo.providers.refresh), and the fspec provider registers getCatalogCacheKey derived from the daemon's credential state so edits made in the fspec TUI are picked up too.
  #
  # ========================================
  Background: User Story
    As a Paseo user running fspec agents
    I want to list fspec's providers, add or remove keys, test connections and refresh models through the plugin
    So that I can manage fspec's models without opening the fspec TUI, and Paseo's model picker stays in step

  Scenario: The provider list merges credentials and models, configured first
    Given the fspec daemon serves /work/app with anthropic configured from file (masked key "sk-ant-••••mnop", 12 models) and openai unconfigured
    When the client calls fspec.settings.list
    Then it answers state "ready" with workspace "/work/app"
    And the rows are anthropic then openai
    And anthropic has masked key "sk-ant-••••mnop", source "file" and its 12 models

  Scenario: Saving an API key never echoes the key
    Given the fspec daemon accepts set_provider_credentials for openai
    When the client saves the OpenAI key "sk-proj-abc" with fspec.settings.save-credentials
    Then the daemon receives kind "api_key" with api_key "sk-proj-abc" and every other field absent
    And the client gets { ok: true }
    And neither the response nor any plugin log line contains "sk-proj-abc"

  Scenario: Saving a custom endpoint sends only the custom fields
    Given the fspec daemon accepts set_provider_credentials for lmstudio
    When the client saves endpoint "http://127.0.0.1:1234/v1" with key "lm-key" for lmstudio
    Then the daemon receives kind "custom" with custom_endpoint and custom_api_key set and every other field absent

  Scenario: Removing an environment key warns that it returns on restart
    Given openai is configured from source "env"
    When the client removes openai's credentials with fspec.settings.remove-credentials
    Then the daemon receives delete_provider_credentials("openai")
    And the client gets { ok: true } with a warning that the key returns when the fspec daemon restarts unless removed from the environment

  Scenario: A connection test reports failure and refusal as data
    Given the daemon answers test_provider_connection for anthropic with success false, error "401 Unauthorized", 812 ms
    And the daemon answers test_provider_connection for "nope" with Err("unknown provider")
    When the client tests anthropic and then "nope" with fspec.settings.test
    Then the first answer is { ok: true, success: false, error: "401 Unauthorized", latencyMs: 812 }
    And the second answer is { ok: false, error: "unknown provider" }

  Scenario: Refreshing models for one provider or all of them
    Given the daemon answers refresh_models_cache with two models
    When the client refreshes anthropic and then refreshes all providers with fspec.settings.refresh-models
    Then the daemon receives refresh_models_cache("anthropic") and then refresh_models_cache("")
    And each answer carries the two models

  Scenario: Every settings RPC reports an unreachable daemon
    Given no fspec daemon is running
    When the client calls each fspec.settings RPC
    Then each answers state "unavailable" with the reason "no fspec daemon is running — no live entry in …; start fspec daemon first"

  Scenario: Credential changes made anywhere change the catalog cache key
    Given Paseo has the fspec catalog cache key for the current credentials
    When a key is added for openai, from Paseo or from the fspec TUI
    Then the fspec provider's next catalog cache key differs, so Paseo re-fetches the catalog and lists OpenAI's models

  Scenario: The catalog cache key lookup fails with the daemon's reason
    Given no fspec daemon is running
    When Paseo asks the fspec provider for its catalog cache key
    Then the lookup rejects with "no fspec daemon is running — no live entry in …; start fspec daemon first", which Paseo shows as the provider's error

  Scenario: A refused credential listing fails the catalog cache key
    Given list_provider_credentials answers the error "credential store locked"
    When Paseo asks the fspec provider for its catalog cache key
    Then the lookup rejects with "fspec daemon list_provider_credentials failed: credential store locked"
