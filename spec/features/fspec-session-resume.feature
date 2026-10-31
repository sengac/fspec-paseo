@done
@core
@provider
@FSPEC-009
Feature: Resume persisted fspec sessions on reopen

  """
  server/session.ts open(): resume_session (idx 55, added to server/wire.ts) for saved sessions; failure falls back to create_session with a warning notice and no replay.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. session.open with persistence calls resume_session (RPC idx 55) for the saved daemon session id before applying model/thinking; on success that daemon session is reused and no create_session is issued
  #   2. when resume_session fails (no saved manifest), the provider creates a fresh daemon session, publishes its new id in session.opened persistence, emits a warning session.notice naming the resume error, and skips history replay
  #   3. a fresh session.open (no persistence) never calls resume_session
  #
  # EXAMPLES:
  #   1. Live: open (daemon id 4050903e-...), prompt, close (destroy_session), reopen with that persistence -> previously request.failed 'set_session_model failed: Session not found: 4050903e-...'; now resume_session(4050903e-...) is called first, the reopen reaches session.ready with the same daemon id, and a follow-up prompt runs
  #   2. Reopen with persistence { sessionId: 'gone-1' } where resume_session returns Err('Failed to load session manifest: not found'): the provider creates fspec-sess-42, session.opened carries persistence data.sessionId 'fspec-sess-42', a warning notice names the resume error, and session.ready follows
  #
  # ========================================

  Background: User Story
    As a Paseo user refreshing or reopening an fspec session
    I want to have the provider resume the same daemon conversation
    So that refresh keeps my history and the session keeps working instead of failing with Session not found

  Scenario: Reopening a closed session resumes it on the daemon
    Given an fspec session mapped to daemon id "fspec-sess-42" that Paseo closed with session.close
    When Paseo reopens it with persistence { version: 1, data: { sessionId: "fspec-sess-42" } }
    Then the provider called resume_session("fspec-sess-42") before set_session_model and set_thinking_level
    And it issued no create_session and the reopen reached session.ready with persistence data.sessionId "fspec-sess-42"
    And a follow-up prompt is sent to daemon session "fspec-sess-42"


  Scenario: A session the daemon cannot resume starts fresh with a notice
    Given a saved persistence { sessionId: "gone-1" } whose resume_session fails with "Failed to load session manifest: not found"
    When Paseo reopens it with history "replay"
    Then the provider created a new daemon session "fspec-sess-42" and session.opened carries persistence data.sessionId "fspec-sess-42"
    And it emitted a warning session.notice naming the resume error
    And it requested no transcript pages and still reached session.ready


  Scenario: A fresh open never resumes
    Given Paseo opens an fspec session without persistence
    When the provider completes the open
    Then it called create_session and never called resume_session

