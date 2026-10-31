@done
@kanban
@board
@FSPEC-036
Feature: Show full fspec work unit details from the Paseo board

  """
  server/wire.ts: getWorkUnitDetails 123 (request id: String; response Result<String, String>). shared/board.ts: detailsBoardRpc. server/board.ts: feed.details(). client/details-model.ts: projectDetails(record) port of fspec-tui components/board_card/{document,document_storm,labels}.rs. client/board-panel.tsx: details strip + Modal with the projected document.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. Selecting a card shows the TUI details strip for it: title, description (or 'No description'), attachments count, and 'Epic | Estimate | Status' from the board snapshot, without an RPC
  #   2. 'Show full details' calls plugin RPC fspec.board.details({ cwd, id }), which calls get_work_unit_details (idx 123, Result<String,String>) on the board's daemon connection, applies the workspace guard and answers { state: 'ready', id, workUnit } from the JSON envelope or { state: 'unavailable', reason }
  #   3. The full details render the TUI document projection: sections Overview (type, status, epic, estimate), Description, Example Mapping (userStory, rules, examples, questions, assumptions, architectureNotes), Event Storm, Relationships (parent, children, dependsOn, blocks, blockedBy, relatesTo), Attachments, History (stateHistory, statusHistory, blockedReason), Accounting (iterations, actualTokens), Timestamps (createdAt, updatedAt, updated), then Additional Fields for anything else; empty sections are omitted; keys are humanized (dependsOn -> Depends On)
  #   4. List entries with text read '• text', answered questions add ' → Answer: answer', deleted items add ' [deleted — historical]'; empty arrays read '(none)'
  #   5. Relationship ids are links: choosing one loads that work unit's full details in the same dialog
  #   6. Full details open in the host Modal: a bottom sheet on compact (mobile) layouts and a centered dialog on wide layouts
  #
  # EXAMPLES:
  #   1. Select FSPEC-001 (epic provider-plugin, 3 pts, backlog, 1 attachment) -> strip 'FSPEC-001 — Scaffold', description, 'Attachments: 1', 'Epic: provider-plugin | Estimate: 3 | Status: backlog'
  #   2. Record { id, title, type: 'story', status: 'done', rules: [{ id: 0, text: 'R1', deleted: false }, { id: 1, text: 'R0', deleted: true }], questions: [{ text: 'Q?', answer: 'Yes', selected: true }], dependsOn: ['FSPEC-001'], nextRuleId: 2 } -> Overview (Type: story, Status: done), Example Mapping (Rules: • R1 … / • R0 [deleted — historical]; Questions: • Q? → Answer: Yes), Relationships (Depends On: link FSPEC-001), Additional Fields (Next Rule Id: 2)
  #   3. fspec.board.details({ cwd: '/ws', id: 'NOPE-1' }) with the daemon answering Err('work unit NOPE-1 not found') -> { state: 'unavailable', reason: 'work unit NOPE-1 not found' }
  #
  # QUESTIONS (ANSWERED):
  #   Q: Should attachments open from the details?
  #   A: No: Paseo gives workspace panels no API to open a workspace file, and attachment viewing is the TUI's separate 'a' viewer, not part of the board; attachment paths are shown as selectable text (default chosen; user can overrule)
  #
  # ========================================

  Background: User Story
    As a Paseo user browsing the fspec board
    I want to see a selected card's details and open its full fspec record
    So that I can read a work unit's story, rules, examples, questions and relationships from Paseo like in the fspec TUI

  Scenario: Full details come from get_work_unit_details
    Given the daemon answers get_work_unit_details for "FSPEC-001" with its JSON envelope
    When the panel calls fspec.board.details for "FSPEC-001" in "/ws"
    Then it answers state ready with the work unit record
    And a daemon error "work unit NOPE-1 not found" answers state unavailable with that reason
