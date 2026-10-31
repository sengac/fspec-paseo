# Research: fspec settings screen (FSPEC-043)

## Scope

The user-visible MVP: a native Paseo settings screen over the FSPEC-042 RPCs. It covers API-key and
custom-endpoint providers, testing a connection, refreshing models and choosing the default model.
OAuth sign-in (FSPEC-044) and local-server profiles (FSPEC-045) add sections to this screen later.

## Where it lives

Not a workspace panel. Provider credentials aren't per-workspace, so use the settings contribution:

```ts
// @getpaseo/plugin/dist/client/contracts.d.ts
addSettingsScreen(contribution: { id: string; title: Text; icon: PluginIcon;
                                  Component: ComponentType<PluginSurfaceProps> }): PluginCleanup;   // :153
// command contexts:
openSettings(id: string): void;                                                                     // :241
```

Entry points, following the board's `client/register.ts`:

- Paseo **Settings**, where the screen is listed automatically
- Command Center item **fspec settings** (`context: "global"`, `onSelect({ openSettings })`)
- Slash command `/fspec-settings`
- Optional: a "Manage providers…" link in the board header when the board shows no models

Phones: check that plugin settings screens appear in the phone Settings screen. FSPEC-040 found
that phones hide plugin *panels*. Settings screens are a different surface, but verify it.

## Layout, modelled on the TUI's `/provider` view

The TUI view is `rust/fspec-tui/src/components/action_provider_settings.rs` (actions) and
`rust/fspec-tui/src/app/dispatch_provider_settings.rs` (behaviour). Reuse its vocabulary so the two
clients feel the same.

```
fspec · /Users/me/projects/app · daemon 0.10.9           [Refresh all models]

Configured
  Anthropic        API key  sk-ant-••••mnop  (file)   12 models  [Test] [Refresh] [Edit] [Remove]
  OpenRouter       API key  sk-or-••••1234   (env)    240 models [Test] [Refresh]
Not configured
  OpenAI                                                        [Add key]
  Local server     custom endpoint                              [Configure]

Default model  [ anthropic/claude-sonnet-5-5 ▾ ]
```

- Rows from `source: "env"` or `"dotenv"` are read-only, because fspec can't overwrite an
  environment variable. Say where the key comes from instead of offering Edit or Remove. **Check
  how the TUI handles this.**
- Test shows ✓ and the latency, or the daemon's error, inline on the row.
- Refresh shows the new model count. Refresh all calls `refresh_models_cache("")`.
- After every successful write: reload the list, then call
  `paseo.providers.refresh({ providers: ["fspec"] })`.

Use the Paseo UI kit (`@getpaseo/plugin/dist/client/ui.d.ts`: `SettingsSection`, `SettingsRow`,
`SettingsSwitch`, …) so the screen matches Paseo's own settings pages, rather than reusing the
board's custom styles.

## Key entry

- Use a secure text input (`secureTextEntry`). Don't keep the key in component state after it's sent,
  and clear the field once the save succeeds.
- `ProviderCredentialInput` is a flat struct: API key → `{ kind: "api_key", api_key }`. A custom
  endpoint → `{ kind: "custom", custom_endpoint, custom_api_key }`.
- Show a short note that the key is sent to the fspec daemon on the computer running Paseo. This
  matters when the app is a phone on the relay.

## Testing

Copy the board's tests (`test/board-panel.test.ts`, `test/board-actions.test.ts`): pure view-model
functions in `client/settings-model.ts` with unit tests, and the React Native component kept thin.
Check the screen manually at phone width.

## Suggested rules

- The screen names the daemon (workspace, version) it's configuring.
- An unreachable daemon shows the provider's diagnostic and a Retry button, not an empty list.
- Env- and dotenv-sourced credentials can't be edited or removed from Paseo.
- A failed write leaves the list unchanged and shows the daemon's error on that row.
- Every successful write is reflected in Paseo's fspec model picker.
