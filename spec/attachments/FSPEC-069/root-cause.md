# FSPEC-069 root cause: reachability guessed for a credential row with no provider section

## Problem

`server/settings.ts:189-200` merges `list_provider_credentials` rows with
`list_providers` sections by key. When no section matches, it writes
`unreachable: provider?.isUnreachable ?? !row.configured` — a guess: a
configured row becomes "reachable" with no models, an unconfigured one
"unreachable", neither of which fspec said. `client/settings-model.ts:251`
then decides Default model choices from that guess.

## What such a row means in fspec

- `list_provider_credentials` (fspec `rust/sessions/src/handle_impl/handle_impl_7.rs:72-104`)
  maps every `codelet_providers::custom::list_providers_info()` entry.
- `list_providers` (`rust/sessions/src/handle_impl/handle_impl_5.rs:5-150`) maps the
  same entries, but every cloud/custom section is built with
  `is_unreachable: false` (`rust/sessions/src/profile_sections.rs:37-46`,
  RPC-338), `openai` is folded into the synthetic Codex section (PROV-129) and
  sections with no models are dropped (`profile_sections.rs:58-63`
  `retain_populated_cloud_sections`, PROV-127).

So a credential row without a section is one fspec offers no models for —
it is neither reachable nor unreachable; fspec simply does not list it.

## Fix

Replace `unreachable: boolean` with `listing: "reachable" | "unreachable" |
"unlisted"` (shared/settings.ts). A credential row takes its section's
`is_unreachable`, or `"unlisted"` when there is none; a section-only row takes
its own `is_unreachable`. The header appends ` · not listed by fspec` for an
unlisted row, and `defaultModelChoice` offers only `reachable` rows' models.

## Alternatives rejected

- `unreachable: boolean | null`: two fields' worth of meaning in a nullable
  flag; readers would have to treat null specially anyway.
- Dropping unlisted rows: the user still needs them to add a key.
