@done
@core
@provider
@FSPEC-029
Feature: Keep Paseo agents and fspec agent tabs in sync

  """
  server/session.ts marks sessions active (idx 62), clears a child's mark when it still holds it (63/64), and closes Paseo sessions that fspec removed.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. When a Paseo session opens (new or resumed) the provider calls set_active_session (idx 62) with its daemon session, and again whenever that session is prompted, so fspec's board shows the session Paseo is driving as live, like the fspec TUI does on create/attach/cycle
  #   2. Closing an owned Paseo session needs no extra call: destroy_session already clears fspec's active pointer when it pointed at that session (fspec BUG-206); closing a sub-agent child calls clear_active_session (idx 63) only when get_active_session (idx 64) still names that child's daemon session, so another client's choice is never clobbered
  #   3. When fspec removes a daemon session that backs an open Paseo session (SessionEvent removed), the Paseo session closes with session.closed, its open requests resolve, and no destroy_session is sent
  #   4. A failing active-session call never fails the open, prompt or close it accompanies
  #
  # EXAMPLES:
  #   1. Paseo opens paseo-1 -> create_session = fspec-sess-42 -> set_active_session(fspec-sess-42); the fspec board shows that agent as live
  #   2. The user closes the agent tab in the fspec TUI -> SessionEvent removed for fspec-sess-42 -> Paseo gets session.closed for paseo-1
  #   3. Two Paseo agents are open; the user prompts the second -> set_active_session(its daemon id), so the board follows the agent being driven
  #
  # ========================================

  Background: User Story
    As a user running fspec agents from Paseo and the fspec TUI
    I want to see the same agents open on both sides
    So that the fspec board shows the Paseo agent as live and closing on either side closes it on the other

  Scenario: Opening a Paseo agent marks it active in fspec
    Given the fspec daemon is reachable
    When Paseo opens session "paseo-1" and the daemon creates "fspec-sess-42"
    Then the provider called set_active_session("fspec-sess-42")


  Scenario: Prompting a Paseo agent makes it the active one
    Given Paseo sessions "paseo-1" ("fspec-sess-42") and "paseo-2" ("fspec-sess-43") are open
    When Paseo prompts "paseo-1"
    Then the provider's latest set_active_session call names "fspec-sess-42"


  Scenario: Closing the agent in fspec closes it in Paseo
    Given an open Paseo session "paseo-1" backed by "fspec-sess-42"
    When the daemon reports session event removed for "fspec-sess-42"
    Then the provider emitted session.closed for "paseo-1" and sent no destroy_session
    And a later prompt to "paseo-1" is rejected with Unknown session


  Scenario: Closing a sub-agent clears only its own active mark
    Given an open sub-agent child for daemon session "sub-9"
    When the daemon removes "sub-9" while get_active_session names "sub-9"
    Then the provider called clear_active_session
    And when get_active_session names another session the provider does not call clear_active_session


  Scenario: A failing active-session call does not fail the open
    Given set_active_session fails on the daemon
    When Paseo opens session "paseo-1"
    Then the open still reaches session.ready

