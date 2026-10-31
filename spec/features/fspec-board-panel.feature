@done
@kanban
@board
@FSPEC-035
Feature: Show the fspec board as a native Paseo workspace panel

  """
  index.client.tsx (registration), client/board-model.ts (pure: columns, card label, latest marker, summary, search, default compact column — unit tested with vitest), client/use-board.ts (long-poll hook on useRpc + useWorkspace), client/board-panel.tsx (React Native view: wide columns vs compact chips, theme colors only). package.json files + devDeps react 19.2.3, react-native 0.86.3, @types/react, @tanstack/react-query; tsconfig jsx react-jsx; manifest requirements paseo >=0.13.0 (useTabState, unified panel props).
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. The client registers workspace panel 'fspec-board' (title 'fspec board', locations ['workspace']), a workspace Command Center item 'Open fspec board' and a workspace slash command /board, both of which open the panel
  #   2. The panel long-polls fspec.board.watch with cwd = the workspace directory, re-issuing it as soon as each answer arrives with sinceRevision = the answered revision; a failed RPC is retried after 3 seconds
  #   3. Columns are the seven fspec states in fixed order backlog, specifying, testing, implementing, validating, done, blocked, each with its card count; cards keep the daemon's order within a column
  #   4. A card reads like the TUI cell: 'ID [pts]' (points only when estimated) over its title; it is prefixed with a green dot when an fspec session is focused on it, and the single card with the latest lastStateChangeAt is marked as the most recent change
  #   5. The board footer shows the fspec board summary 'N points in progress, M points completed' (done estimates are completed, every other column is in progress)
  #   6. Search mirrors the TUI '/' dialog: case-insensitive substring over id (default), title or description (units without a description never match in description mode); choosing a result selects that card and, on compact layouts, switches to its column
  #   7. Wide layouts show all columns side by side (horizontal scroll), each column a virtualized list; compact layouts (layout.compact, i.e. mobile) show a row of column chips with counts and one virtualized list for the chosen column
  #   8. The chosen compact column and the selected card persist per panel tab (useTabState)
  #   9. An unavailable board shows its reason in place of the columns and recovers automatically when the board becomes ready
  #   10. Compact layouts open on the first non-empty column in board order until the user picks one
  #
  # EXAMPLES:
  #   1. Board [FSPEC-001 backlog 3pts, FSPEC-002 done 5pts, FSPEC-003 backlog] -> backlog (2): FSPEC-001 [3], FSPEC-003; done (1): FSPEC-002 [5]; other columns (0); summary '3 points in progress, 5 points completed'
  #   2. focus { FSPEC-001: ['fspec-sess-1'] } -> FSPEC-001's card label is '🟢 FSPEC-001 [3]'
  #   3. FSPEC-001 lastStateChangeAt 2026-10-30T01:00Z, FSPEC-002 2026-10-30T02:00Z, FSPEC-003 null -> only FSPEC-002 is marked most recent
  #   4. Search mode title, query 'SCAFF' -> matches FSPEC-001 'Scaffold the plugin'; mode description with query '' -> only units with a description
  #   5. Compact layout with backlog empty and specifying holding FSPEC-004 -> opens on specifying; choosing search result FSPEC-002 (done) switches the list to done and selects it
  #   6. watch answers unavailable 'the fspec daemon serves /ws, not /other — ...' -> the panel shows that text; the next ready answer shows the columns
  #
  # QUESTIONS (ANSWERED):
  #   Q: Cap the done column (1,645 units in fspec) like the CLI's 25 per column, or let it scroll?
  #   A: Let it scroll: columns are virtualized lists, so no cap is needed (default chosen while moving through the cards; user can overrule)
  #
  #   Q: Which column does mobile open on?
  #   A: The first non-empty column in board order (default chosen; user can overrule)
  #
  #   Q: Should the panel also be offered in the desktop explorer sidebar?
  #   A: No, workspace tab only: seven columns do not fit the narrow explorer (default chosen; user can overrule)
  #
  # ========================================

  Background: User Story
    As a Paseo user on desktop or mobile
    I want to open an fspec board panel in a workspace
    So that I see the same live Kanban board as the fspec TUI without leaving Paseo

  Scenario: Columns, counts and the points summary follow the fspec board
    Given a board with "FSPEC-001" in backlog with 3 points, "FSPEC-002" in done with 5 points and "FSPEC-003" in backlog unestimated
    When the panel groups the board into columns
    Then the columns are backlog, specifying, testing, implementing, validating, done and blocked in that order
    And backlog holds "FSPEC-001" then "FSPEC-003", done holds "FSPEC-002" and every other column is empty
    And the summary reads "3 points in progress, 5 points completed"

  Scenario: Card labels show points, focus and the most recent change
    Given "FSPEC-001" has 3 points and an fspec session focused on it
    And "FSPEC-002" changed state at 02:00 and "FSPEC-001" at 01:00
    When the panel labels the cards
    Then "FSPEC-001" reads "🟢 FSPEC-001 [3]" and "FSPEC-003" reads "FSPEC-003"
    And only "FSPEC-002" is marked as the most recent change

  Scenario: Search matches id, title or description like the TUI
    Given "FSPEC-001" titled "Scaffold the plugin" with no description and "FSPEC-002" described as "Wire codec"
    When the user searches "scaff" in title mode
    Then only "FSPEC-001" matches
    And an empty query in description mode matches only "FSPEC-002"

  Scenario: Compact layouts open on the first non-empty column and follow search
    Given a compact layout where backlog is empty and specifying holds "FSPEC-004"
    When the panel opens without a chosen column
    Then it shows the specifying column
    And choosing search result "FSPEC-002" in done switches to done and selects "FSPEC-002"

  Scenario: The panel keeps watching the board
    Given a panel watching workspace "/ws"
    When fspec.board.watch answers revision "E:1"
    Then the panel shows that board and immediately watches again since "E:1"
    And an unavailable answer is shown and replaced by the next ready answer
    And a failed watch is retried after 3 seconds

  Scenario: The panel opens from the Command Center and /board
    Given the fspec plugin client is contributed
    When the user selects "Open fspec board" or submits /board in a workspace
    Then the workspace panel "fspec-board" titled "fspec board" opens
