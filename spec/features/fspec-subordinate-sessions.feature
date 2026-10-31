@done
@core
@provider
@FSPEC-021
Feature: Show fspec subordinate agents as Paseo child sessions

  """
  server/session.ts maps subordinates (get_supervisors idx 66) to Paseo child sessions; provider.ts routes sessionEvent envelopes.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. The first stream chunk for a daemon session the provider has not mapped triggers one get_supervisors (idx 66) lookup; when a supervisor is an open Paseo session the provider opens a Paseo child session for it, otherwise the daemon session is remembered as foreign and its chunks are ignored
  #   2. A child opens with session.opened { sessionId: '<parent>:sub:<daemon id>', parentSessionId: the parent's Paseo id, restoration: 'parent', capabilities, cwd, title: the subordinate's role/name when known, toolCallId: the parent's tool call whose result mentions the subordinate id when there is one } followed by session.config
  #   3. Chunks that arrive while the supervisor lookup is pending are buffered and published to the child in order once it opens, so no subordinate output is lost
  #   4. A child is a full registry session bound to the existing subordinate daemon session: prompts, interrupts, permissions and stdin work as for any session, but the provider never creates, resumes or destroys the subordinate itself
  #   5. When the daemon reports the subordinate removed (SessionEvent removed) or the parent closes, the child is closed with session.closed; a removed subordinate is left to fspec, while a parent close destroys it too (see fspec-subordinate-close.feature, FSPEC-031)
  #
  # EXAMPLES:
  #   1. Parent paseo-1 (daemon fspec-sess-42) calls AgentManager spawn; its ToolResult content mentions 'sub-9'; the first Text chunk for 'sub-9' -> get_supervisors('sub-9') = ['fspec-sess-42'] -> session.opened { sessionId: 'paseo-1:sub:sub-9', parentSessionId: 'paseo-1', restoration: 'parent', toolCallId: the spawn call id }, then the buffered Text is published to the child
  #   2. A chunk for daemon session 'tui-5' driven by the fspec TUI: get_supervisors('tui-5') = [] -> ignored, and later chunks for 'tui-5' cause no further lookups
  #   3. The daemon emits SessionEvent removed for 'sub-9' -> session.closed for 'paseo-1:sub:sub-9'; no destroy_session is sent
  #
  # ========================================

  Background: User Story
    As a Paseo user whose fspec agent spawns sub-agents
    I want to see each sub-agent as a child session under the agent that spawned it
    So that I can follow and steer delegated work instead of it happening invisibly

  Scenario: A spawned sub-agent opens as a Paseo child session
    Given Paseo session "paseo-1" mapped to daemon session "fspec-sess-42" whose AgentManager tool call "call-9" returned a result mentioning "sub-9"
    When the daemon streams a Text chunk "working" for daemon session "sub-9" whose supervisor is "fspec-sess-42"
    Then the provider emitted session.opened for "paseo-1:sub:sub-9" with parentSessionId "paseo-1", restoration parent and toolCallId "call-9", followed by session.config
    And it published the buffered text "working" as an assistant_message in the child session


  Scenario: Sessions driven by other clients are ignored
    Given an open Paseo session "paseo-1"
    When the daemon streams two chunks for daemon session "tui-5" whose supervisors are empty
    Then the provider called get_supervisors once for "tui-5" and emitted no event for it


  Scenario: A child session can be prompted
    Given an open Paseo child session "paseo-1:sub:sub-9" for daemon session "sub-9"
    When Paseo prompts the child with "status?"
    Then the provider sent send_input("sub-9", "status?") and never created or destroyed a daemon session for the child


  Scenario: A removed sub-agent closes its child session
    Given an open Paseo child session "paseo-1:sub:sub-9" for daemon session "sub-9"
    When the daemon reports session event removed for "sub-9"
    Then the provider emitted session.closed for "paseo-1:sub:sub-9" and sent no destroy_session

