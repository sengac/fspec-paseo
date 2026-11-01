# FSPEC-056 root cause: ProviderInfo is one field short and custom-model writes guess the provider

## Problem

- fspec BUG-325 (commit fc06d080) appended `provider_id: String` as the last
  field of `ProviderInfo` (`/Users/rquast/projects/fspec/rust/rpc-types/src/dialogs.rs:226-231`):
  "the base provider id this section belongs to (`openai` for the
  `openai:my-profile` section; equal to `key` for cloud and custom providers).
  Clients pass it as the `provider_id` of the custom-model and profile write
  RPCs — never the section `key`."
- The plugin's codec stops after `is_unreachable`
  (`server/wire.ts:309-315` interface, `server/wire.ts:1434-1447`
  `writeProviderInfo`/`readProviderInfo`). bincode has no framing, so the
  second `ProviderInfo` of a `list_providers` reply starts reading inside the
  first one's `provider_id`: the provider catalog, the model picker and the
  settings screen all misdecode against a HEAD daemon.
- The settings tree derives a profile section's base provider by splitting the
  section key at `:` (`client/settings-model.ts:149` `row.id.indexOf(":")`) and
  the custom-model sheet sends the tree row's id as the provider
  (`client/settings-screen.tsx:241`, `:250`): a guess about fspec's key format
  instead of the field fspec now sends.
- fspec now refuses every custom-model write it cannot apply (missing profile,
  unknown model id, non-openai provider: `rust/sessions/src/profile_sections/custom_models.rs`);
  the plugin's `saveCustomModel`/`deleteCustomModel` already return the
  daemon's `Err` as `{ ok: false, error }` (`server/settings.ts` `written`), the
  sheet shows a refused save (FSPEC-047 scenario), but a refused delete has no
  scenario or test.

## Design

- `ProviderInfo` gains `providerId: string`, read and written last, exactly as
  fspec HEAD encodes it (golden vectors `provider_info_profile`,
  `provider_info_cloud`).
- `SettingsProvider` (shared/settings.ts) gains `providerId` (the base
  provider) and `profileName` (null for a provider row). A
  `list_providers`-only row takes both from `ProviderInfo`; a
  `list_provider_credentials` row is a base provider by definition
  (`providerId = row.providerId`, `profileName = null`).
- `buildTree` folds a row under the provider its `providerId` names using its
  `profileName` — no key parsing. A profile row with no parent row stays a
  provider of its own, as before.
- Custom-model tree rows and the custom-model sheet carry the profile
  section's `providerId`; save and delete send it. A profile that only the
  settings list names (no section in `list_providers`) uses its parent row's
  `providerId`, which is the base provider by construction.
- A refused delete is shown in the sheet like a refused save; nothing reloads.

## Alternatives rejected

- Keep parsing `openai:<profile>`: the guess BUG-325 removed from fspec's own
  TUI; fspec now names the base provider explicitly.
- Keep the hard-coded `"openai"` as the write provider: correct today only by
  coincidence, and silent when fspec adds custom models to another provider.

## Wire changes

- `ProviderInfo { key, display_name, models, profile_name, is_unreachable, provider_id }`
  (new last field). `list_providers` (idx 28) index unchanged.
