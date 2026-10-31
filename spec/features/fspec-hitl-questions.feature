@done
@core
@provider
@FSPEC-017
Feature: Answer fspec HITL questions from Paseo

  """
  server/wire.ts getHitlRequest/sendHitlResponse (idx 81/79); server/session.ts openPause falls back to get_hitl_request and permission() answers via send_hitl_response.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. On SessionStateChange Paused the provider checks get_pause_state first and, when it is None, get_hitl_request (idx 81); a HITL request becomes one session.permission { kind: 'question', name: 'question', title: the first question's header, input: { questions } }
  #   2. Each fspec question maps to a Paseo question { header: the fspec header (or its id when empty), question, options: [{ label, description }], multiSelect: false, allowOther: true, allowEmpty: false } because fspec accepts free text on every question
  #   3. An allow answer carries updatedInput.answers keyed by header; for each question an answer equal to option labels (comma-separated) becomes selected labels with other null, any other text becomes other with no selected labels, and a question with no answer becomes selected [] / other null; the provider sends send_hitl_response(cancelled false) with one answer per question in fspec order
  #   4. A deny answer (Paseo Dismiss) sends send_hitl_response with cancelled true and no answers
  #   5. HITL requests share the approval-pause lifecycle: exactly one session.permission_resolved per request, also when the pause ends another way, and late answers are ignored
  #
  # EXAMPLES:
  #   1. fspec asks [{id: 'q1', header: 'Env', question: 'Which environment?', options: [dev (local), prod (live)]}]; Paseo shows a question card; the user picks 'dev' -> send_hitl_response(session, { cancelled: false, answers: [{ id: 'q1', selected: ['dev'], other: null }] })
  #   2. The user types 'staging' instead of choosing an option -> answers: [{ id: 'q1', selected: [], other: 'staging' }]
  #   3. The user dismisses the card -> send_hitl_response(session, { cancelled: true, answers: [] }) and session.permission_resolved
  #
  # ========================================

  Background: User Story
    As a Paseo user running an fspec agent
    I want to answer the questions the agent asks me inside Paseo's question card
    So that the agent gets my answer and continues instead of hanging

  Scenario: A HITL pause becomes a Paseo question
    Given an fspec session whose running turn pauses for a HITL question
    When the interaction snapshot holds HITL question "q1" with header "Env", question "Which environment?" and options "dev" (local) and "prod" (live)
    Then the provider emitted one session.permission with kind question and input questions [{ header "Env", question "Which environment?", options dev and prod, multiSelect false, allowOther true }]


  Scenario: Choosing an option answers the question
    Given an open Paseo question for HITL question "q1" with header "Env"
    When Paseo answers with updatedInput answers { "Env": "dev" }
    Then the provider answered with send_hitl_response through reply_interaction_checked with cancelled false and answers [{ id "q1", selected ["dev"], other null }]
    And it emitted session.permission_resolved for the question


  Scenario: Free text answers the question as other
    Given an open Paseo question for HITL question "q1" with header "Env"
    When Paseo answers with updatedInput answers { "Env": "staging" }
    Then the provider answered with send_hitl_response through reply_interaction_checked with answers [{ id "q1", selected [], other "staging" }]


  Scenario: Dismissing the question cancels it
    Given an open Paseo question for HITL question "q1"
    When Paseo answers with behavior deny
    Then the provider answered with send_hitl_response through reply_interaction_checked with cancelled true and no answers and emitted session.permission_resolved


  Scenario: HITL RPCs match the daemon's encoding
    Given Rust golden vectors for Option<HitlRequest> and the send_hitl_response arguments
    When the codec encodes and decodes those values
    Then the bytes match the golden vectors exactly

