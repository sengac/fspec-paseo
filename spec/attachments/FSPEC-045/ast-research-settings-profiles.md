# Research: local-server profiles and custom models (FSPEC-045)

## Scope

Manage fspec's local / OpenAI-compatible server providers from the settings screen: the provider's
base settings, named profiles, and the custom models inside each profile. This is the least-used part
of the TUI's provider view, so it comes last.

## Data model

```rust
ProviderSettingsConfig { provider_id, settings: ProfileDefinition, profiles: Vec<ProviderProfileConfig> }
ProviderProfileConfig  { name, definition: ProfileDefinition }
ProfileDefinition      { base_url, api_key, context_window?, max_output_tokens?,
                         compaction_threshold_type?, compaction_threshold_value?, streaming?, … }
CustomModelDefinition  { id, display_name?, facade?, context_window?, max_output_tokens?,
                         compaction_threshold_type?, compaction_threshold_value?, reasoning?, has_vision? }
```

`list_providers` already reports a profile through `ProviderInfo.profile_name`, so each profile
appears as its own provider group in Paseo's model picker, keyed `provider` or `provider:profile`.
**Check the key format** in fspec's `list_providers`. `parseCatalogModelId` splits on the first `/`,
so a profile key containing `/` would break it.

## Daemon calls

| action | call |
|---|---|
| load | `list_provider_settings()` |
| edit base settings | `save_provider_settings(provider_id, definition)` |
| add / edit profile | `save_profile(provider_id, profile_name, definition)` |
| rename profile | `rename_profile(provider_id, old_name, new_name, definition)` |
| delete profile | `delete_profile(provider_id, profile_name)` |
| add / edit / delete custom model | `add_custom_model` / `update_custom_model(…, original_model_id, …)` / `delete_custom_model` |

The TUI equivalents are `rust/fspec-tui/src/app/dispatch_provider_settings_profiles.rs`
(`handle_save_profile`, `handle_delete_profile`), `dispatch_provider_settings_defaults.rs`
(`handle_save_provider_settings`) and `dispatch_model_selector.rs:102` (`add_custom_model`). Copy
their validation, for example required `base_url` and unique profile names.

## Things to watch

- `ProfileDefinition.api_key` comes back from `list_provider_settings` in **plaintext** (unlike
  `ProviderCredentialInfo.masked_key`). The server RPC must mask it before replying, and on save
  treat "unchanged" as "keep the existing key" rather than sending the masked value back.
- Deleting a profile that a running fspec session uses: find out what the daemon does, and warn or
  refuse in the UI.
- Every write is followed by `paseo.providers.refresh` (FSPEC-042), because profiles and custom
  models are picker entries.
- The forms have many optional numeric fields. Show the common ones (base URL, key, context window,
  streaming) and put the rest behind "Advanced".

## Suggested rules

- Profile API keys are masked in the UI and never round-trip in plaintext to the client.
- Saving a profile without changing its key keeps the stored key.
- A new custom model appears in Paseo's fspec model picker under its profile.
- Renaming a profile keeps its custom models.
