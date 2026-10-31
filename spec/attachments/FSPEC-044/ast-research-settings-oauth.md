# Research: OAuth sign-in from Paseo (FSPEC-044)

## Scope

Sign in to and disconnect OAuth providers (Anthropic, Codex/OpenAI, GitHub Copilot) from the
FSPEC-043 settings screen.

## The main constraint: which machine is the browser on?

`oauth_browser_login(provider_id)` (idx 96) opens a browser **on the fspec daemon's machine** and
waits for the redirect. That only works when the person is sitting at that machine. A Paseo client is
often somewhere else: a phone on the relay, or the web app on another computer. So:

| flow | daemon calls | works remotely | use for |
|---|---|---|---|
| Headless PKCE | `oauth_headless_start` → user opens `authorize_url`, signs in, pastes the code → `oauth_headless_complete(code_with_state, pkce_verifier)` | ✅ | Anthropic |
| Device code | `oauth_device_start` → show `user_code` + `verification_url` → `oauth_device_poll(device_auth_id, interval)` | ✅ | Codex |
| Copilot device | `oauth_copilot_device_start(enterprise_host?)` → the same display → poll | ✅ | GitHub Copilot / GHE |
| Browser on daemon | `oauth_browser_login` | ❌ (local only) | desktop app on the same machine |

Default to the remote-safe flow. Offer "Sign in with browser on this computer" only when the client
is known to be local. **Open question:** does the Paseo plugin client expose whether it's connected to a
local daemon? If not, always use the remote-safe flows.

Which flows each provider supports: copy the TUI's `OAuthMethod` choice in
`rust/fspec-tui/src/app/dispatch_provider_settings_oauth.rs:93` (`handle_oauth_login_start`) and
`dispatch_provider_settings_copilot.rs`.

## Long-running poll vs Paseo's 30 s RPC timeout

`oauth_device_poll` blocks on the daemon until the user approves or the code expires, which can take
minutes. Paseo times plugin RPCs out after 30 s (`REQUEST_TIMEOUT_MS`, the reason the board holds
watches for 20 s, see `server/board.ts` `BOARD_HOLD_MS`). So:

- The server starts the poll as a background task keyed by a login id and returns at once.
- The client long-polls `fspec.settings.loginStatus(loginId)` with a hold under 30 s, like the board's
  `watch`, until it gets `pending | succeeded | failed(error) | expired`.
- Cancel, closing the screen, or the plugin unloading drops the task. The TUI uses a generation
  counter (`oauth_generation()`) to discard stale results. Do the same.

`pkce_verifier` stays on the server, kept with the login id. The client never needs to see it.

## Disconnect and state

- `oauth_get_tokens(provider_id) -> bool` gives the "Signed in" or "Not signed in" row state.
- `oauth_clear_tokens(provider_id)` is Disconnect. Confirm before clearing.
- After a sign-in succeeds or a disconnect: reload the list and run `paseo.providers.refresh` (FSPEC-042).

## UI

- Device code: show a big copyable `user_code`, the `verification_url` as a link (open it with
  `Linking.openURL` on the client device), and a spinner until the status settles.
- Headless: an "Open sign-in page" link, then a paste field for the code, then Submit.
- Copilot: an optional "GitHub Enterprise host" field before Start.

## Suggested rules

- A phone can sign in to every OAuth provider without touching the daemon's machine.
- A sign-in in progress survives the 30 s RPC limit and finishes with exactly one outcome.
- Cancelling or leaving the screen abandons the sign-in, and a late result is ignored.
- The PKCE verifier and the tokens never reach the Paseo client.
- Disconnect clears the tokens and the provider's models leave the picker.
