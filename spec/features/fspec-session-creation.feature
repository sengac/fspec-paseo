@done
@core
@provider
@FSPEC-039
Feature: Report why fspec could not create a session instead of 'Session not found'

  """
  server/wire.ts: createSessionChecked 121 (request role: Option<String>; response Result<SessionId, String>). server/session.ts open(): replace createSession with createSessionChecked. test/support/fake-daemon.ts: default handler for createSessionChecked.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. The provider creates daemon sessions with create_session_checked (idx 121, Result<SessionId, String>), never the legacy create_session (idx 3) that answers an empty id on failure
  #   2. A creation failure fails the open with 'fspec could not create a session: <cause>' and the provider makes no set_session_model or set_thinking_level call for it
  #
  # EXAMPLES:
  #   1. create_session_checked answers Err('no credentials for provider openai') -> session.open fails with 'fspec could not create a session: no credentials for provider openai'; requests sent: getWorkspaceInfo, listProviders, createSessionChecked only
  #   2. create_session_checked answers Ok('fspec-sess-42') -> the open proceeds exactly as before (setSessionModel, setThinkingLevel on fspec-sess-42)
  #
  # ========================================

  Background: User Story
    As a Paseo user starting an fspec agent
    I want to see why fspec could not start a session
    So that I can fix the real problem (model backend, credentials) instead of chasing a 'Session not found' that never applied

  Scenario: A daemon session that cannot be created fails the open with its cause
    Given create_session_checked answers the error "no credentials for provider openai"
    When Paseo opens an fspec session
    Then the open fails with "fspec could not create a session: no credentials for provider openai"
    And the provider sent no set_session_model or set_thinking_level

  Scenario: A created daemon session opens as before
    Given create_session_checked answers the session id "fspec-sess-42"
    When Paseo opens an fspec session
    Then the provider applied the model and thinking level to "fspec-sess-42" and the open reached session.ready
    And the legacy create_session was never called
