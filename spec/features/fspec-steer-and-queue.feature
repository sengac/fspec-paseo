@done
@provider
@core
@FSPEC-051
Feature: Steer and queue prompts through fspec's submit_input

  """
  server/wire.ts submitInput 128 + InputMode table (rpc-types input_mode.rs). server/provider.ts capabilities += prompt.steer. server/session.ts: QueuedTurn gains text and parked; prompt() routes delivery steer / auto-while-busy / parked-resume; settle() watches for a steer overflow turn; handleChunk interrupts park the queue. Semantics: fspec rust/sessions/src/background_session/input_modes.rs submit_input (idle Queue resumes parked inputs ahead of it), rust/agent-loop/src/agent_loop/finalization.rs start_queued_input (an interrupted turn leaves the inbox parked), rust/cli/src/interactive/stream_loop/steer.rs (steer delivered at a safe boundary, no chunk), interrupted.rs (queued_inputs reported without draining). Matches the fspec TUI (agent-view-steer-and-queue-keys.feature): Enter steers and Alt+Enter queues while a turn runs; an idle Enter still sends a normal turn.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. submit_input (idx 128: session_id, text, mode InputMode Steer=0 | Queue=1 | Interrupt=2) answers Result<(), String>; an unknown session answers Err('Session not found: <id>')
  #   2. The provider advertises Paseo's prompt.steer capability
  #   3. A delivery 'steer' prompt while a turn runs is sent with submit_input Steer and answered with session.prompt_result { type: 'steer', turnId: <running turn> }; it starts no turn, and the daemon's immediate UserInput echo carries the prompt's clientMessageId
  #   4. A delivery 'steer' prompt with no running turn, or one the daemon rejects, is answered with session.prompt_result failed and starts no turn
  #   5. With clearPendingPermissions, the steer is submitted first and then the approval pause or stdin question blocking the turn is denied, so the turn can reach the point where fspec reads the steer
  #   6. A delivery 'auto' prompt while a turn runs is handed to fspec with submit_input Queue (fspec holds and orders it) and becomes the next turn, started only when every earlier turn settled; an idle session's prompt still uses send_input
  #   7. A steer the turn never reached starts as its own daemon turn after the turn completes, ahead of queued prompts (fspec continue_with_inbox): the provider runs it as an extra turn, recognised by the daemon's UserInput not matching the next queued prompt
  #   8. Interrupted/InterruptedWithReason cancels only the running turn: queued prompts stay parked in fspec (listed in queued_inputs), their turns are not started, and the provider shows a notice listing them; the next prompt is submitted with submit_input Queue so fspec runs the parked prompts first, each as its own turn, then the new one
  #
  # EXAMPLES:
  #   1. turn-1 running; Paseo steers 'use the staging database' -> submit_input(s, 'use the staging database', Steer); prompt_result { type: steer, turnId: turn-1 }; UserInput 'use the staging database' -> user_message with that clientMessageId; Done -> turn-1 completed
  #   2. turn-1 running, Paseo sends 'b' (auto) -> submit_input(s, 'b', Queue), prompt_result turn-2; Done -> turn-1 completed, turn-2 started
  #   3. turn-1 running, 'b' queued (turn-2); Stop -> InterruptedWithReason { queued_inputs: ['b'] } -> turn-1 canceled, turn-2 not started, notice '1 queued prompt is waiting'; Done -> nothing; Paseo sends 'c' -> submit_input(s, 'c', Queue), prompt_result turn-3, turn-2 started; Done -> turn-2 completed, turn-3 started
  #   4. turn-1 running, 'b' queued; steer 's' never reached; Done -> turn-1 completed; UserInput 's' -> turn-3 started (extra turn); Done -> turn-3 completed, turn-2 started
  #
  # ========================================

  Background: User Story
    As a Paseo user directing a busy fspec agent
    I want to steer the running turn or queue a follow-up, with fspec holding and ordering what I send
    So that I can correct the agent mid-turn and nothing I queued is lost when I stop it

  Scenario: submit_input matches the daemon's encoding
    Given the Rust golden vectors for submit_input arguments with modes Queue and Steer and its Ok reply
    When the codec encodes those requests and decodes the reply
    Then the request bytes after variant index 128 match the golden vectors exactly
    And the reply decodes to Ok

  Scenario: The provider advertises steering
    Given Paseo offers every provider capability
    When the provider connects and opens an fspec session
    Then the connection's and the session's capabilities include "prompt.steer"

  Scenario: A steered prompt joins the running turn
    Given an open fspec session whose turn "turn-1" is running
    When Paseo sends "use the staging database" with delivery steer
    Then the provider called submit_input with "use the staging database" and mode Steer
    And it answered session.prompt_result steer for "turn-1" and started no new turn
    And the daemon's UserInput "use the staging database" became a user_message carrying the prompt's clientMessageId

  Scenario: A steer with no running turn fails
    Given an open fspec session with no running turn
    When Paseo sends "hello" with delivery steer
    Then the provider answered session.prompt_result failed and called no submit_input

  Scenario: A steer the daemon rejects fails its prompt
    Given an open fspec session whose turn "turn-1" is running and whose submit_input answers "Session not found: fspec-sess-42"
    When Paseo sends "use the staging database" with delivery steer
    Then the provider answered session.prompt_result failed with "Session not found: fspec-sess-42"
    And "turn-1" is still running

  Scenario: A steer with clearPendingPermissions denies the pause blocking it
    Given an open fspec session whose running turn is paused on an approval shown in Paseo
    When Paseo sends "skip that command" with delivery steer and clearPendingPermissions
    Then the provider called submit_input with mode Steer before denying the pause through reply_interaction_checked
    And it emitted session.permission_resolved for the approval

  Scenario: A steer the running turn never reached runs as its own turn
    Given an open fspec session with "turn-1" running, prompt "b" queued as "turn-2" and a steer "s" sent during "turn-1"
    When the daemon completes "turn-1" and then echoes UserInput "s"
    Then the provider emitted completed for "turn-1" and started an extra turn "turn-3" for the steer
    And when that turn is done "turn-2" starts
