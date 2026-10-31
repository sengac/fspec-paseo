@done
@core
@provider
@FSPEC-011
Feature: Queue overlapping prompts as ordered turns

  """
  server/session.ts per-session FIFO of turns; settle() finishes the head and starts the next; interrupt chunks cancel head plus queuedInputs.length.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. A prompt that arrives while a turn is running is sent to the daemon immediately and answered with session.prompt_result { type: 'turn', turnId } immediately, but its session.turn 'started' is deferred until every earlier turn has its terminal, so turns never interleave
  #   2. Each daemon terminal chunk (Done, Error, Interrupted, InterruptedWithReason) settles the oldest unsettled turn, after which the next queued turn emits 'started' and becomes the active turn for usage and stream rows
  #   3. Interrupted/InterruptedWithReason carrying N queued_inputs cancels the running turn and the next N queued turns, each emitting 'started' then 'canceled' in order, because the daemon dropped those inputs
  #   4. If sending a queued prompt to the daemon fails, that turn is failed with the send error when its turn comes (started then failed), keeping order
  #
  # EXAMPLES:
  #   1. Prompt 'a' (turn-1) is running; prompt 'b' arrives: events are prompt_result turn-1, started turn-1, prompt_result turn-2, and both send_input calls reach the daemon; Done -> completed turn-1 then started turn-2; Done -> completed turn-2
  #   2. turn-1 running, turn-2 queued; the user stops and the daemon sends InterruptedWithReason { queuedInputs: ['b'], reason: user }: canceled turn-1, started turn-2, canceled turn-2; a later Done emits no terminal
  #   3. turn-1 running; prompt 'b' is queued but its send_input fails with 'connection reset': when turn-1 completes, turn-2 emits started then failed with 'connection reset'
  #
  # ========================================

  Background: User Story
    As a Paseo user who sends a follow-up while fspec is still working
    I want to have each prompt become its own ordered turn
    So that no turn hangs forever and Paseo never sees two turns running at once

  Scenario: A follow-up prompt becomes the next turn without interleaving
    Given an open fspec session whose turn "turn-1" is running
    When Paseo sends a second prompt "b"
    Then the provider answered it with session.prompt_result turn "turn-2" and sent it to the daemon immediately
    And it emitted no session.turn started for "turn-2" while "turn-1" was running
    And a Done chunk emitted completed for "turn-1" then started for "turn-2", and the next Done emitted completed for "turn-2"


  Scenario: Stopping cancels the running turn and the inputs the daemon dropped
    Given an open fspec session with "turn-1" running and "turn-2" queued
    When the daemon sends InterruptedWithReason with queuedInputs ["b"]
    Then the provider emitted canceled for "turn-1", then started and canceled for "turn-2"
    And a later Done chunk emitted no further turn terminal


  Scenario: A queued prompt that cannot be sent fails in its turn
    Given an open fspec session whose turn "turn-1" is running
    When a second prompt is queued and its send_input fails with "connection reset"
    Then after "turn-1" completes, "turn-2" emits started and then failed with "connection reset"

