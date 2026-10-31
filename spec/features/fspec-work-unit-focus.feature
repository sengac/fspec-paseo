@done
@core
@provider
@FSPEC-025
Feature: Show fspec work units in the Paseo timeline

  """
  server/session.ts publishes the focus todo (get_work_unit_focus idx 56, focusChanged events); server/transcript.ts adds work-unit metadata to tool cards.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. No (decided during implementation): WorkUnitsUpdate carries the entire board on every change and would flood the conversation; the session's focused work unit answers 'what is this agent working on'. The board stays in fspec.
  #   2. Each Paseo session shows one 'todo' timeline item (id '<epoch>:focus') for its focused work unit: one entry '<id> — <title>' with status in_progress, or completed when the work unit status is done; it is seeded on open from get_work_unit_focus (idx 56) and re-published on every SessionEvent focusChanged for that session; a cleared focus shows the entry 'No work unit in focus' as pending
  #   3. Every tool card whose input carries work_unit_id gets metadata { workUnitId }; an fspec tool card's label also ends with ' · <work unit>' unless it is NONE
  #
  # EXAMPLES:
  #   1. Open: get_work_unit_focus = { context: { id: 'BUG-285', title: 'sync-version flag', status: 'backlog' } } -> todo item [{ text: 'BUG-285 — sync-version flag', status: 'in_progress', completed: false }]
  #   2. /focus FSPEC-001 -> SessionEvent focusChanged { context: { id: 'FSPEC-001', title: 'Scaffold', status: 'done' } } -> the same todo id re-published with [{ text: 'FSPEC-001 — Scaffold', status: 'completed', completed: true }]
  #   3. Bash tool call with input { command: 'ls', work_unit_id: 'FSPEC-001' } -> tool_call metadata { workUnitId: 'FSPEC-001' }; fspec tool call with { command: 'show-work-unit', work_unit_id: 'FSPEC-001' } -> label 'fspec show-work-unit · FSPEC-001'
  #
  # QUESTIONS (ANSWERED):
  #   Q: Should the whole fspec board (WorkUnitsUpdate) be rendered in the Paseo timeline?
  #   A: No (decided during implementation): WorkUnitsUpdate carries the entire board on every change and would flood the conversation; the session's focused work unit answers 'what is this agent working on'. The board stays in fspec.
  #
  # ========================================

  Background: User Story
    As a Paseo user watching an fspec agent
    I want to see which work unit the agent is focused on and which work unit each tool call is charged to
    So that I can follow the agent's progress against the fspec board from Paseo

  Scenario: The focused work unit shows when the session opens
    Given get_work_unit_focus returns work unit "BUG-285" titled "sync-version flag" in status backlog
    When Paseo opens an fspec session
    Then the provider published a todo item "<epoch>:focus" with one in_progress entry "BUG-285 — sync-version flag"


  Scenario: A focus change updates the same item
    Given an open fspec session showing its focus item
    When the daemon reports a focusChanged session event to work unit "FSPEC-001" titled "Scaffold" in status done
    Then the provider re-published the same todo item with one completed entry "FSPEC-001 — Scaffold"
    And a cleared focus re-publishes it with the pending entry "No work unit in focus"


  Scenario: Tool cards show their work unit
    Given an fspec session with an active turn
    When the daemon streams a Bash call with work_unit_id "FSPEC-001" and an fspec show-work-unit call with work_unit_id "FSPEC-001"
    Then both tool cards carry metadata workUnitId "FSPEC-001"
    And the fspec card is labelled "fspec show-work-unit · FSPEC-001"

