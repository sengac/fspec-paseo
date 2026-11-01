@done
@core
@provider
@FSPEC-018
@FSPEC-068
Feature: Answer fspec interactions with the request-bound interaction API
  """
  server/interactions.ts parses snapshots and maps answers; session.ts uses get_interaction_snapshot (119) and reply_interaction_checked (120).
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. On SessionStateChange Paused the provider reads get_interaction_snapshot (idx 119, Result<String JSON, String>) instead of get_pause_state / get_hitl_request (since FSPEC-050 get_pause_state is read only for the gated tool call's id, which the snapshot lacks); the JSON is { pause: { request_id, state: { kind, tool_name, message, details } | null }, hitl: { request_id, state: { questions: [{ id, header, question, options: [{label, description}] | null }] } | null } }
  #   2. Every answer goes through reply_interaction_checked (idx 120: session_id, method, request_id, arguments JSON): Triple -> method pause_triple { choice: Approve | ApproveSession | Deny }; Confirm -> pause_confirm { accept }; Continue -> pause_resume {}; HITL -> send_hitl_response { response: { cancelled, answers: [{ id, selected, other }] } }, always with the request_id from the snapshot the request was built from
  #   3. The approval request uses the snapshot's separate fields: name = tool_name, description = message (plus details when present), detail = the tool call get_pause_state's tool_call_id names (FSPEC-059: none when it names no known call)
  #   4. Continue pauses (fspec PauseKind::Continue) show a single Continue action; any answer resumes them with pause_resume
  #   5. When reply_interaction_checked fails (the daemon's request moved on), the shown request is resolved and the snapshot is read again so the current interaction is shown instead
  #   6. FSPEC-068: the snapshot is decoded strictly: pause and hitl objects with a string request_id and a state that is null or the exact shape; pause kind Continue|Confirm|Triple; options null or a list; a HITL request without questions is an error; a snapshot that does not decode shows the FSPEC-059 pause-unreadable error notice
  #   7. FSPEC-068: an allowed HITL answer needs an answers object, and an approval answer whose selectedActionId is not one of the request's actions is an error — the answer is never guessed from its behavior
  #   8. FSPEC-068: a permission answer the provider cannot apply has no request to fail: it is logged and shown as an error session.notice 'fspec could not apply your answer' with the reason
  #
  # EXAMPLES:
  #   1. Snapshot pause { request_id: 'p-7', state: { kind: 'Triple', tool_name: 'Bash', message: 'RLCD security: P(risk)=0.46 >= promptThreshold 0.45', details: 'An AI coding agent is about to run ...' } } -> permission name 'Bash'; Approve for session -> reply_interaction_checked(session, 'pause_triple', 'p-7', '{"choice":"ApproveSession"}')
  #   2. Snapshot hitl { request_id: 'h-2', state: { questions: [{ id: 'q1', header: 'Env', question: 'Which?', options: [dev, prod] }] } } -> question card; answer dev -> reply_interaction_checked(session, 'send_hitl_response', 'h-2', '{"response":{"cancelled":false,"answers":[{"id":"q1","selected":["dev"],"other":null}]}}')
  #   3. The user approves request p-7 but the daemon already replaced it with p-8: reply returns Err -> permission_resolved for p-7, snapshot read again, new permission for p-8
  #   4. Live daemon 0.10.9: get_interaction_snapshot on an idle session returns {"pause":{"request_id":"","state":null},"hitl":{"request_id":"","state":null}}; an unknown session returns Err('Session unavailable')
  #
  # ========================================
  Background: User Story
    As a Paseo user approving or answering an fspec agent
    I want to have my answer applied only to the exact approval or question Paseo showed me
    So that a late or stale click can never approve a different, newer tool call

  Scenario: A paused session is read from the interaction snapshot
    Given an fspec session whose running Bash tool call pauses
    When get_interaction_snapshot returns pause request "p-7" with kind Triple, tool_name "Bash", message "RLCD security: P(risk)=0.46" and details "about to run ps"
    Then the provider emitted one session.permission named "Bash" whose description holds the message and the details
    And it read get_pause_state only for the gated tool call's id and never called get_hitl_request

  Scenario: An approval is answered against its request id
    Given a permission request built from snapshot pause request "p-7" of kind Triple
    When Paseo answers it with selectedActionId "approve_session"
    Then the provider called reply_interaction_checked(session, "pause_triple", "p-7", {"choice":"ApproveSession"}) and emitted session.permission_resolved

  Scenario: A continue pause resumes with pause_resume
    Given a snapshot pause request "p-9" of kind Continue
    When Paseo answers its single Continue action
    Then the provider called reply_interaction_checked(session, "pause_resume", "p-9", {})

  Scenario: A HITL question is answered against its request id
    Given a snapshot hitl request "h-2" asking question "q1" with header "Env" and options dev and prod
    When Paseo answers with answers { "Env": "dev" }
    Then the provider called reply_interaction_checked(session, "send_hitl_response", "h-2", {"response":{"cancelled":false,"answers":[{"id":"q1","selected":["dev"],"other":null}]}})

  Scenario: A stale answer is not applied to a newer request
    Given a permission request for snapshot pause request "p-7" while the daemon has moved on to pause request "p-8"
    When Paseo approves the request for "p-7" and reply_interaction_checked rejects it
    Then the provider resolved the request for "p-7", read the snapshot again and emitted a new permission request for "p-8"

  Scenario: A malformed interaction snapshot is shown as unreadable
    Given a paused session whose interaction snapshot pause state has message 7
    When the provider reads the snapshot
    Then the session shows the error notice "fspec paused this session but the pause could not be read" naming "interaction snapshot pause.state.message is not a string"
    And no permission request is emitted

  Scenario: Answers that do not fit the request are refused
    Given a Triple approval request and a HITL question request
    When Paseo answers the approval with action "maybe" and allows the question without an answers object
    Then mapping the approval fails with "unknown fspec approval action maybe"
    And mapping the question fails with "the answer to the fspec question carries no answers"

  Scenario: An answer the provider cannot apply is shown on the session
    Given a permission request for a Triple approval
    When Paseo answers it with action "maybe"
    Then the session shows the error notice "fspec could not apply your answer" naming "unknown fspec approval action maybe"
    And the approval is not resolved and no reply was sent

  Scenario: Interaction RPCs match the live daemon
    Given the reply bytes the live fspec 0.10.9 daemon returned for get_interaction_snapshot on an idle session
    When the codec decodes them and encodes a reply_interaction_checked request
    Then the snapshot decodes to the idle pause and hitl JSON and the request carries method index 120 with the four string arguments
