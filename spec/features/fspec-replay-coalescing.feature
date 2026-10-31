@done
@core
@provider
@FSPEC-013
Feature: Replay history as one final snapshot per item

  """
  server/session.ts replay() coalesces folded items by id (first timestamp, last snapshot) and emits them once before session.ready; live publish() unchanged.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. Replay publishes each timeline item exactly once, carrying its final folded snapshot (full text, final tool status/output, completed compaction)
  #   2. Replayed items keep their order of first appearance and the timestamp of the transcript entry that first produced them
  #   3. The live stream is unchanged: it still publishes every delta snapshot so Paseo can stream text as it arrives
  #
  # EXAMPLES:
  #   1. Transcript entries Thinking 'plan', Thinking 'ning', Text 'ok', Done replay as exactly two timeline.item events: reasoning 'planning' then assistant_message 'ok'
  #   2. Transcript ToolCall call-1 (Bash ls) at t0, ToolProgress 'a' at t1, ToolResult 'a b' at t2 replay as one tool_call event with status completed and output 'a b', timestamped t0
  #
  # ========================================

  Background: User Story
    As a Paseo user reopening a long fspec conversation
    I want to have the history replay quickly
    So that reopen is fast and does not flood Paseo with intermediate text fragments

  Scenario: Replayed text is published once with its final content
    Given a resumed fspec session whose transcript holds Thinking "plan", Thinking "ning", Text "ok" and Done
    When Paseo reopens it with history "replay"
    Then the provider published exactly two timeline items before session.ready: reasoning "planning" then assistant_message "ok"


  Scenario: A replayed tool call is published once in its final state
    Given a resumed fspec session whose transcript holds a Bash ToolCall "call-1" at t0, ToolProgress "a" at t1 and ToolResult "a b" at t2
    When Paseo reopens it with history "replay"
    Then the provider published one tool_call "tool:call-1" with status completed and output "a b" timestamped t0


  Scenario: The live stream still publishes every delta
    Given an open fspec session with an active Paseo turn
    When the daemon streams Text "Hel" then Text "lo"
    Then the provider published assistant_message snapshots "Hel" and "Hello"

