@done
@core
@provider
@FSPEC-009
@FSPEC-057
Feature: Resume persisted fspec sessions on reopen
  """
  server/session.ts open(): resume_session (idx 55, added to server/wire.ts) for saved sessions; FSPEC-057: a failed resume fails the open (no fresh session in its place), and prompt unwraps send_input's Result<(), String> (fspec BUG-328: input is accepted only for a session the daemon holds live, so reopened and imported sessions are resumed before any input).
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. session.open with persistence calls resume_session (RPC idx 55) for the saved daemon session id before applying model/thinking; on success that daemon session is reused and no create_session is issued
  #   2. FSPEC-057: when resume_session fails (no saved manifest), the open fails with 'fspec could not resume session <id>: <reason>' and no daemon session is created in its place
  #   3. a fresh session.open (no persistence) never calls resume_session
  #   4. FSPEC-057: send_input (idx 4) and send_input_with_thinking (idx 46) answer Result<(), String>; an Err (e.g. 'Session not found: <id>') fails the prompt's turn with the daemon's reason
  #
  # EXAMPLES:
  #   1. Live: open (daemon id 4050903e-...), prompt, close (destroy_session), reopen with that persistence -> previously request.failed 'set_session_model failed: Session not found: 4050903e-...'; now resume_session(4050903e-...) is called first, the reopen reaches session.ready with the same daemon id, and a follow-up prompt runs
  #   2. Reopen with persistence { sessionId: 'gone-1' } where resume_session returns Err('Failed to load session manifest: not found'): request.failed 'fspec could not resume session gone-1: Failed to load session manifest: not found', no create_session
  #   3. send_input answers Err('Session not found: s-1') (golden send_input_err) -> the turn fails with 'fspec daemon send_input failed: Session not found: s-1'
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

  Scenario: A session the daemon cannot resume fails the open
    Given a saved persistence { sessionId: "gone-1" } whose resume_session fails with "Failed to load session manifest: not found"
    When Paseo reopens it with history "replay"
    Then the open fails with "fspec could not resume session gone-1: Failed to load session manifest: not found"
    And the provider created no daemon session and requested no transcript pages

  Scenario: A fresh open never resumes
    Given Paseo opens an fspec session without persistence
    When the provider completes the open
    Then it called create_session and never called resume_session

  Scenario: send_input results match the daemon's encoding
    Given the Rust golden vectors for send_input answering Ok(()) and Err("Session not found: s-1")
    When the codec decodes both replies for send_input and send_input_with_thinking
    Then they decode to an ok result and to the error "Session not found: s-1"
    And encoding those results reproduces the golden bytes

  Scenario: A prompt the daemon refuses fails its turn with the reason
    Given an open fspec session whose daemon session "fspec-sess-42" the daemon no longer holds
    When Paseo prompts it and send_input answers "Session not found: fspec-sess-42 (resume it with resume_session before sending input)"
    Then the turn fails with "fspec daemon send_input failed: Session not found: fspec-sess-42 (resume it with resume_session before sending input)"
    And no turn stays running
