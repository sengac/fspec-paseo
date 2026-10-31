@done
@core
@provider
@FSPEC-031
Feature: Close fspec sub-agent sessions when their Paseo parent closes

  """
  server/wire.ts: add getSubordinates (66 sibling, idx 70) -> Vec<SessionId>, same shape as getSupervisors. server/session.ts: a destroyTree(daemonSessionId) helper used by close() and closeAll(). Supersedes FSPEC-021 rule 4's 'its daemon session is left to fspec' for the parent-close case; a removed sub-agent (SessionEvent removed) is still never destroyed.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. Before destroying an owned session the provider lists its subordinates with get_subordinates (idx 70), recursively, because fspec's destroy_session does not cascade and unlinks the chain of command
  #   2. A sub-agent is destroyed only when every one of its supervisors (get_supervisors idx 66) is the closing session or a sub-agent being destroyed; a sub-agent with any other supervisor is left running and its own sub-agents are not visited
  #   3. Sub-agents are destroyed deepest first, then the parent; a failed lookup or sub-agent destroy never stops the parent being destroyed and closed
  #   4. The Paseo child sessions of the closing parent still close with session.closed, as before
  #   5. closeAll (provider shutdown) applies the same sub-agent cleanup to every owned session
  #
  # EXAMPLES:
  #   1. Paseo closes paseo-1 (daemon fspec-sess-42) whose sub-agent sub-9 has sub-agent sub-10: destroy_session sub-10, then sub-9, then fspec-sess-42; child paseo-1:sub:sub-9 closes
  #   2. Sub-agent sub-9 is also supervised by TUI session tui-5: closing paseo-1 destroys only fspec-sess-42; sub-9 keeps running
  #   3. destroy_session for sub-9 fails: fspec-sess-42 is still destroyed and paseo-1 closes
  #   4. Provider shutdown with paseo-1 open destroys sub-9 and fspec-sess-42
  #
  # QUESTIONS (ANSWERED):
  #   Q: How deep should closing a parent close its sub-agents?
  #   A: The whole tree: sub-agents of sub-agents too
  #
  #   Q: What happens to a sub-agent also supervised by a session outside the closing tree?
  #   A: Leave it running; only its Paseo child view closes
  #
  #   Q: Should provider shutdown (closeAll) also destroy sub-agents?
  #   A: Yes, the same cleanup as closing each parent
  #
  # ========================================

  Background: User Story
    As a Paseo user whose fspec agent spawns sub-agents
    I want to have closing the agent also close the sub-agents it spawned
    So that no orphaned fspec sessions keep running after I close the agent

  Scenario: Closing a parent destroys its whole sub-agent tree
    Given an open Paseo session "paseo-1" mapped to daemon session "fspec-sess-42" with child "paseo-1:sub:sub-9"
    And daemon session "sub-9" is supervised by "fspec-sess-42" and supervises "sub-10"
    When Paseo closes "paseo-1"
    Then the provider sent destroy_session for "sub-10", then "sub-9", then "fspec-sess-42"
    And it emitted session.closed for "paseo-1:sub:sub-9" and "paseo-1"


  Scenario: A sub-agent shared with another supervisor is left running
    Given an open Paseo session "paseo-1" mapped to daemon session "fspec-sess-42"
    And daemon session "sub-9" is supervised by "fspec-sess-42" and "tui-5"
    When Paseo closes "paseo-1"
    Then the provider sent destroy_session only for "fspec-sess-42"


  Scenario: A failed sub-agent destroy does not stop the parent closing
    Given an open Paseo session "paseo-1" mapped to daemon session "fspec-sess-42"
    And daemon session "sub-9" is supervised by "fspec-sess-42" and its destroy_session fails
    When Paseo closes "paseo-1"
    Then the provider sent destroy_session for "fspec-sess-42" and emitted session.closed for "paseo-1"


  Scenario: Provider shutdown destroys sub-agents too
    Given an open Paseo session "paseo-1" mapped to daemon session "fspec-sess-42"
    And daemon session "sub-9" is supervised by "fspec-sess-42"
    When the provider shuts down
    Then the provider sent destroy_session for "sub-9" and "fspec-sess-42"
