@done
@core
@provider
@FSPEC-028
Feature: Strip fspec stderr markers from shell output

  """
  server/transcript.ts strips '⚠stderr⚠' markers where tool output is stored.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. fspec prefixes each stderr line of a ToolResult with the marker '⚠stderr⚠'; the provider removes every marker from tool output (results and progress) and keeps the text
  #   2. Output without markers is unchanged, and the same cleaning applies to live and replayed transcripts
  #
  # EXAMPLES:
  #   1. Live: ToolResult content '⚠stderr⚠real\t0m0.017s\n⚠stderr⚠user\t0m0.004s\n' -> shell card output 'real\t0m0.017s\nuser\t0m0.004s\n'
  #
  # ========================================

  Background: User Story
    As a Paseo user reading an fspec agent's shell output
    I want to see command output without fspec's internal stderr markers
    So that completed shell cards read like real terminal output

  Scenario: Stderr markers are removed from shell output
    Given an fspec session running a Bash tool call "call-1"
    When the daemon streams ToolResult "⚠stderr⚠real\t0m0.017s\n⚠stderr⚠user\t0m0.004s\n" for "call-1"
    Then the shell card output is "real\t0m0.017s\nuser\t0m0.004s\n"


  Scenario: Unmarked output is unchanged
    Given an fspec session running a Bash tool call "call-2"
    When the daemon streams ToolProgress "a.txt\n" and ToolResult "a.txt\n" for "call-2"
    Then the shell card output is "a.txt\n"

