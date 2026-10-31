@done
@kanban
@board
@FSPEC-048
Feature: Show work unit details in a drawer over the fspec board

  """
  client/details-document.ts (pure): documentFor(record, unit) → header {id, title, chips} + blocks of kinds text | userStory | numbered | list | questions | storm | links | attachments | history | fields, ported from details-model.ts SECTIONS / STORM_GROUPS / humanize with deleted items dropped; drawerGeometry(boardWidth, compact) → width; ANDROID_BOTTOM_INSET = 48 and bottomInset(platform). client/details-drawer.tsx: absolute overlay inside the board root (backdrop Pressable + right-anchored Animated.View translateX, native driver), header + actions, body in host ScrollView with contentContainerStyle paddingBottom = inset; BackHandler / Escape close. board-panel.tsx: selection opens the drawer; the DetailsStrip and DetailsDialog are removed; board lists get the same bottom inset.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. Selecting a card opens a drawer that slides in from the right over the top of the board, covering part of it, with the board dimmed behind; tapping the dimmed board, the drawer's Close button, Android Back or web Escape closes it and clears the selection. The old details strip and the separate details sheet are gone.
  #   2. The drawer opens straight onto the card's full fspec record (get_work_unit_details): nothing else needs to be opened to see it, and while it loads the board snapshot's id, title, status, epic, estimate and description show at once.
  #   3. The card's actions sit at the top of the drawer, under the title: Open in agent, Move up and Move down (not for done cards), and Close.
  #   4. The record is laid out as formatted blocks, not raw lines: a header (id, title, and chips for type, status, epic, estimate); Description; User Story (As a / I want / So that); numbered Rules; Examples; Questions with their answers (open ones marked); Assumptions; Architecture Notes; Event Storm grouped by kind; Relationships as tappable work-unit chips; Attachments; a status History timeline; and Accounting, Timestamps and any other fields as label/value rows. Deleted items are hidden; empty blocks are omitted.
  #   5. Tapping a relationship chip shows that work unit in the same drawer.
  #   6. Width: 88% of the board (at most 480) on compact layouts, otherwise 45% (between 360 and 560); the drawer follows Paseo's plugin design rules: theme colours only (surface1 panel, border edge, foreground / foregroundMuted text, accent chips), tighter padding when compact, and the host ScrollView for its body.
  #   7. Reserve a fixed Android bottom inset of 48dp (3-button navigation bar height; also clears gesture navigation) in the drawer, and apply the same bottom clearance to the board's own scrolling lists (search results and card columns). No Paseo SDK change.
  #   8. This replaces FSPEC-036's details strip: its 'The details strip shows the selected card' scenario and the detailsStrip helper are retired; FSPEC-036's details RPC and lossless record projection stay.
  #
  # EXAMPLES:
  #   1. Tapping RPC-347 on the board slides in a drawer showing 'RPC-347 — Backend custom-model RPC + NAPI surface', chips story · done · rust-frontend · 8 pts, then Open in agent / Close at the top (no Move buttons: it is done).
  #   2. RPC-347's drawer lists its 9 rules numbered 1-9, its 8 examples, 3 architecture notes, the user story as 'As a model-selector UI… / I want to add, update, and delete custom… / So that the custom-model write path…', Depends On chips RPC-346 and one more, 2 attachments and a 10-step status history.
  #   3. Tapping the RPC-346 chip in RPC-347's drawer shows RPC-346 in the same drawer.
  #   4. A question with an answer reads 'Should we…?' with 'Answer: …' under it; an unanswered one is marked Open.
  #   5. On an Android phone the drawer's last block and the board's last card sit above the navigation bar.
  #   6. Tapping the dimmed board, Close, Android Back or Escape closes the drawer and clears the selection.
  #
  # QUESTIONS (ANSWERED):
  #   Q: Clearing Android's navigation bar: plugins cannot read safe-area insets (react-native-safe-area-context is not in the plugin runtime and the plugin API exposes none), while Paseo's own panels pad with useSafeAreaInsets. Reserve a fixed Android bottom inset in the drawer now, add an insets API to Paseo's plugin SDK first (a Paseo change), or both?
  #   A: Reserve a fixed Android bottom inset of 48dp (3-button navigation bar height; also clears gesture navigation) in the drawer, and apply the same bottom clearance to the board's own scrolling lists (search results and card columns). No Paseo SDK change.
  #
  # ========================================

  Background: User Story
    As a Paseo user working an fspec board
    I want to see a card's full details and actions in a drawer that slides over the board
    So that I can read and act on a work unit without leaving the board or opening another view, on desktop and phone

  Scenario: Selecting a card opens the drawer with the snapshot first
    Given the board shows RPC-347 "Backend custom-model RPC + NAPI surface" (story, done, epic rust-frontend, 8 points)
    When the user selects RPC-347
    Then the drawer opens for RPC-347 at once with the title "RPC-347 — Backend custom-model RPC + NAPI surface"
    And its chips read "story", "done", "rust-frontend" and "8 pts" before the full record has loaded

  Scenario: The card's actions sit at the top of the drawer
    Given the drawer shows RPC-347 (done) and the drawer shows RPC-440 (backlog)
    When the drawer lists their actions
    Then RPC-347 offers "Open in agent" and "Close"
    And RPC-440 offers "Open in agent", "Move up", "Move down" and "Close"

  Scenario: The full record is laid out as formatted blocks
    Given RPC-347's record with a user story, 9 rules, 8 examples, 3 architecture notes, a deleted rule, depends-on RPC-346, 2 attachments and a status history
    When the drawer lays out the record
    Then the blocks are Description, User Story, Rules, Examples, Architecture Notes, Relationships, Attachments, History and Details, in that order
    And the user story reads "As a", "I want" and "So that" with the record's role, action and benefit
    And the rules are numbered 1 to 9 without the deleted rule
    And Relationships has a "Depends On" chip for RPC-346
    And History lists each status with its time

  Scenario: Questions show their answers and open questions are marked
    Given a record with an answered question "Support OAuth?" answered "Yes" and an open question "Which host?"
    When the drawer lays out the record
    Then the Questions block shows "Support OAuth?" with "Answer: Yes" and "Which host?" marked open

  Scenario: Event Storm items are grouped by kind
    Given a record whose event storm has two domain events and a hotspot
    When the drawer lays out the record
    Then the Event Storm block has "Domain Events" with 2 items and "Hotspots" with 1 item

  Scenario: Fields the drawer does not know are still shown
    Given a record with an unknown field "reviewNotes" of "looks good" and empty examples
    When the drawer lays out the record
    Then the Details block shows "Review Notes" with "looks good"
    And no Examples block is shown

  Scenario: The drawer's width follows the layout
    Given a board 400 wide on a compact layout and a board 1200 wide on a wide layout
    When the drawer sizes itself
    Then it is 352 wide on the compact board and 540 wide on the wide board
    And it is never wider than 480 when compact or outside 360 to 560 otherwise

  Scenario: Android content clears the navigation bar
    Given the platform is Android, then iOS, then web
    When the drawer and the board compute their bottom clearance
    Then the clearance is 48 on Android and 0 on iOS and web

  Scenario: Tapping a relationship shows that work unit and adds it to the history
    Given the drawer shows RPC-347 with a Depends On chip for RPC-346
    When the user taps the RPC-346 chip
    Then the drawer shows RPC-346
    And its back arrow is enabled and its forward arrow disabled

  Scenario: Back and forward step through the work units the drawer showed
    Given the drawer went from RPC-347 to RPC-440 to RPC-346 through relationship chips
    When the user goes back twice, then forward once, then taps a chip for RPC-300
    Then the drawer shows RPC-440, then RPC-347 with back disabled, then RPC-440
    And after RPC-300 the history is RPC-347, RPC-440, RPC-300 with forward disabled

  Scenario: Selecting a card on the board starts a new history
    Given the drawer shows RPC-346 after following chips from RPC-347
    When the user selects RPC-500 on the board
    Then the drawer shows RPC-500 with both arrows disabled
    And Close clears the selection

  Scenario: The board stays usable beside the drawer
    Given the board shows RPC-347 and RPC-440 with RPC-347's drawer open
    When the user selects RPC-440 on the board
    Then the drawer shows RPC-440
    And nothing dims or covers the board, and the drawer has no shadow

  Scenario: Attachments open in Paseo's file viewer
    Given the daemon workspace "/Users/me/fspec" and RPC-347's attachment "spec/attachments/RPC-347/ast-research notes.md"
    When the drawer lays out the attachment
    Then it is a Markdown link "ast-research notes.md" to "/Users/me/fspec/spec/attachments/RPC-347/ast-research notes.md"
    And the drawer renders it with the plugin Markdown component so Paseo opens the file
