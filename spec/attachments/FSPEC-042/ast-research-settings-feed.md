# Research: provider settings feed (FSPEC-042)

## Scope

Server-side plugin RPCs for the core provider operations, plus keeping Paseo's model picker in
sync with fspec. OAuth (FSPEC-044) and profiles/custom models (FSPEC-045) are out of scope.

## Pattern to copy: the board feed

`server/board.ts` + `shared/board.ts` + `index.server.ts`:

- `shared/board.ts` defines each RPC with `defineRpc({ ... })` and zod input/output schemas
  (`watchBoardRpc`, `boardDetailsRpc`, `moveBoardRpc`, `boardAvailableRpc`).
- `server/board.ts` `createBoardFeed()` owns **one** `FspecDaemonClient`, which it opens lazily and
  closes in `close()`.
- `index.server.ts` wires each one with `server.handle(rpc, (input) => feed.method(input))` and
  closes the feed in the returned cleanup.

New files: `shared/settings.ts` and `server/settings.ts` (`createSettingsFeed()`), registered the
same way. One more daemon socket per plugin is fine, since the board already does this.

## RPCs

| plugin RPC | daemon calls | output |
|---|---|---|
| `fspec.settings.list` | `get_workspace_info`, `list_provider_credentials`, `list_providers` | daemon `{ workspace, version }` + one row per provider: id, displayName, configured, credentialType, maskedKey, source, modelCount, unreachable, models[], isDefault |
| `fspec.settings.saveCredentials` | `set_provider_credentials` | `{ ok } \| { error }` |
| `fspec.settings.removeCredentials` | `delete_provider_credentials` | `{ ok } \| { error }` |
| `fspec.settings.test` | `test_provider_connection` | `{ success, latencyMs, error? }` |
| `fspec.settings.refreshModels` | `refresh_models_cache(providerId \| "")` | `{ models } \| { error }` |
| `fspec.settings.setDefaultModel` | `set_default_model("provider/model")` | `{ ok } \| { error }` |

Unreachable daemon: answer `{ state: "unavailable", reason }`, the same as the board does. Never throw
a bare error into the UI.

### Default model

The wire has no `get_default_model` (see the `server/catalog.ts` header). Today the catalog default
is "first model of the first reachable provider". After `set_default_model`, check whether
`list_providers` reorders so the chosen model comes first. If it doesn't, the plugin can't show which
model is the default, and `buildCatalog` keeps picking the first. **Investigate in the fspec source
(`session_manager` `set_default_model`) before committing to a "default" control.** The fallback is
to drop the control from the MVP.

### Secrets

- The `saveCredentials` input contains the raw key. Don't log the RPC input. Check what Paseo's plugin
  runtime logs for RPC inputs and failures (`paseo plugin logs`).
- Never return the key. Only return `maskedKey` from `list_provider_credentials`.
- Turn daemon errors into user-facing text without the input.

## Refreshing Paseo's catalog

`ProviderEvent` has no "catalog changed" event (`@getpaseo/plugin/dist/server/provider.d.ts`).
Paseo caches provider catalogs (`packages/server/src/server/plugins/index.ts:696`,
`getCatalogCacheKey`). Options:

1. **Client-driven (preferred):** after any successful write, the settings screen calls
   `paseo.providers.refresh({ providers: ["fspec"] })` (`@getpaseo/client` `providers.refresh`,
   `index.d.ts:376`). `client/board-panel.tsx:184` already uses `paseo.providers.listModels("fspec")`,
   so the `paseo` handle is available in plugin UI.
2. **Cache key:** add `getCatalogCacheKey` to the registration in `server/provider.ts`, returning a
   hash of `list_provider_credentials` + the daemon pid. It's more robust (it also catches changes made
   in the fspec TUI) but costs a daemon round trip per catalog lookup.

The acceptance test should be: add a key in the settings screen, then open the new-agent form, and
the provider's models are in the picker without restarting anything.

## Suggested rules

- The list shows every provider fspec knows, configured or not, with configured ones first.
- A key is shown only in masked form, and the API never returns it.
- After save, remove, refresh or set-default succeeds, Paseo's fspec model list reflects it.
- Remove asks for confirmation and names the provider.
- With no daemon, the RPCs answer "unavailable" with the same diagnostic the provider reports.
