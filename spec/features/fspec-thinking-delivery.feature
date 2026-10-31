@done
@core
@provider
@FSPEC-012
Feature: Let the daemon derive provider thinking config from the session level

  """
  server/session.ts prompt() always uses send_input; thinking reaches the daemon via set_thinking_level, and the daemon's get_thinking_config builds provider-specific settings.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. Every prompt is sent with send_input (RPC idx 4) regardless of thinking level; the provider never calls send_input_with_thinking
  #   2. The session's thinking level reaches the daemon only through set_thinking_level (idx 39) on open and configure, so the daemon builds the provider-specific config itself (get_thinking_config: Claude budget, Codex reasoning.effort, Gemini thinking config)
  #
  # EXAMPLES:
  #   1. Session thinking High on codex/gpt-6.1-terra: prompt 'fix the login bug' sends send_input(session, 'fix the login bug'); the daemon resolves {reasoning: {effort: 'high', summary: 'auto'}} from the base level set earlier by set_thinking_level(session, High)
  #   2. Before the fix the same prompt sent send_input_with_thinking with {providerId:'codex', level:'high', configJson:'{}'}, which the daemon would forward as the request's thinking settings
  #
  # ========================================

  Background: User Story
    As a Paseo user who picks a thinking level for an fspec session
    I want to have the daemon apply its own provider-specific reasoning settings for that level
    So that thinking works for every provider instead of sending malformed settings

  Scenario: A prompt at a non-off thinking level is sent with send_input
    Given an open fspec session on model "codex/gpt-6.1-terra" whose thinking level was set to High with set_thinking_level
    When Paseo sends the prompt "fix the login bug"
    Then the provider sent send_input(session_id, "fix the login bug")
    And it never called send_input_with_thinking


  Scenario: Changing the thinking level only calls set_thinking_level
    Given an open fspec session whose thinking level is Off
    When Paseo configures thinkingOption "medium" and sends a prompt
    Then the provider called set_thinking_level(session_id, Medium) and then send_input for the prompt

