@done
@core
@provider
@FSPEC-010
Feature: Fail open sessions when the daemon connection is lost

  """
  provider.ts subscribes to daemon onEvent; connection-lost -> registry.fail(reason) (session.ts) -> transcript.terminalize() rows, settle silently, session.runtime_failed, drop from registry.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. On a daemon connection-lost event every open session first terminalizes its transient timeline rows (running tools -> canceled, loading compaction -> completed), then emits exactly one session.runtime_failed whose error names the lost connection and tells the user to reopen
  #   2. session.runtime_failed is the turn settlement for the dead runtime (Paseo turns it into turn_failed), so the provider marks the active turn settled and emits no extra session.turn for it, now or later
  #   3. Failed sessions are removed from the registry: a later prompt throws Unknown session, a close completes as a no-op, and reopening with the saved persistence reconnects and resumes the daemon session (FSPEC-009)
  #
  # EXAMPLES:
  #   1. Session paseo-1 has turn-1 running with tool call-1 running; the daemon socket closes with code 1001: the provider re-publishes tool:call-1 canceled, then emits session.runtime_failed { error: { message: 'fspec daemon connection was lost: server going away (close 1001) — reopen the session' } } and no session.turn for turn-1
  #   2. After the drop, session.prompt for paseo-1 throws 'Unknown session: paseo-1'; reopening paseo-1 with its persistence opens a new socket, calls resume_session for the saved daemon id and reaches session.ready
  #   3. An idle session (no active turn) also receives session.runtime_failed on the drop, since its daemon runtime may be gone
  #
  # ========================================

  Background: User Story
    As a Paseo user whose fspec daemon restarts or drops mid-session
    I want to see the session fail clearly instead of spinning forever
    So that I know to reopen it, and reopening resumes the conversation

  Scenario: A dropped connection fails the running session after terminalizing its rows
    Given an open fspec session whose turn "turn-1" has a running tool call "call-1"
    When the daemon socket closes with code 1001
    Then the provider re-published "tool:call-1" with status canceled
    And it then emitted one session.runtime_failed whose error says the fspec daemon connection was lost and to reopen the session
    And it emitted no session.turn for "turn-1", even when a late Done chunk arrives


  Scenario: Idle sessions are failed too
    Given an open fspec session with no active turn
    When the daemon socket closes with code 1001
    Then the provider emitted one session.runtime_failed for that session


  Scenario: A failed session can be reopened and resumed
    Given a session that was failed by a dropped daemon connection
    When Paseo sends a prompt to it
    Then the prompt is rejected with Unknown session
    And reopening it with its persistence opens a new daemon socket, calls resume_session for the saved daemon id and reaches session.ready

