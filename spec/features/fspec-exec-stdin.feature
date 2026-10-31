@done
@core
@provider
@FSPEC-019
Feature: Surface exec stdin requests so interactive commands do not hang

  """
  server/wire.ts types StreamChunk 27/28 and adds write_exec_stdin (83); server/session.ts keeps a stdin slot beside the pause slot.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. The codec decodes StreamChunk 27 as execStdinRequest { execSessionId, command, quietSeconds, tsMs } and 28 as execStdinRequestCleared instead of unsupported
  #   2. A live execStdinRequest becomes one session.permission { kind: 'question', name: 'stdin', title: 'Input for <command>' } with one free-text question (header 'Input', no options, allowOther true, allowEmpty true) explaining the command has been quiet for <quietSeconds>s
  #   3. An allow answer writes the typed text with write_exec_stdin (idx 83: session_id, exec_session_id, text); fspec appends the trailing newline; a deny answer writes nothing
  #   4. The request resolves exactly once: after the answer is written, on execStdinRequestCleared, on a newer request for another exec session, on the turn's terminal chunk, on close and on connection loss; replayed history never opens a stdin request
  #   5. Exec stdin requests are independent of approval pauses: both can be open at once and each resolves on its own
  #
  # EXAMPLES:
  #   1. Bash runs 'python3 -c "input()"' and goes quiet: chunk ExecStdinRequest { exec_session_id: 'exec-3', command: 'python3 -c input()', quiet_seconds: 5 } -> Paseo shows 'Input for python3 -c input()'; the user types 'hello' -> write_exec_stdin(session, 'exec-3', 'hello') -> session.permission_resolved
  #   2. The command finishes on its own before the user answers: ExecStdinRequestCleared -> session.permission_resolved, and a late answer writes nothing
  #   3. The user dismisses the stdin card -> no write_exec_stdin, the request resolves; the agent can still interrupt or wait
  #
  # ========================================

  Background: User Story
    As a Paseo user whose fspec agent runs an interactive command
    I want to type the input the command is waiting for from Paseo
    So that interactive commands finish instead of hanging the agent

  Scenario: A quiet interactive command asks Paseo for input
    Given an fspec session whose running Bash call started exec session "exec-3"
    When the daemon streams ExecStdinRequest for "exec-3" with command "python3 -c input()" quiet for 5 seconds
    Then the provider emitted one session.permission with kind question titled "Input for python3 -c input()" holding one free-text question


  Scenario: Typed input is written to the command's stdin
    Given an open stdin request for exec session "exec-3"
    When Paseo answers it with answers { "Input": "hello" }
    Then the provider called write_exec_stdin(session, "exec-3", "hello") and emitted session.permission_resolved


  Scenario: A cleared request resolves without writing
    Given an open stdin request for exec session "exec-3"
    When the daemon streams ExecStdinRequestCleared
    Then the provider emitted session.permission_resolved
    And a late answer for that request calls no write_exec_stdin


  Scenario: Dismissing the stdin request writes nothing
    Given an open stdin request for exec session "exec-3"
    When Paseo answers it with behavior deny
    Then the provider emitted session.permission_resolved and called no write_exec_stdin


  Scenario: Exec stdin chunks round-trip through the codec
    Given an ExecStdinRequest chunk for "exec-3" and an ExecStdinRequestCleared chunk
    When the codec encodes and decodes them inside Event envelopes
    Then they decode to execStdinRequest with all four fields and to execStdinRequestCleared

