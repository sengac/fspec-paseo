@done
@core
@provider
@FSPEC-067
Feature: Report every failed background daemon call of an fspec session
  """
  server/session.ts report(session, what, error): logs '[fspec] <what> (<paseo session>): <reason>' through server/log.ts (plugin stderr, shown by paseo plugin logs) and emits a warning session.notice while the session is open. Callers: markActive (set_active_session), seedFocus (get_work_unit_focus), attachCheckpoint (list_checkpoints), releaseBlockers (reply_interaction_checked deny), closeChild (get_active_session / clear_active_session, reported on the parent). open() reads list_checkpoints before creating anything and keeps the original error first when its cleanup destroy_session fails; interrupt is awaited before request.completed.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. A failed background daemon call of a session is logged '[fspec] <what> (<paseo session>): <reason>' and, while the session is open, shown as a warning session.notice titled <what> with the reason
  #   2. set_active_session, get_work_unit_focus (failure or error result), list_checkpoints after an fspec call and the steer's deny reply (failure or error result; the request then stays shown) are reported that way
  #   3. A sub-agent child's get_active_session / clear_active_session failure is reported on its parent
  #   4. session.interrupt sends interrupt before request.completed; a failure answers request.failed
  #   5. list_checkpoints is read before any daemon session is created; a failure fails the open and creates nothing
  #   6. A failed cleanup destroy after a failed open keeps the original error first: '<original>; the fspec session <id> it created could not be destroyed: <reason>'
  #
  # EXAMPLES:
  #   1. set_active_session rejects 'board busy' on open -> notice 'fspec could not mark this session active on its board' naming 'board busy'
  #   2. interrupt rejects 'Session not found' -> request.failed, no request.completed
  #   3. set_session_model fails 'unknown model', then destroy_session fails 'busy' -> the open fails with both, the original first
  #
  # ========================================
  Background: User Story
    As a Paseo user running fspec agents
    I want to see every fspec call that failed behind my session
    So that a session never silently misses its board mark, focus, revert points or a stop

  Scenario: A failed active mark is reported on the session
    Given set_active_session fails with "board busy"
    When Paseo opens an fspec session
    Then the session shows a warning notice "fspec could not mark this session active on its board" naming "board busy"
    And the plugin log has the failure

  Scenario: A failed stop fails the interrupt request
    Given an open fspec session whose interrupt fails with "Session not found"
    When Paseo interrupts the session
    Then the interrupt answers request.failed naming "Session not found" and no request.completed

  Scenario: A failed cleanup after a failed open keeps the original error first
    Given set_session_model fails with "unknown model" and destroy_session fails with "busy"
    When Paseo opens a fresh fspec session
    Then the open fails with "fspec daemon set_session_model failed: unknown model; the fspec session fspec-sess-42 it created could not be destroyed: fspec daemon destroy_session failed: busy"

  Scenario: Checkpoints that cannot be listed fail the open before anything is created
    Given list_checkpoints fails with "repository locked"
    When Paseo opens a fresh fspec session
    Then the open fails naming "repository locked" and no daemon session was created

  Scenario: Work unit focus that cannot be read is reported
    Given get_work_unit_focus answers the error "focus store unreadable"
    When Paseo opens an fspec session
    Then the session shows a warning notice "fspec work unit focus could not be read" naming "focus store unreadable"

  Scenario: A checkpoint lookup that fails after an fspec call is reported
    Given an open fspec session whose list_checkpoints fails with "repository locked" after it opened
    When an fspec tool call of the session completes
    Then the session shows a warning notice "fspec checkpoints could not be read — this fspec call has no revert point" naming "repository locked"

  Scenario: A steer whose deny fails is reported and the request stays shown
    Given an open fspec session paused on an approval while its turn runs, whose reply_interaction_checked answers the error "pause moved on"
    When Paseo steers the turn with clearPendingPermissions
    Then the session shows a warning notice "fspec could not deny the request blocking the steer" naming "pause moved on"
    And the approval is not resolved

  Scenario: A sub-agent active mark that cannot be cleared is reported on its parent
    Given an open child session "paseo-1:sub:sub-9" that is fspec's active session, whose clear_active_session fails with "board busy"
    When the daemon reports "sub-9" removed
    Then "paseo-1" shows a warning notice "fspec could not clear the closed sub-agent's active mark" naming "board busy"
