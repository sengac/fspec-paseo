# fspec provider settings in Paseo — overview

Epic `provider-settings`, cards FSPEC-041 … FSPEC-045.

## Goal

Paseo users can already *use* fspec's models (the `fspec` provider's model picker is built
from `list_providers`). They cannot *manage* them: adding an API key, signing in to an OAuth
provider, testing a connection, refreshing a provider's model list or choosing the default
model all still require the fspec TUI's `/provider` view. This epic brings that view into
Paseo, built the same way as the fspec board (epic `kanban-board`): a native Paseo UI
contribution backed by plugin RPCs that call the daemon. Nothing is reimplemented.

## The daemon already has everything

The fspec TUI's provider settings view (`rust/fspec-tui/src/components/action_provider_settings.rs`,
`rust/fspec-tui/src/app/dispatch_provider_settings*.rs`) drives these `FspecService` methods,
and the TUI's WebSocket transport (`rust/fspec-tui/src/transport/websocket/isolation_credentials_worktrees.rs`)
proves they work over the same daemon socket this plugin uses:

| idx | method | signature | card |
|---|---|---|---|
| 28 | `list_providers` | `() -> Vec<ProviderInfo>` | already encoded |
| 30 | `set_default_model` | `(model: String) -> Result<(), String>` | 041/042 |
| 31 | `add_custom_model` | `(provider_id, profile_name, definition: CustomModelDefinition) -> Result<(), String>` | 041/045 |
| 32 | `update_custom_model` | `(provider_id, profile_name, original_model_id, definition) -> Result<(), String>` | 041/045 |
| 33 | `delete_custom_model` | `(provider_id, profile_name, model_id) -> Result<(), String>` | 041/045 |
| 34 | `list_provider_settings` | `() -> Result<Vec<ProviderSettingsConfig>, String>` | 041/045 |
| 35 | `save_provider_settings` | `(provider_id, definition: ProfileDefinition) -> Result<(), String>` | 041/045 |
| 36 | `save_profile` | `(provider_id, profile_name, definition) -> Result<(), String>` | 041/045 |
| 37 | `delete_profile` | `(provider_id, profile_name) -> Result<(), String>` | 041/045 |
| 38 | `rename_profile` | `(provider_id, old_name, new_name, definition) -> Result<(), String>` | 041/045 |
| 88 | `list_provider_credentials` | `() -> Vec<ProviderCredentialInfo>` | 041/042 |
| 89 | `get_provider_credential` | `(provider_id) -> Option<ProviderCredentialInfo>` | 041/042 |
| 90 | `set_provider_credentials` | `(provider_id, creds: ProviderCredentialInput) -> Result<(), String>` | 041/042 |
| 91 | `delete_provider_credentials` | `(provider_id) -> Result<(), String>` | 041/042 |
| 92 | `test_provider_connection` | `(provider_id) -> Result<TestConnectionResult, String>` | 041/042 |
| 93 | `refresh_models_cache` | `(provider_id) -> Result<Vec<ModelEntry>, String>` (`""` = all, as the TUI's model selector does) | 041/042 |
| 94 | `oauth_clear_tokens` | `(provider_id) -> Result<(), String>` | 041/044 |
| 95 | `oauth_get_tokens` | `(provider_id) -> Result<bool, String>` (has tokens?) | 041/044 |
| 96 | `oauth_browser_login` | `(provider_id) -> Result<(), String>` — opens a browser **on the daemon's machine** | 041/044 |
| 97 | `oauth_headless_start` | `(provider_id) -> Result<OAuthHeadlessStart, String>` | 041/044 |
| 98 | `oauth_headless_complete` | `(provider_id, code_with_state, pkce_verifier) -> Result<(), String>` | 041/044 |
| 99 | `oauth_device_start` | `(provider_id) -> Result<OAuthDeviceStart, String>` | 041/044 |
| 100 | `oauth_device_poll` | `(provider_id, device_auth_id, interval: u64) -> Result<(), String>` — long-running | 041/044 |
| 101 | `oauth_copilot_device_start` | `(enterprise_host: Option<String>) -> Result<OAuthDeviceStart, String>` | 041/044 |

Declarations: `rust/rpc/src/service_declaration/providers_sessions.rs` (30–38) and
`rust/rpc/src/service_declaration/supervision_credentials.rs` (88–101). Types:
`rust/rpc-types/src/lib.rs` and `rust/rpc-types/src/provider_settings.rs`.
**None of these 23 methods is in `server/wire.ts` today.**

## Architecture (mirrors the board)

```
Paseo Settings ─┐
Command Center ─┼─► client/settings-screen.tsx  (addSettingsScreen, React Native)
/fspec-settings ┘            │ client.rpc(...)
                             ▼
               shared/settings.ts   (defineRpc schemas, zod)
                             │
               server/settings.ts   (one FspecDaemonClient, like server/board.ts)
                             │ request({ method: ... })
                             ▼
               server/wire.ts       (new methods + payload codecs, FSPEC-041)
                             │
                       fspec daemon
                             │ after any write
                             ▼
               client: paseo.providers.refresh({ providers: ["fspec"] })
```

### Card order

1. **FSPEC-041** codec: every method above plus payload types, with golden vectors.
2. **FSPEC-042** server feed + catalog refresh (API keys, test, refresh models, default model).
3. **FSPEC-043** the settings screen (the user-visible MVP).
4. **FSPEC-044** OAuth sign-in (remote-safe flows first).
5. **FSPEC-045** local-server profiles and custom models.

041 → 042 → 043 is the critical path. 044 and 045 both depend on 043 and are independent of each other.

## Cross-cutting decisions (to settle during Example Mapping)

- **Settings screen, not a workspace panel.** Provider credentials are not per-workspace. Paseo has
  `client.addSettingsScreen({ id, title, icon, Component })` and `openSettings(id)` in command
  contexts (`@getpaseo/plugin/dist/client/contracts.d.ts:153,241`). The board needed a workspace
  panel; this doesn't.
- **Which daemon?** The settings screen is global, but a daemon serves one workspace. Use the same
  discovery as the provider (`FSPEC_DAEMON_URL` or `daemon.json`), and show the daemon's workspace
  and version at the top of the screen so it's obvious what is being configured.
  Open question: are fspec's credentials global (`~/.fspec`) or can they come from the workspace's
  `.env` (`source: "dotenv"`)? If the latter, say so per row.
- **Secrets in transit.** An API key typed in the Paseo app travels app → Paseo daemon (possibly over
  the relay or a Tailscale listen address) → plugin → fspec daemon (loopback). The plugin must never
  log it, never echo it back, and only ever display `masked_key`. Confirm the Paseo relay is
  end-to-end encrypted before advertising key entry from phones.
- **Refreshing the model picker.** There is no provider event for "catalog changed"
  (`ProviderEvent` has no such variant). Two options:
  (a) the client calls `paseo.providers.refresh({ providers: ["fspec"] })` (`@getpaseo/client`
  `PaseoProviderRefreshOptions`) after each successful write. This is simple and probably enough.
  (b) register `getCatalogCacheKey` on the provider so the key changes when fspec's providers change.
  Start with (a). Use (b) only if Paseo's cache outlives a refresh.
- **No push for settings.** The daemon pushes no envelope when credentials change (the `Envelope`
  variants are Rpc, Event, LogEvent, WorkUnitsUpdate, StatusUpdate, CmdReq, CmdRes, SessionEvent,
  SessionSnapshot). The screen reloads after its own writes and on focus. That's acceptable because
  settings change rarely, so there's no long-poll like the board's.
