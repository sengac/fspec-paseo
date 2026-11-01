# FSPEC-072 root cause: configuration guessed for a section with no credential row

## Problem

`server/settings.ts:213-228` pushes a row for every `list_providers` section no
`list_provider_credentials` row matched, with `configured: !provider.isUnreachable`
(:218) and `credentialType: "custom"` (:219). Both are guesses: fspec reports no
credential state for such a section, and "custom" is fspec's credential type for
an `is_custom` provider (handle_impl_7.rs:82), not for a profile section.
`client/settings-model.ts:96,183-191` then shows it "✓ custom endpoint", sorts it
with configured providers and offers Test / Refresh.

## What such a section is in fspec

- `list_provider_credentials` (`rust/sessions/src/handle_impl/handle_impl_7.rs:72-104`)
  maps every `codelet_providers::custom::list_providers_info()` entry.
- `list_providers` (`rust/sessions/src/handle_impl/handle_impl_5.rs:33-150`) maps
  the same entries (cloud + custom, :48-102), and then adds only
  `build_local_profile_sections()` (`profile_sections.rs:139-153`, key
  `openai:<profile>`) and `build_inherited_profile_sections()`
  (`inherited_profile_sections.rs:3-31`). Both build through
  `build_profile_provider_info`, so every section without a credential row is a
  profile section (`profile_name` set).
- The fspec TUI provider view (`fspec-tui/src/app/dispatch_provider_settings.rs:44-62`)
  lists only `list_provider_credentials` rows; profile sections never get a
  configured flag of their own.

So such a row has no configuration state in fspec at all.

## Fix

`settingsProviderSchema.configured` and `credentialType` become nullable;
`null` means fspec lists no credential row. The section-only row sets both to
null (listing still comes from its own `is_unreachable`). The header reads
`(no credential row in fspec)`; only `configured === true` sorts first and can be
tested or refreshed.

Same kind of guess in `server/transcript.ts:135`: a failed tool row used
`tool.error ?? "tool failed"`, inventing an error text. `ToolState.status` drops
`"failed"`; a tool is failed exactly when it carries fspec's error text
(`error !== null`, set only from a ToolResult with isError), so no fallback exists.

Swept and kept (they echo fspec data, not guesses): `modelCount ?? row.modelCount`
(:204, the daemon's own count when there is no section), `?? []` / `?? null`
empty collections, `apiKey ?? ""` (the stored-key-absent value fspec writes),
and transcript `compaction ?? mint(...)` (a minted row id).

## Alternatives rejected

- A three-valued `configuration` enum replacing `configured`: same meaning as
  `boolean | null`, but changes every row and fixture; nullable matches how the
  schema already reports `maskedKey` / `source` that fspec does not send.
- Dropping section-only rows: the user would lose sight of profiles whose base
  provider has no credential row.
- Copying the credential state of the base provider: fspec does not link them.
