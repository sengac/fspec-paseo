@done
@core
@provider
@FSPEC-011
@FSPEC-051
Feature: Queue overlapping prompts as ordered turns

  """
  server/session.ts per-session FIFO of turns; settle() finishes the head and starts the next. Since FSPEC-051 a prompt sent while a turn runs is handed to fspec with submit_input Queue, and an interrupt cancels only the head: fspec keeps the queued inputs parked and runs them before the next prompt.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. A prompt that arrives while a turn is running is handed to the daemon immediately (submit_input Queue since FSPEC-051) and answered with session.prompt_result { type: 'turn', turnId } immediately, but its session.turn 'started' is deferred until every earlier turn has its terminal, so turns never interleave
  #   2. Each daemon terminal chunk (Done, Error, Interrupted, InterruptedWithReason) settles the oldest unsettled turn, after which the next queued turn emits 'started' and becomes the active turn for usage and stream rows
  #   3. Interrupted/InterruptedWithReason cancels the running turn only: fspec (RIG-016) keeps its queued_inputs parked, so their turns wait unstarted and run, in order, ahead of the next prompt (FSPEC-051)
  #   4. If sending a queued prompt to the daemon fails, that turn is failed with the send error when its turn comes (started then failed), keeping order
  #
  # EXAMPLES:
  #   1. Prompt 'a' (turn-1) is running; prompt 'b' arrives: events are prompt_result turn-1, started turn-1, prompt_result turn-2, and both send_input calls reach the daemon; Done -> completed turn-1 then started turn-2; Done -> completed turn-2
  #   2. turn-1 running, turn-2 queued; the user stops and the daemon sends InterruptedWithReason { queuedInputs: ['b'], reason: user }: canceled turn-1 only; a later Done emits no terminal; the next prompt 'c' is submitted with Queue and turn-2 then turn-3 run
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
    Then the provider answered it with session.prompt_result turn "turn-2" and handed it to the daemon immediately with submit_input Queue
    And it emitted no session.turn started for "turn-2" while "turn-1" was running
    And a Done chunk emitted completed for "turn-1" then started for "turn-2", and the next Done emitted completed for "turn-2"


  Scenario: Stopping cancels the running turn and keeps the queued prompts parked
    Given an open fspec session with "turn-1" running and "turn-2" queued
    When the daemon sends InterruptedWithReason with queuedInputs ["b"]
    Then the provider emitted canceled for "turn-1" and did not start "turn-2"
    And it showed a notice that the queued prompt "b" is waiting
    And a later Done chunk emitted no further turn event
    And the next prompt "c" was submitted with submit_input Queue and "turn-2" then "turn-3" ran in order


  Scenario: A queued prompt that cannot be sent fails in its turn
    Given an open fspec session whose turn "turn-1" is running
    When a second prompt is queued and its submit_input fails with "connection reset"
    Then after "turn-1" completes, "turn-2" emits started and then failed with "connection reset"

