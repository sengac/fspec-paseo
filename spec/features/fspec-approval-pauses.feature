@done
@core
@provider
@FSPEC-016
Feature: Surface fspec tool approval pauses as Paseo permission requests

  """
  server/wire.ts getPauseState/pauseConfirm/pauseTriple (idx 80/77/78); server/session.ts turns live Paused into session.permission and answers via pause RPCs; provider.ts advertises 'permission' and routes session.permission.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. The provider advertises the Paseo 'permission' capability and, when a session's stream reports SessionStateChange Paused, reads get_pause_state (idx 80); a None result emits nothing
  #   2. A pause becomes one session.permission { kind: 'tool', name: the paused tool's name, title, description: fspec's pause prompt, detail: the tool call's detail } with a stable id per pause
  #   3. Triple pauses offer three actions: Approve (allow, primary), Approve for session (allow, secondary), Deny (deny, danger); Confirm pauses offer Accept (allow, primary) and Deny (deny, danger)
  #   4. A session.permission answer maps to pause_triple (Approve / ApproveSession / Deny) or pause_confirm (accept true / false); without selectedActionId, allow maps to Approve/accept and deny to Deny/reject
  #   5. Each pause gets exactly one session.permission_resolved: after the answer is applied, or when the pause ends another way (state leaves Paused, the turn ends, the session closes or the daemon connection drops)
  #   6. A session.permission for an unknown session is rejected synchronously with Unknown session; an answer for a pause that already resolved is ignored
  #
  # EXAMPLES:
  #   1. Live: Bash 'ps -axo pid,etime,comm | grep -i system_profiler' -> Paused; get_pause_state = Triple 'Bash: RLCD security: P(risk)=0.46282515 >= promptThreshold 0.45 ...' -> Paseo shows Approve / Approve for session / Deny with the shell command; choosing Approve calls pause_triple(session, Approve) and the tool runs and streams its output
  #   2. Confirm pause 'Allow writing outside the workspace?' -> actions accept/deny; the user denies -> pause_confirm(session, false), then session.permission_resolved
  #   3. The user presses Stop while a pause is open -> the daemon reports Interrupted -> the provider emits session.permission_resolved for that pause before the canceled turn event
  #
  # ========================================

  Background: User Story
    As a Paseo user running an fspec agent
    I want to approve or deny the tool calls fspec pauses on, right in Paseo
    So that gated commands run (or are refused) instead of the agent hanging until I interrupt it

  Scenario: A paused tool call becomes a Paseo permission request
    Given an fspec session whose turn is running Bash tool call "call-1" with command "ps -axo pid"
    When the daemon reports SessionStateChange Paused and the interaction snapshot holds a Triple pause with tool_name "Bash", message "RLCD security: P(risk)=0.46 >= promptThreshold 0.45" and details "An AI coding agent is about to run this shell command"
    Then the provider emitted one session.permission with kind tool, name "Bash", a description holding the message and the details, and shell detail "ps -axo pid" from the running tool call
    And its actions are Approve (allow), Approve for session (allow) and Deny (deny)


  Scenario: Approving a paused tool resumes it
    Given an open permission request for a Triple pause
    When Paseo answers it with selectedActionId "approve_session"
    Then the provider answered the pause with pause_triple ApproveSession through reply_interaction_checked and then emitted session.permission_resolved for that request


  Scenario: Denying a confirm pause rejects it
    Given an open permission request for a Confirm pause "Allow writing outside the workspace?" with actions accept and deny
    When Paseo answers it with behavior deny
    Then the provider answered the pause with pause_confirm accept false through reply_interaction_checked and emitted session.permission_resolved


  Scenario: Stopping the turn resolves an open pause
    Given an open permission request for a paused tool call
    When the daemon reports Interrupted for the session
    Then the provider emitted session.permission_resolved for the request before the canceled turn event
    And a later answer for that request calls no pause RPC


  Scenario: Pause RPCs match the daemon's encoding
    Given Rust golden vectors for Option<PauseState> and the pause_confirm and pause_triple arguments
    When the codec encodes and decodes those values
    Then the bytes match the golden vectors exactly


  Scenario: A permission answer for an unknown session is rejected
    Given a sessionId the provider never opened
    When Paseo sends a session.permission for it
    Then the input is rejected synchronously with Unknown session

