@done
@provider
@core
@FSPEC-044
@FSPEC-065
Feature: Sign in to OAuth providers for fspec from Paseo
  """
  server/oauth.ts (createOAuthLogins(call)): logins keyed by id with state pending | code | succeeded | failed; start(providerId, method, enterpriseHost) runs the daemon calls (long deadline via DaemonConnection.request(message, { deadlineMs })), complete(loginId, code) uses the server-held verifier, status(loginId) long-polls with a 20 s hold (like BOARD_HOLD_MS), cancel(loginId) forgets it. RPCs fspec.settings.oauth-start / oauth-complete / oauth-status / oauth-cancel / oauth-logout. Client: client/oauth-sheet.tsx renders the flow; pure step text in client/settings-model.ts. FSPEC-065: client/oauth-flow.ts (pure) holds the status watch, the code copy and the close-time cancel, each reporting its failure.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. Each OAuth sign-in row opens its flow in a sheet, as the TUI offers them: 'Sign in with browser' (anthropic, codex, others) starts oauth_browser_login and says it opens a browser on the computer running fspec; 'Sign in with code' (anthropic) shows the sign-in link (oauth_headless_start) and a field to paste the code (oauth_headless_complete); 'Sign in with device code' (codex, github-copilot) shows the code and verification link (oauth_device_start / oauth_copilot_device_start with an optional GitHub Enterprise host) and waits (oauth_device_poll).
  #   2. A sign-in that waits (browser, device code) runs as a server-side task with a 15-minute daemon deadline; the sheet long-polls its status in holds under Paseo's 30 s RPC limit until it succeeds, fails or is cancelled; closing the sheet or Cancel abandons it and a late result is ignored.
  #   3. The PKCE verifier and every token stay on the plugin server: the client only ever sees a login id, the link, the user code and the outcome.
  #   4. The '✓ Logged in [Claude|ChatGPT|GitHub Copilot]' row opens a sheet offering 'Log out', which asks for confirmation and calls oauth_clear_tokens.
  #   6. FSPEC-065: a sign-in status poll that fails ends the sign-in as failed with 'The sign-in status could not be read: <reason>'; a failed copy shows 'The code could not be copied: <reason>'; a failed cancel when the sheet closes is logged
  #   5. After a successful sign-in or log-out the list reloads and Paseo refreshes the fspec provider; a failure shows the daemon's message in the sheet.
  #
  # EXAMPLES:
  #   1. Anthropic → 'Sign in with code' shows 'Open the sign-in page' (the authorize URL) and a code field; pasting 'abc#state' and Submit calls oauth_headless_complete(anthropic, 'abc#state', <verifier kept on the server>) and the sheet shows 'Signed in to Claude'.
  #   2. Codex → 'Sign in with device code' shows code ABCD-1234 and https://auth.openai.com/device; the sheet shows 'Waiting for approval…' until oauth_device_poll returns, even past 30 s.
  #   3. GitHub Copilot → 'Sign in with device code' asks for an optional GitHub Enterprise host first; empty sends None, 'ghe.example.com' sends that host.
  #   4. Anthropic → 'Sign in with browser' says 'A browser opens on the computer running fspec' and waits for oauth_browser_login.
  #   5. Closing a device-code sheet before approval ignores the later success; the list is still refreshed on the next reload.
  #   6. '✓ Logged in [ChatGPT]' → Log out → 'Log out of ChatGPT in fspec?' → oauth_clear_tokens(codex); the header then reads '(not configured)'.
  #
  # ========================================
  Background: User Story
    As a Paseo user running fspec agents
    I want to sign fspec in to and out of OAuth providers from the fspec providers screen
    So that I can use Claude, ChatGPT and GitHub Copilot subscriptions with fspec without the fspec TUI, even from my phone

  Scenario: Signing in with a code keeps the verifier on the server
    Given the daemon answers oauth_headless_start for anthropic with an authorize URL and the verifier "verifier-123"
    When the user starts "Sign in with code" for anthropic and submits the code "abc#state"
    Then the client receives a login id and the authorize URL but not "verifier-123"
    And the daemon receives oauth_headless_complete(anthropic, "abc#state", "verifier-123")
    And the login's status is succeeded

  Scenario: A device-code sign-in waits past Paseo's RPC limit
    Given the daemon answers oauth_device_start for codex with code "ABCD-1234" and holds oauth_device_poll
    When the user starts "Sign in with device code" for codex and the client asks for its status
    Then the client receives the code "ABCD-1234" and the verification link
    And a status request answers pending once the hold expires
    And oauth_device_poll was sent with a 15-minute deadline
    And when the poll returns, the next status answers succeeded

  Scenario: GitHub Copilot sends the optional enterprise host
    Given the daemon answers oauth_copilot_device_start
    When the user starts a GitHub Copilot sign-in without a host and then with "ghe.example.com"
    Then the daemon receives oauth_copilot_device_start with no host and then with "ghe.example.com"

  Scenario: Browser sign-in opens a browser on the daemon's computer
    Given the daemon holds oauth_browser_login for anthropic
    When the user starts "Sign in with browser" for anthropic
    Then the sheet says "A browser opens on the computer running fspec. Finish signing in there."
    And the login stays pending until oauth_browser_login returns

  Scenario: An abandoned sign-in ignores its late result
    Given a codex device-code sign-in is waiting
    When the user cancels it and the daemon's poll then succeeds
    Then its status answers unknown

  Scenario: A failed sign-in reports the daemon's message
    Given the daemon answers oauth_device_poll for codex with Err("device code expired")
    When the user starts "Sign in with device code" for codex
    Then its status answers failed with "device code expired"

  Scenario: Logging out asks first and clears the tokens
    Given codex is signed in
    When the user opens "✓ Logged in [ChatGPT]" and confirms
    Then the confirmation reads "Log out of ChatGPT in fspec?"
    And the daemon receives oauth_clear_tokens(codex)

  Scenario: A sign-in whose status cannot be read fails with the reason
    Given a device-code sign-in for codex is waiting for approval
    When the status RPC fails with "request timed out"
    Then the sign-in ends as failed with "The sign-in status could not be read: request timed out" and is not polled again

  Scenario: Copy and cancel failures are reported
    Given a device-code sign-in shows its code
    When copying the code fails with "clipboard denied" and cancelling on close fails with "socket closed"
    Then the sheet shows "The code could not be copied: clipboard denied"
    And the console logs the failed cancel naming "socket closed"
