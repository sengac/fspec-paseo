@done
@kanban
@board
@FSPEC-037
@FSPEC-066
Feature: Reorder fspec cards and open them in an agent from the Paseo board
  """
  server/wire.ts: moveWorkUnitUp 18, moveWorkUnitDown 19 (request id: String; Result<(), String>). shared/board.ts: moveBoardRpc. server/board.ts: feed.move(). client/open-in-agent.ts: pure focusedAgent()/defaultModel() + openInAgent(deps) with injected Paseo calls. client/board-panel.tsx: strip actions. FSPEC-066: openInAgent uses only the model Paseo marks default (fspec's default model) and fspecModels(result) turns Paseo's listModels error or a missing model list into an error.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. Move up/move down are plugin RPC fspec.board.move({ cwd, id, direction }) calling move_work_unit_up / move_work_unit_down (idx 18/19, Result<(), String>) behind the workspace guard; the answer is { ok: true } or { ok: false, error } and the new order arrives through the normal WorkUnitsUpdate push
  #   2. The details strip offers Move up and Move down for the selected card except in the done column (the daemon refuses done); a failed move shows its error as a toast
  #   3. Open in agent switches to the Paseo agent whose fspec session is focused on the card: an agent with provider 'fspec', not closed, whose persistence.metadata.pluginProviderPersistence.data.sessionId is one of the board's focus session ids for that card
  #   4. When no agent is focused on the card, Open in agent creates an fspec agent in the workspace with model 'fspec/<default model>' (the isDefault model from Paseo's fspec catalog — FSPEC-066: only that model; without one Open in agent fails 'fspec has no default model — set one under fspec providers', and Paseo's listModels error fails it with that error), title '<id> — <title>' and the initial prompt '/focus <id>' (the provider's focus command, no model turn), then opens it
  #   5. Open in agent is only offered when the host provides navigation (navigation.openAgent)
  #
  # EXAMPLES:
  #   1. fspec.board.move({ cwd: '/ws', id: 'FSPEC-003', direction: 'up' }) -> move_work_unit_up('FSPEC-003') -> { ok: true }; daemon Err('cannot move done work unit') -> { ok: false, error: 'cannot move done work unit' }
  #   2. focus { FSPEC-001: ['fspec-sess-1'] } and agent A1 (fspec, idle, persistence data sessionId fspec-sess-1) -> Open in agent opens A1 without creating anything
  #   3. FSPEC-002 unfocused, fspec models [m1, m2 (isDefault)] -> creates agent { provider: 'fspec/m2', title: 'FSPEC-002 — Wire codec', prompt: '/focus FSPEC-002' } and opens it
  #
  # ========================================
  Background: User Story
    As a Paseo user working an fspec board
    I want to reorder cards within a column and open a card in an fspec agent
    So that I can prioritise and start work from the Paseo board like I do from the fspec TUI

  Scenario: Cards move up and down within their column
    Given the fspec daemon serves "/ws"
    When the panel moves "FSPEC-003" up and "FSPEC-004" down
    Then the daemon receives move_work_unit_up "FSPEC-003" and move_work_unit_down "FSPEC-004" and both answer ok
    And a daemon error "cannot move done work unit" answers not ok with that error

  Scenario: Open in agent switches to the agent focused on the card
    Given "FSPEC-001" is focused by fspec session "fspec-sess-1" owned by Paseo agent "A1"
    When the user opens "FSPEC-001" in an agent
    Then Paseo agent "A1" is opened and no agent is created

  Scenario: Open in agent creates a focused fspec agent when none is on the card
    Given "FSPEC-002" titled "Wire codec" has no focused session and the fspec models are "m1" and default "m2"
    When the user opens "FSPEC-002" in an agent
    Then an agent is created with model "fspec/m2", title "FSPEC-002 — Wire codec" and prompt "/focus FSPEC-002"
    And the new agent is opened

  Scenario: Open in agent without fspec's default model fails
    Given "FSPEC-002" has no focused session and the fspec models are "m1" and "m2" with no default
    When the user opens "FSPEC-002" in an agent
    Then it fails with "fspec has no default model — set one under fspec providers" and no agent is created

  Scenario: Open in agent reports Paseo's model listing error
    Given Paseo answers the fspec model listing with the error "provider fspec is loading"
    When the board reads the fspec models
    Then it fails with "provider fspec is loading"
    And a listing without models fails with "Paseo listed no fspec models"
