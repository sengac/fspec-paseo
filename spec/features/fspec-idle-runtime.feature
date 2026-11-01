@done
@core
@provider
@FSPEC-027
@FSPEC-067
Feature: Answer Paseo idle-runtime checks for fspec sessions
  """
  server/session.ts canStopRuntime() checks local turns/requests/children, then get_session_status (6) and get_pending_input (60).
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. The provider advertises 'session.can_stop_runtime' and answers each such input with exactly one session.can_stop_runtime event (never request.completed) carrying canStop
  #   2. canStop is true only when the session has no queued or running turn, no open approval/HITL request, no open stdin request, no open sub-agent child, the daemon reports get_session_status (idx 6) idle, and get_pending_input (idx 60) is empty
  #   3. The check never changes the session; an RPC failure answers canStop false so the runtime stays alive, and FSPEC-067: the failure is logged
  #
  # EXAMPLES:
  #   1. Idle session, status idle, no pending input -> canStop true
  #   2. A turn is running (or a sub-agent child is open, or an approval prompt is pending) -> canStop false without asking the daemon
  #   3. get_session_status fails -> canStop false
  #
  # ========================================
  Background: User Story
    As a Paseo user with idle fspec agents
    I want to let Paseo release idle fspec runtimes only when nothing would be lost
    So that resources are freed without killing background work or pending questions

  Scenario: An idle session can be stopped
    Given an open fspec session with no turn, request or child, whose daemon status is idle with no pending input
    When Paseo asks session.can_stop_runtime
    Then the provider answered session.can_stop_runtime with canStop true and no request.completed

  Scenario: Busy sessions keep their runtime
    Given an open fspec session with a running turn
    When Paseo asks session.can_stop_runtime
    Then the provider answered canStop false
    And a session with pending input on the daemon also answers canStop false

  Scenario: A failed check keeps the runtime
    Given an open idle fspec session whose get_session_status fails
    When Paseo asks session.can_stop_runtime
    Then the provider answered canStop false
    And the plugin log has the failed check
