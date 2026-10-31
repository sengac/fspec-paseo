@done
@core
@provider
@FSPEC-023
Feature: Offer fspec session commands in the Paseo composer

  """
  server/commands.ts parses commands; session.ts publishes session.commands and runs commands via idx 40-43, 51, 52, 57.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. The provider advertises 'prompt.command' and publishes session.commands right after session.config on every open: compact, clear, continue [on|off|N], goal [text|clear|verify <cmd>], focus <work-unit-id|none>
  #   2. A command prompt runs without starting a turn and is answered with exactly one session.prompt_result: completed (plus an info session.notice describing the outcome) or failed with the reason
  #   3. compact calls compact_session (idx 52) and reports original -> compacted tokens; clear calls clear_history (51)
  #   4. continue mirrors the fspec TUI: no argument toggles (turning on uses budget 10), on = budget 10, off disables, N > 0 sets the budget and enables, 0 or other text is rejected, and off is refused while a goal is active; it reads get_continue_state (41) / get_goal_state (43) and writes set_continue_state (40)
  #   5. goal with no argument shows the current goal; text sets it (no verify command); clear removes it; 'verify <cmd>' keeps the goal text and sets its verification command; it writes set_goal_state (42)
  #   6. focus <id> calls set_work_unit_focus (57) with that id and source 'paseo'; 'focus none' clears it, so the agent attributes tool calls (required work_unit_id) to the focused work unit
  #   7. An unknown command name is answered with prompt_result failed 'Unknown fspec command /<name>'
  #
  # EXAMPLES:
  #   1. /compact -> compact_session returns 90000 -> 30000 tokens -> prompt_result completed and notice 'Compacted 90000 -> 30000 tokens'
  #   2. /continue 25 -> set_continue_state(session, true, 25); /continue off while goal 'ship' is active -> prompt_result failed 'auto-continue: a goal is active — clear the goal first (/goal clear)'
  #   3. /goal ship -> set_goal_state(session, Some(('ship', None))); then /goal verify npm test -> set_goal_state(session, Some(('ship', Some('npm test'))))
  #   4. /focus FSPEC-001 -> set_work_unit_focus(session, Some('FSPEC-001'), 'paseo'); /focus none -> set_work_unit_focus(session, None, 'paseo')
  #
  # ========================================

  Background: User Story
    As a Paseo user driving an fspec agent
    I want to use fspec's session commands (/compact, /clear, /continue, /goal, /focus) from Paseo's composer
    So that I can manage context, autonomy, goals and the work unit without switching to the fspec TUI

  Scenario: Opening a session publishes the fspec commands
    Given the fspec daemon is reachable
    When Paseo opens an fspec session
    Then the provider published session.commands with compact, clear, continue, goal and focus after session.config and before session.ready


  Scenario: Compact reports the token savings without a turn
    Given an open fspec session
    When Paseo sends the command /compact
    Then the provider called compact_session, answered prompt_result completed and published a notice "Compacted 90000 -> 30000 tokens"
    And no session.turn was emitted


  Scenario: Continue mirrors the fspec TUI
    Given an open fspec session without a goal
    When Paseo sends /continue 25
    Then the provider called set_continue_state(session, true, 25) and answered completed
    And with goal "ship" active, /continue off is answered failed "auto-continue: a goal is active — clear the goal first (/goal clear)"


  Scenario: Goal sets, verifies and clears the session goal
    Given an open fspec session
    When Paseo sends /goal ship, then /goal verify npm test, then /goal clear
    Then the provider called set_goal_state with ("ship", none), then ("ship", "npm test"), then none


  Scenario: Focus sets the work unit the agent works on
    Given an open fspec session
    When Paseo sends /focus FSPEC-001 and then /focus none
    Then the provider called set_work_unit_focus(session, "FSPEC-001", "paseo") and then set_work_unit_focus(session, none, "paseo")


  Scenario: Clear and unknown commands
    Given an open fspec session
    When Paseo sends /clear and then /bogus
    Then the provider called clear_history and answered completed for /clear
    And it answered /bogus with prompt_result failed "Unknown fspec command /bogus"


  Scenario: Command RPCs match the daemon's encoding
    Given bincode golden vectors for the continue, goal and focus arguments and replies
    When the codec encodes the requests and decodes the replies
    Then the bytes match the golden vectors

