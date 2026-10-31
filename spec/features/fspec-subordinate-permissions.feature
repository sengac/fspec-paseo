@done
@core
@provider
@FSPEC-033
Feature: Answer fspec sub-agent approvals and questions from the parent agent in Paseo

  """
  Paseo plugin-provider.ts: acceptChildEvent handles only timeline.item, session.turn, session.closed/runtime_failed; translatePermission/respondToPermission are root-session only. server/session.ts: openPause, openStdin, resolvePause, resolveStdin emit on rootOf(session); permission() finds the session (root or descendant) whose pause/stdin permissionId matches.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. Paseo only shows permissions raised on a root session; a child's session.permission is dropped, so every sub-agent pause (approval or HITL) and stdin request is emitted on its top-level Paseo ancestor
  #   2. A sub-agent's request title is prefixed with the sub-agent's label (e.g. 'Sub-agent sub-9: Allow Bash?') so the user knows who is asking; the parent's own requests are unchanged
  #   3. Paseo answers on the root session; the provider routes the answer by permission id to the sub-agent that raised it and replies to that sub-agent's daemon session (reply_interaction_checked or write_exec_stdin)
  #   4. session.permission_resolved for a sub-agent's request is also emitted on the root, however it ends (answered, sub-agent resumed, sub-agent closed)
  #   5. Nested sub-agents route to the top-level owned session, not their direct parent
  #
  # EXAMPLES:
  #   1. Sub-agent sub-9 under paseo-1 pauses for Bash approval -> session.permission on paseo-1 titled 'Sub-agent sub-9: Allow Bash?'; the user allows it on paseo-1 -> reply_interaction_checked for daemon session sub-9
  #   2. Sub-agent sub-9 asks a HITL question 'Which branch?' -> it shows on paseo-1; the user answers 'main' -> the answer goes to sub-9
  #   3. Sub-agent sub-9's paused state clears (it resumed) -> session.permission_resolved on paseo-1
  #   4. sub-10 (sub-agent of sub-9, under paseo-1) pauses -> the request shows on paseo-1
  #
  # ========================================

  Background: User Story
    As a Paseo user whose fspec agent spawns sub-agents
    I want to approve and answer every sub-agent's approvals, questions and input prompts from the parent agent's thread
    So that sub-agents never hang waiting on a prompt I cannot see

  Scenario: A sub-agent's approval is shown and answered on the parent agent
    Given an open Paseo session "paseo-1" with sub-agent child "paseo-1:sub:sub-9"
    When sub-agent "sub-9" pauses for approval of Bash with snapshot request "p-7"
    Then the provider emitted session.permission on "paseo-1" titled "Sub-agent sub-9: Allow Bash?"
    And when Paseo allows it on "paseo-1" the provider called reply_interaction_checked for daemon session "sub-9" and request "p-7"
    And it emitted session.permission_resolved on "paseo-1"


  Scenario: A sub-agent's question is answered from the parent agent
    Given an open Paseo session "paseo-1" with sub-agent child "paseo-1:sub:sub-9"
    When sub-agent "sub-9" asks HITL question "Which branch?" with header "Branch" as snapshot request "h-2"
    Then the provider emitted session.permission on "paseo-1" titled "Sub-agent sub-9: Branch"
    And when Paseo answers "main" on "paseo-1" the provider called reply_interaction_checked for daemon session "sub-9" and request "h-2"


  Scenario: A sub-agent's input prompt is answered from the parent agent
    Given an open Paseo session "paseo-1" with sub-agent child "paseo-1:sub:sub-9"
    When sub-agent "sub-9" streams an exec stdin request for "python3 -c input()"
    Then the provider emitted session.permission on "paseo-1" titled "Sub-agent sub-9: Input for python3 -c input()"
    And when Paseo answers "hello" on "paseo-1" the provider called write_exec_stdin for daemon session "sub-9" with "hello"


  Scenario: A sub-agent's request resolves on the parent when the sub-agent resumes
    Given sub-agent "sub-9" of "paseo-1" has an approval request shown on "paseo-1"
    When the daemon reports "sub-9" running again
    Then the provider emitted session.permission_resolved on "paseo-1" for that request


  Scenario: A nested sub-agent's request shows on the top-level agent
    Given an open Paseo session "paseo-1" with sub-agent "sub-9" whose own sub-agent "sub-10" is open as a child
    When sub-agent "sub-10" pauses for approval of Bash
    Then the provider emitted session.permission on "paseo-1" titled "Sub-agent sub-10: Allow Bash?"
