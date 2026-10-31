@done
@core
@provider
@FSPEC-024
Feature: Revert files to fspec checkpoints from Paseo

  """
  server/session.ts attaches new checkpoints to fspec tool cards (list_checkpoints idx 11) and reverts files with restore_checkpoint_all (idx 15).
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. No (decided during implementation): only file revert maps cleanly onto fspec's ghost-commit checkpoints (restore_checkpoint_all); restore_session_messages replaces history wholesale and is not a turn-level rewind, so only session.revert.files is advertised
  #   2. On session open the provider records the checkpoints that already exist (list_checkpoints idx 11); after each completed 'fspec' tool call it lists them again and any new checkpoint becomes that tool card's revertToken { workUnitId, name } (the card is re-published with it)
  #   3. A session.revert with scope 'files' and a checkpoint token calls restore_checkpoint_all (idx 15, work_unit_id, name) and answers request.completed; a daemon error or a malformed token answers request.failed
  #
  # EXAMPLES:
  #   1. The agent runs fspec update-work-unit-status AUTH-001 implementing; afterwards list_checkpoints shows a new 'AUTH-001-auto-testing' -> the fspec tool card gets revertToken { workUnitId: 'AUTH-001', name: 'AUTH-001-auto-testing' }
  #   2. The user picks 'revert files' on that card -> restore_checkpoint_all('AUTH-001', 'AUTH-001-auto-testing') -> request.completed
  #   3. A revert token that is not { workUnitId, name } -> request.failed 'Not an fspec checkpoint'
  #
  # QUESTIONS (ANSWERED):
  #   Q: fspec has no conversation-rewind RPC; should conversation revert be offered?
  #   A: No (decided during implementation): only file revert maps cleanly onto fspec's ghost-commit checkpoints (restore_checkpoint_all); restore_session_messages replaces history wholesale and is not a turn-level rewind, so only session.revert.files is advertised
  #
  # ========================================

  Background: User Story
    As a Paseo user whose fspec agent changed files
    I want to revert the working tree to an fspec checkpoint from the timeline
    So that I can undo an agent's file changes back to a known-good point without leaving Paseo

  Scenario: A checkpoint created by an fspec tool call becomes a revert point
    Given an open fspec session whose daemon already had checkpoint "AUTH-001-baseline"
    When the agent's fspec tool call "call-3" completes and list_checkpoints now also shows "AUTH-001-auto-testing" for work unit "AUTH-001"
    Then the provider re-published tool card "tool:call-3" with revertToken { workUnitId "AUTH-001", name "AUTH-001-auto-testing" }
    And no revert token points at "AUTH-001-baseline"


  Scenario: Reverting files restores the checkpoint
    Given a tool card with revertToken { workUnitId "AUTH-001", name "AUTH-001-auto-testing" }
    When Paseo sends session.revert with scope files and that token
    Then the provider called restore_checkpoint_all("AUTH-001", "AUTH-001-auto-testing") and answered request.completed


  Scenario: A failed or malformed revert is reported
    Given an open fspec session
    When Paseo sends session.revert with scope files and the token "oops"
    Then the provider answered request.failed "Not an fspec checkpoint" and restored nothing
    And when restore_checkpoint_all fails with "dirty tree" the revert answers request.failed "dirty tree"


  Scenario: Only file revert is offered
    Given Paseo connects to the fspec provider with every capability
    When the connection negotiates capabilities
    Then it includes session.revert.files and excludes session.revert.conversation and session.revert.both

