@done
@core
@provider
@FSPEC-020
Feature: Render fspec tool calls clearly and never answer FspecCommandRequest

  """
  server/transcript.ts toolItem() renders the fspec tool with plain_text detail; chunks 20/21 stay display-only.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. No. rust/agent-loop/src/agent_loop/handlers.rs creates the fspec handler with use_callback = is_global_chunk_callback_registered(), which is always false in the Rust daemon (rust/agent-loop/src/lib.rs:104), so fspec_handler.rs runs codelet_fspec_core::dispatch_command itself. Live check (list-prefixes): the agent's call streams as an ordinary ToolCall/ToolResult named 'fspec' with input {command, work_unit_id}; no client reply is needed.
  #   2. A tool call named 'fspec' renders with plain_text detail: label 'fspec <command>' (plus the JSON args other than work_unit_id when present), icon 'wrench', and text = the accumulated output / result content
  #   3. FspecCommandRequest (chunk 20) and FspecCommandResult (21) are display mirrors in daemon mode: the provider renders nothing extra for them and never calls send_fspec_result
  #
  # EXAMPLES:
  #   1. Live: ToolCall { name: 'fspec', input: '{"command":"list-prefixes","work_unit_id":"NONE"}' } then ToolResult content 'Prefixes (91) ...' -> card label 'fspec list-prefixes', text 'Prefixes (91) ...', status completed
  #   2. ToolCall fspec with input {command: 'show-work-unit', args: {id: 'FSPEC-001'}, work_unit_id: 'NONE'} -> label 'fspec show-work-unit {"id":"FSPEC-001"}'
  #
  # QUESTIONS (ANSWERED):
  #   Q: Does a daemon-mode session wait for the client to answer FspecCommandRequest?
  #   A: No. rust/agent-loop/src/agent_loop/handlers.rs creates the fspec handler with use_callback = is_global_chunk_callback_registered(), which is always false in the Rust daemon (rust/agent-loop/src/lib.rs:104), so fspec_handler.rs runs codelet_fspec_core::dispatch_command itself. Live check (list-prefixes): the agent's call streams as an ordinary ToolCall/ToolResult named 'fspec' with input {command, work_unit_id}; no client reply is needed.
  #
  # ========================================

  Background: User Story
    As a Paseo user watching an fspec agent use its fspec tool
    I want to see each fspec command and its output as a readable card
    So that I can follow the agent's spec work without decoding raw JSON, and nothing waits on Paseo

  Scenario: An fspec tool call renders as a readable card
    Given an fspec session with an active turn
    When the daemon streams ToolCall "fspec" with input {"command":"list-prefixes","work_unit_id":"NONE"} and its ToolResult "Prefixes (91)"
    Then the provider published tool_call with plain_text detail labelled "fspec list-prefixes" and text "Prefixes (91)" and status completed


  Scenario: fspec command arguments appear in the label
    Given an fspec session with an active turn
    When the daemon streams ToolCall "fspec" with input {"command":"show-work-unit","args":{"id":"FSPEC-001"},"work_unit_id":"NONE"}
    Then the card label is "fspec show-work-unit {\"args\":{\"id\":\"FSPEC-001\"}}"


  Scenario: FspecCommandRequest is never answered
    Given an fspec session with an active turn
    When the daemon streams FspecCommandRequest and FspecCommandResult display chunks
    Then the provider published no timeline item for them and sent no send_fspec_result

