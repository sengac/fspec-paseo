@done
@kanban
@board
@FSPEC-040
Feature: Open the fspec board from the workspace menu on phones

  """
  shared/board.ts boardAvailableRpc; server/board.ts feed.available(); client/board-buttons.ts syncBoardButtons(deps) with injected list/subscribe, available, addHeaderButton, openPanel (testable without React Native); client/register.ts wires it with client.paseo.workspaces.list({ subscribe: {} }).
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. The client watches Paseo's workspace list (workspaces.list with subscribe) and gives each workspace whose directory (workspaceDirectory, else projectRootPath) the fspec daemon serves an 'fspec board' header button that opens the fspec-board panel in that workspace; on phones Paseo shows it as a row of the workspace ··· menu
  #   2. Whether the daemon serves a directory comes from plugin RPC fspec.board.available({ cwd }) -> { available }, which applies the board's workspace guard and answers false when the daemon is unreachable
  #   3. A removed workspace loses its button; unloading the plugin removes every button and ends the workspace subscription
  #
  # EXAMPLES:
  #   1. Workspaces W1 (/ws) and W2 (/other) with the daemon serving /ws -> one header button for W1; pressing it opens panel fspec-board in W1; W2 gets none
  #   2. workspace_update remove W1 -> W1's button is removed; plugin cleanup -> all buttons removed and the subscription released
  #
  # ========================================

  Background: User Story
    As a Paseo user on a phone
    I want to open the fspec board from a workspace
    So that the board is reachable on mobile, not only on desktop

  Scenario: Workspaces the fspec daemon serves get an fspec board button
    Given workspaces "W1" in "/ws" and "W2" in "/other" while the fspec daemon serves "/ws"
    When the plugin client starts
    Then "W1" has an "fspec board" header button and "W2" has none
    And pressing the button opens panel "fspec-board" in "W1"

  Scenario: Buttons follow workspace removal and plugin unload
    Given "W1" has an "fspec board" header button
    When Paseo reports "W1" removed
    Then its button is removed
    And unloading the plugin removes every button and releases the workspace subscription

  Scenario: The daemon answers which directories it serves
    Given the fspec daemon serves "/ws"
    When the client asks fspec.board.available for "/ws/sub" and "/other"
    Then "/ws/sub" is available and "/other" is not
