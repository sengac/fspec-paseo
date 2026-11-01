@done
@provider
@core
@FSPEC-043
@FSPEC-047
@FSPEC-065
Feature: Manage fspec providers from a Paseo settings screen
  """
  Client layout mirrors the board: client/settings-model.ts (pure: grouping, row descriptions, which actions a row offers, form validation, result text), client/settings-actions.ts (pure orchestration of a write: call the RPC, then on success reload the list and call paseo.providers.refresh({ providers: ['fspec'] }); on failure return the error and do nothing else), client/settings-screen.tsx (thin React Native component using @getpaseo/plugin/client/ui SettingsSection/SettingsCard/SettingsRow/SettingsInput(secureTextEntry)/SettingsAction, Modal for confirm, useToast, useRpc, usePaseo), registerSettings in client/register.ts wired from index.client.tsx. Paseo owns header, Back, scrolling and the phone full-screen push (public-docs/plugins/reference.md 'Settings screens'). Manual check: open on a phone-width window.
  Tree model (client/settings-model.ts): buildTree(providers) folds '<provider>:<profile>' rows into their parent, orders configured first, and yields per-provider header segments and child rows (kind: oauthStatus | oauthLogin | apiKey | settings | profile | addProfile) in the TUI order (rust/fspec-tui/src/views/provider_settings/nav_item.rs build_nav_items, projection.rs oauth_login_methods/oauth_label, row_render.rs icons and tints). Each child row opens a Paseo Modal sheet; the screen keeps one 'open sheet' state.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. The screen is a Paseo settings screen (client.addSettingsScreen, id 'fspec-providers', title 'fspec providers') listed under Settings → Plugins; a global Command Center item 'fspec providers' and the slash command /fspec-providers open it with openSettings.
  #   2. The screen names the daemon workspace it configures; when the daemon is unavailable it shows the feed's reason and a Retry action instead of an empty list.
  #   3. Keys are typed into secure inputs, never shown back, and cleared after a successful save; the form notes that the key is stored by the fspec daemon on the computer running it.
  #   4. Remove asks for confirmation naming the provider; removing an environment-sourced key shows the feed's warning that it returns when the daemon restarts.
  #   5. Test shows the result on the row (connected with latency, or the daemon's error); Refresh shows the new model count; 'Refresh all models' refreshes every provider.
  #   6. After every successful save, remove or refresh the screen reloads the list and asks Paseo to refresh the fspec provider (paseo.providers.refresh) so the model picker updates.
  #   7. A failed action leaves the list unchanged and shows the daemon's error on that row.
  #   8. Providers are one tree in a single card, as in the fspec TUI: configured providers first, then the rest in the daemon's order; each provider header shows ▶/▼, its name and status segments — green '✓ <masked key>' with a dim '[<source>]' for keys, '✓ OAuth [Claude|ChatGPT|GitHub Copilot]' for OAuth sign-ins, gray '(not configured)' otherwise — plus '(N profiles)' when it has profiles and the last test result.
  #   9. An expanded provider shows a Test and Refresh models action line, then its child rows in the TUI's order: OAuth status and sign-in rows (OAuth providers), '🔑 API key' (API-key providers except openai), '⚙ Settings', one '📁 <profile> → <base URL>' row per profile ('(inherits auth)' when the profile has no base URL), and '+ Add profile'. FSPEC-047: each openai profile row is followed by its custom models ('◆ <name>') and '+ Add model to <profile>'.
  #   10. Profiles reported by the daemon as their own providers ('<provider>:<profile>', e.g. 'openai:Strata') are folded under their parent provider as profile rows, never listed as separate providers.
  #   11. Tapping a child row opens its sheet (Paseo Modal, a bottom sheet on phones); this story delivers the API key sheet (masked current key, secure new-key field, Save, Test, Remove). The Settings and profile sheets come with FSPEC-045, OAuth sign-in with FSPEC-044; until then those rows open a sheet that says so.
  #   12. settings.list also returns each provider's profiles (name and base URL only, from list_provider_settings) so the tree can show them; no profile API key ever reaches the client.
  #   13. The API key row appears, as in the TUI, for API-key providers except openai (whose keys live in its profiles or the environment); OAuth providers sign in through their OAuth rows, and endpoints are set on profiles (FSPEC-045).
  #
  # EXAMPLES:
  #   1. Adding a Gemini key 'AIza-test': the key field is secure, Save calls save-credentials with kind api_key, then the list reloads, Paseo's fspec models refresh, and the field is empty again.
  #   2. Testing anthropic shows 'Connected · 812 ms' or 'Failed: 401 Unauthorized' on the row.
  #   3. With no daemon running, the screen shows 'no daemon.json found at … — start fspec daemon first' and a Retry action; Retry re-runs the list.
  #   4. On a phone, Settings → Plugins → fspec for Paseo → fspec providers opens the screen full-screen with Back navigation.
  #   5. Credentials anthropic (OAuth), openai (key sk-••••abcd from env), openai:Strata and openai:spark (custom) and gemini (unconfigured) become three providers: Anthropic '✓ OAuth [Claude]', OpenAI '✓ sk-••••abcd [env] (2 profiles)' and Gemini '(not configured)'.
  #   6. Expanded OpenAI shows: Test · Refresh models, ⚙ Settings, 📁 Strata → http://10.0.0.5:8080/v1, 📁 spark → http://spark:8000/v1, + Add profile — and no API key row.
  #   7. Expanded Anthropic shows: Test · Refresh models, ✓ Logged in [Claude], 🔑 Sign in with browser, 🔑 Sign in with code, ⚙ Settings, + Add profile.
  #   8. Expanded Gemini shows: 🔑 API key (not set), ⚙ Settings, + Add profile; tapping 🔑 API key opens a sheet with a secure key field.
  #   9. After a test of Anthropic, its header shows '✓ 812 ms' or '✗ 401 Unauthorized'.
  #   10. Removing Gemini's key from its API key sheet asks 'Remove the Gemini key from fspec?'; for a key from the environment, a warning then says it returns when the daemon restarts unless removed from the environment.
  #
  # ========================================
  Background: User Story
    As a Paseo user running fspec agents
    I want to manage fspec's providers from a Paseo settings screen
    So that I can add keys, test them and refresh models from desktop or phone without the fspec TUI

  Scenario: The settings screen opens from Settings, the Command Center and a slash command
    Given the fspec plugin's client contributions are registered
    Then a settings screen "fspec-providers" titled "fspec providers" is added
    And a global Command Center item "fspec providers" and the slash command /fspec-providers open that screen with openSettings

  Scenario: The provider list carries each provider's profiles without their keys
    Given the daemon reports provider settings with openai profiles Strata (http://10.0.0.5:8080/v1, key "lm-secret") and spark (http://spark:8000/v1)
    When the client calls fspec.settings.list
    Then the openai row lists profiles Strata and spark with their base URLs
    And the response does not contain "lm-secret"

  Scenario: Profiles fold under their provider and headers read like the fspec TUI
    Given credentials for anthropic (OAuth, 17 models), openai (key "sk-••••abcd" from env, profiles Strata and spark), openai:Strata and openai:spark (custom) and gemini (unconfigured)
    When the screen builds the provider tree
    Then the providers are Anthropic, OpenAI and Gemini in that order
    And their headers read "✓ OAuth [Claude]", "✓ sk-••••abcd [env] (2 profiles)" and "(not configured)"

  Scenario: An expanded OpenAI shows Settings and its profiles but no API key row
    Given the provider tree from the credentials above
    When the user expands OpenAI
    Then its rows are "⚙ Settings", "📁 Strata → http://10.0.0.5:8080/v1", "+ Add model to Strata", "📁 spark → http://spark:8000/v1", "+ Add model to spark" and "+ Add profile"
    And the header offers Test and Refresh models

  Scenario: An expanded OAuth provider shows its sign-in rows first
    Given the provider tree from the credentials above
    When the user expands Anthropic
    Then its rows are "✓ Logged in [Claude]", "🔑 Sign in with browser", "🔑 Sign in with code", "⚙ Settings" and "+ Add profile"

  Scenario: An expanded API-key provider shows its key row, and each row opens its own sheet
    Given the provider tree from the credentials above
    When the user expands Gemini and taps its rows
    Then its rows are "🔑 API key (not set)", "⚙ Settings" and "+ Add profile"
    And they open the API key sheet, the Settings sheet and the new-profile sheet for gemini
    And tapping the Gemini header again collapses it

  Scenario: Saving a key reloads the list and refreshes Paseo's fspec models
    Given gemini is unconfigured
    When the user saves the Gemini key "AIza-test"
    Then save-credentials is called with kind "api_key" and key "AIza-test"
    And the list is reloaded and Paseo is asked to refresh the fspec provider
    And the key field is cleared

  Scenario: A saved key whose refresh fails reports the refresh failure as a warning
    Given saving the Gemini key succeeds with the warning "The key returns when the fspec daemon restarts unless removed from the environment."
    When reloading the list fails with "socket closed" and refreshing Paseo's models fails with "provider busy"
    Then the save is ok with the warning lines "The key returns when the fspec daemon restarts unless removed from the environment.", "Saved, but the provider list could not be reloaded: socket closed" and "Saved, but Paseo's fspec models could not be refreshed: provider busy"

  Scenario: Removing a key asks first and passes on the environment warning
    Given gemini's key comes from the environment
    When the user asks to remove gemini's key
    Then the confirmation reads "Remove the Gemini key from fspec?"
    And after confirming, the feed's warning that the key returns when the daemon restarts is shown

  Scenario: A connection test shows its result on the provider header
    Given the feed answers a test of anthropic with success in 812 ms, and a second test with "401 Unauthorized"
    When the screen describes each result
    Then the header shows "✓ 812 ms" and then "✗ 401 Unauthorized"

  Scenario: An unreachable daemon shows the reason and a Retry action
    Given the feed answers list with state "unavailable" and reason "no fspec daemon is running — no live entry in /h/.fspec/daemons; start fspec daemon first"
    When the screen renders that answer
    Then it shows that reason with a Retry action, not an empty list

  Scenario: A failed action leaves the list alone and reports the daemon's error
    Given the feed answers save-credentials with { ok: false, error: "credentials file is read-only" }
    When the user saves a key
    Then the list is not reloaded and Paseo is not asked to refresh
    And the sheet shows "credentials file is read-only"
