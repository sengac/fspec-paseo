@done
@kanban
@board
@FSPEC-040
@FSPEC-066
Feature: Open the fspec board from the workspace menu on phones
  """
  shared/board.ts boardAvailableRpc; server/board.ts feed.available(); client/board-buttons.ts syncBoardButtons(deps) with injected list/subscribe, available, addHeaderButton, openPanel (testable without React Native); client/register.ts wires it with client.paseo.workspaces.list({ subscribe: {} }). FSPEC-066: available answers served | unserved (server/daemon.ts DaemonNotFoundError or no served workspace holds it) | failed; a failed check is logged and shows the button titled 'fspec board (error)'.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. The client watches Paseo's workspace list (workspaces.list with subscribe) and gives each workspace whose directory (workspaceDirectory, else projectRootPath) the fspec daemon serves an 'fspec board' header button that opens the fspec-board panel in that workspace; on phones Paseo shows it as a row of the workspace ··· menu
  #   2. Whether the daemon serves a directory comes from plugin RPC fspec.board.available({ cwd }) -> { available }, which applies the board's workspace guard — SUPERSEDED by FSPEC-066 for the answer's shape
  #   4. FSPEC-066: fspec.board.available answers { state: 'served' }, { state: 'unserved', reason } (no daemon serves the directory, or no workspace it serves holds it) or { state: 'failed', error } (any other error, including several daemons and an unloaded plugin)
  #   5. FSPEC-066: a failed check, including a failed RPC, is logged '[fspec board] availability check for <dir> failed: <error>' and the workspace gets the button titled 'fspec board (error)', whose panel reports the failure
  #   6. FSPEC-066: a failed release of the workspace subscription is logged
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
    Then "/ws/sub" is served and "/other" is unserved with the reason "the fspec daemon serves /ws, not /other — start fspec in /other to use it there"

  Scenario: A failing daemon is a failed check, not an unserved directory
    Given the fspec daemon's list_workspaces fails with "registry unreadable"
    When the client asks fspec.board.available for "/ws"
    Then it answers failed with "fspec daemon list_workspaces failed: registry unreadable"
    And with no fspec daemon running it answers unserved with the no-daemon reason

  Scenario: A failed check shows an error button and is logged
    Given workspace "W1" in "/ws" whose availability check fails with "socket closed"
    When the plugin client starts
    Then "W1" has a header button titled "fspec board (error)" that opens panel "fspec-board"
    And the console logs "[fspec board] availability check for /ws failed: socket closed"
