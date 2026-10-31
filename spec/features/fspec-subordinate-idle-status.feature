@done
@core
@provider
@FSPEC-030
Feature: Show idle fspec sub-agents as finished in Paseo

  """
  Paseo plugin-provider.ts attachChild upserts provider_subagent status running; acceptChildEvent maps only session.turn (started->running, else the state) and session.closed/runtime_failed to a status. server/session.ts handleChunk: for !session.owned, start a turn via the existing queue/advance path when activeTurnId is null and the queue is empty and the chunk is work.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. Paseo shows a provider child as running until it receives a session.turn terminal for it, so a sub-agent's own runs must be reported as provider turns
  #   2. When a child session has no started or queued turn and receives a work chunk (responseAttemptStarted, text, thinking, toolCall, toolResult, toolProgress, userInput, providerWaiting, or sessionStateChange running), the provider starts a turn for it (session.turn started, turnId turn-N) before publishing the chunk
  #   3. The daemon's done/error/interrupted chunk settles that turn completed/failed/canceled exactly as for a prompted turn, so the child shows idle (completed) once the sub-agent stops
  #   4. Chunks that are not work (tokenUpdate, contextFillUpdate, userNotification, sessionStateChange idle, ...) never start a turn, and owned (non-child) sessions keep starting turns only from Paseo prompts
  #   5. A Paseo prompt sent to a child while a supervisor-driven turn runs is queued behind it, as the daemon queues the input
  #
  # EXAMPLES:
  #   1. Child paseo-1:sub:sub-9 is adopted from a Text chunk 'working' -> session.opened, session.turn started turn-1, the assistant text, then a done chunk -> session.turn completed turn-1
  #   2. The supervisor messages idle sub-9 again: a userInput chunk starts turn-2 and the next done completes it
  #   3. A tokenUpdate chunk for idle child sub-9 starts no turn
  #   4. A Text chunk for owned session paseo-1 with no prompt starts no turn
  #
  # ========================================

  Background: User Story
    As a Paseo user whose fspec agent spawns sub-agents
    I want to see each sub-agent's child session go idle when it finishes its work
    So that I can tell which delegated work is still running

  Scenario: A sub-agent's run settles when it goes idle
    Given an open Paseo session "paseo-1" mapped to daemon session "fspec-sess-42"
    When the daemon streams a Text chunk "working" for sub-agent "sub-9" supervised by "fspec-sess-42", then a done chunk
    Then the child "paseo-1:sub:sub-9" received session.turn started "turn-1" before the assistant text
    And it received session.turn completed "turn-1" after it


  Scenario: Each new supervisor-driven run of an idle sub-agent is its own turn
    Given an open Paseo child session "paseo-1:sub:sub-9" whose turn "turn-1" completed
    When the daemon streams a userInput chunk and then a done chunk for "sub-9"
    Then the child received session.turn started "turn-2" and then session.turn completed "turn-2"


  Scenario: Non-work chunks do not mark an idle sub-agent running
    Given an open Paseo child session "paseo-1:sub:sub-9" whose turn "turn-1" completed
    When the daemon streams a tokenUpdate chunk for "sub-9"
    Then the child received no further session.turn


  Scenario: Owned sessions start turns only from Paseo prompts
    Given an open Paseo session "paseo-1" mapped to daemon session "fspec-sess-42"
    When the daemon streams a Text chunk "hello" for "fspec-sess-42" without a Paseo prompt
    Then the provider emitted no session.turn for "paseo-1"
