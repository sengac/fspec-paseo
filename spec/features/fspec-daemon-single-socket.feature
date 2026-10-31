@done
@core
@provider
@FSPEC-014
Feature: Share one daemon socket across concurrent connects

  """
  server/daemon.ts connect() shares one in-flight attempt; cleared on settle.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. Concurrent connect() calls on one daemon client share a single in-flight connection attempt: exactly one socket is opened and every caller resolves with it (or rejects with the same diagnostic)
  #   2. Each server-pushed envelope reaches the provider once, so a stream chunk is folded into its session exactly once
  #   3. After a failed or lost connection, the next connect() opens a fresh socket (the shared attempt does not stick)
  #
  # EXAMPLES:
  #   1. Live in Paseo: 'paseo run --provider fspec "Reply with exactly one word: pong"' produced three [User] rows and a thought reading 'TheTheThe user user user asked asked asked...'; after the fix the same run shows one user row and 'The user asked...'
  #   2. Three connect() calls issued before the handshake completes open one socket; one Text 'hi' chunk then publishes one assistant_message 'hi'
  #
  # ========================================

  Background: User Story
    As a Paseo user running an fspec agent
    I want to see each streamed row exactly once
    So that the transcript reads correctly instead of tripled and interleaved

  Scenario: Concurrent connects share one socket
    Given a daemon client whose first connection handshake is still in flight
    When three callers call connect() at the same time
    Then exactly one socket was opened and all three callers resolved with the same connection


  Scenario: Concurrent inputs stream each chunk once
    Given Paseo sends the catalog request and session.open on a fresh provider connection without waiting
    When the daemon streams Text "hi" for the opened session
    Then the provider opened one daemon socket and published exactly one assistant_message "hi"


  Scenario: A failed connect does not stick
    Given a connect attempt that fails because the daemon refuses the socket
    When the next connect() is called after the daemon is back
    Then a new socket is opened and the connection is established

