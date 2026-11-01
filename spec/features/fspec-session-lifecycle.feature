@done
@provider
@core
@FSPEC-005
@FSPEC-067
Feature: Drive the fspec session lifecycle from Paseo
  """
  Session lifecycle lives on top of the FSPEC-003 daemon client (server/daemon.ts connection + RPC transport) and the FSPEC-002 wire codec (server/wire.ts). A per-Paseo-session registry maps Paseo sessionId -> { daemonSessionId, model, thinking, activeTurnId, turnCounter }. Daemon RPCs: create_session_checked (idx 121; the legacy create_session idx 3 until FSPEC-039), send_input (idx 4), interrupt (idx 5), set_session_model (idx 29), set_thinking_level (idx 39), send_input_with_thinking (idx 46), destroy_session (idx 87). Turn settlement is driven by the daemon's terminal stream chunks: Done(13) -> completed, Error(14) -> failed, Interrupted(9)/InterruptedWithReason(30) -> canceled; exactly-once guarded per turnId. Transient timeline rows (FSPEC-006) are terminalized before the terminal turn event. ProviderPersistence is {version:1, data:{sessionId, model?, thinkingOption?}}.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. session.open creates the daemon session via create_session (RPC idx 3) and maps the returned daemon SessionId into the Paseo session; the daemon session id is persisted in the session's ProviderPersistence (version 1, data.sessionId) so it survives reopen
  #   2. session.prompt sends the prompt text to the daemon via send_input (RPC idx 4); when the session has a non-Off thinking level it uses send_input_with_thinking (RPC idx 46) with a ThinkingConfig built from the session's current provider/model and thinking level instead
  #   3. a successful session.open emits exactly this event sequence in order: session.opened (with persistence when config.persist, restoration 'core', committed config), session.config (committed model/thinking values), session.ready — all carrying the input requestId/sessionId
  #   4. each accepted prompt publishes exactly one session.prompt_result (result {type: 'turn', turnId}) followed by exactly one session.turn 'started' for that turnId, and exactly one terminal session.turn event (completed / failed / canceled) for that turnId — no duplicates, no drops; a second prompt for the same session starts a new turnId
  #   5. session.interrupt answers request.completed as soon as the stop is accepted, then calls daemon interrupt (RPC idx 5); the turn's terminal 'canceled' session.turn event is the authoritative settlement, driven by the daemon's terminal chunk (Interrupted / InterruptedWithReason)
  #   6. on session.open the provider applies the requested model (config.model, 'provider/model' format) and thinkingOption via set_session_model (RPC idx 29) and set_thinking_level (RPC idx 39) after create_session, falling back to the catalog defaults when the config omits them
  #   7. session.close calls daemon destroy_session (RPC idx 87) with the mapped daemon SessionId, removes the session from the registry, and emits session.closed followed by request.completed; close of an unknown session is a no-op that still completes the request
  #   8. model and thinking selection are per-session: session.open applies config.model/config.thinkingOption (or catalog defaults), and session.configure applies changes.model via set_session_model and changes.thinkingOption via set_thinking_level for that session only; after applying, the provider publishes the committed session.config and then request.completed
  #   9. any input (prompt, interrupt, configure, close) targeting an unknown or already-closed Paseo sessionId is rejected with a clear 'Unknown session' error — thrown synchronously for prompt (no requestId to answer) or surfaced as request.failed for request-id inputs
  #   10. connection.close() releases every open session (destroy_session for each mapped daemon session) without throwing — a failing destroy is logged (FSPEC-067; there is no session left to show it on), the connection is idempotent (second close is a no-op), and no events are emitted after close
  #
  # EXAMPLES:
  #   1. Opening a fresh fspec session (no persistence on the open input) creates a daemon session; the daemon returns id 'fspec-sess-42' and the plugin remembers it, exposing {version:1, data:{sessionId:'fspec-sess-42'}} as the session's persistence. Later reopening (Paseo refresh) with that same persistence reuses the existing daemon session instead of creating a new one.
  #   2. Prompting a session whose thinking level is Off sends send_input(session_id, 'fix the login bug') to the daemon. Prompting the same session with thinking level High instead sends send_input_with_thinking(session_id, 'fix the login bug', a ThinkingConfig built from the session's current provider/model + level High), so the daemon gets the reasoning config.
  #   3. A successful session.open (persist=true, committed model 'anthropic/claude-sonnet-4', thinking 'high') emits, in this order and only once each: session.opened (requestId, sessionId, persistence {version:1,data:{sessionId:'fspec-sess-42'}}, restoration 'core', committed config), then session.config (the committed model/thinking), then session.ready (requestId, sessionId). No other open-time events are interleaved.
  #   4. First prompt: the plugin mints turn 'turn-1' and emits exactly one session.prompt_result {result:{type:'turn', turnId:'turn-1'}} then exactly one session.turn {turnId:'turn-1', state:'started'}; when the daemon's stream yields the Done terminal chunk it emits exactly one session.turn {turnId:'turn-1', state:'completed'} and no further terminal for that turnId. A second prompt mints a NEW turn 'turn-2' (turn-1's terminal is never re-emitted), so each started turn gets exactly one terminal and nothing is duplicated or dropped.
  #   5. While a turn is running, the user clicks Stop in Paseo: the plugin answers request.completed for the session.interrupt input as soon as the stop is accepted, then issues the daemon interrupt RPC for the session. The authoritative settlement arrives later as the turn's terminal session.turn {state:'canceled'} event, driven by the daemon's Interrupted/InterruptedWithReason terminal chunk — the plugin does not settle the turn itself from the stop click.
  #   6. Opening with config.model='anthropic/claude-sonnet-4' and thinkingOption='high' makes the plugin call set_session_model(session_id,'anthropic','claude-sonnet-4') then set_thinking_level(session_id, High) AFTER create_session, and the committed session.config reflects exactly those values. Opening with model/thinking omitted falls back to the catalog defaults instead of inventing values.
  #   7. Closing an open session: the plugin calls destroy_session('fspec-sess-42'), removes it from its registry, and emits session.closed then request.completed. Closing an already-unknown/closed session id is a no-op that still answers request.completed (no error), and the session no longer accepts prompts.
  #   8. A session.configure with changes.model='openai/gpt-5' on an open session calls set_session_model(session_id,'openai','gpt-5') for that session only (no other session is affected), then publishes the committed session.config reflecting the new model and answers request.completed. A changes.thinkingOption=null clears the thinking level (set_thinking_level Off).
  #   9. Sending a session.prompt for a sessionId the plugin never opened (or has already closed) is rejected with a clear 'Unknown session' error: it throws synchronously (a prompt has no requestId to answer) and no prompt_result or turn is emitted. The equivalent session.interrupt / session.configure / session.close inputs for that unknown id surface as request.failed with the same 'Unknown session' error (close of an unknown id is still answered as request.completed, per rule 6).
  #   10. The plugin has 3 open fspec sessions (daemon ids A, B, C). connection.close() destroys ALL of them — destroy_session(A), destroy_session(B), destroy_session(C) are each issued — then clears the registry. It resolves without throwing even if one destroy fails (a failing destroy is swallowed), it is idempotent (a second close() is a no-op), and no provider events are emitted after close() returns.
  #
  # ========================================
  Background: User Story
    As a Paseo user
    I want to open, drive, and stop an fspec agent session from Paseo
    So that the daemon-backed agent behaves like a first-class Paseo provider

  Scenario: Opening a session creates and remembers the daemon session
    Given Paseo opens a fresh fspec session without persistence
    When the provider creates the daemon session via create_session and receives daemon id `fspec-sess-42`
    Then the provider maps the daemon session id into the Paseo session
    And the session's persistence is `{ version: 1, data: { sessionId: "fspec-sess-42" } }`
    And reopening with that same persistence reuses the existing daemon session instead of creating a new one

  Scenario: A prompt is sent with send_input whatever the thinking level
    Given an open fspec session whose thinking level is Off
    When the provider sends the prompt `fix the login bug` to the daemon
    Then the provider sent `send_input(session_id, "fix the login bug")`
    And prompting the same session after set_thinking_level High still sends `send_input(session_id, "fix the login bug")`, leaving the daemon to build the provider thinking settings

  Scenario: A successful session.open emits the exact open event sequence
    Given Paseo opens an fspec session with `persist: true`, committed model `anthropic/claude-sonnet-4`, and thinking `high`
    When the provider completes the open
    Then it emitted, in order and exactly once each: session.opened (requestId, sessionId, persistence, restoration `core`, committed config), session.config (committed model/thinking), session.commands (the fspec commands), session.ready (requestId, sessionId)
    And no other open-time events were interleaved

  Scenario: Each prompt publishes one prompt result and one terminal turn
    Given an open fspec session with no active turn
    When the provider accepts the first prompt
    Then it minted turn `turn-1` and emitted exactly one session.prompt_result `{ result: { type: "turn", turnId: "turn-1" } }` followed by exactly one session.turn `{ turnId: "turn-1", state: "started" }`
    And when the daemon stream yields the Done terminal chunk it emitted exactly one session.turn `{ turnId: "turn-1", state: "completed" }` and no further terminal for that turn
    And a second prompt minted a new turn `turn-2` and never re-emitted the terminal for `turn-1`

  Scenario: Stop settles the turn via the daemon's terminal chunk
    Given an open fspec session with an active turn running
    When the user clicks Stop and the provider answers the session.interrupt input
    Then the provider answered request.completed as soon as the stop was accepted and issued the daemon interrupt RPC for the session
    And the turn's terminal session.turn `{ state: "canceled" }` event was driven by the daemon's Interrupted/InterruptedWithReason terminal chunk, not by the stop click itself

  Scenario: Opening applies the requested model and thinking after creation
    Given Paseo opens an fspec session with model `anthropic/claude-sonnet-4` and thinkingOption `high`
    When the provider completes the open
    Then it called set_session_model(session_id, "anthropic", "claude-sonnet-4") then set_thinking_level(session_id, High) after create_session
    And the committed session.config reflects exactly those values
    And opening with model/thinking omitted falls back to the catalog defaults instead of inventing values

  Scenario: Closing a session destroys it and answers the request
    Given an open fspec session mapped to daemon id `fspec-sess-42`
    When Paseo closes the session
    Then the provider called destroy_session("fspec-sess-42"), removed it from the registry, and emitted session.closed followed by request.completed
    And closing an already-unknown or already-closed session id is a no-op that still answers request.completed, and the session no longer accepts prompts

  Scenario: Configure applies a model or thinking change to one session only
    Given an open fspec session
    When the provider receives session.configure with `changes.model = "openai/gpt-5"`
    Then it called set_session_model(session_id, "openai", "gpt-5") for that session only
    And it published the committed session.config reflecting the new model and answered request.completed
    And a `changes.thinkingOption = null` clears the thinking level via set_thinking_level Off

  Scenario: Inputs targeting an unknown session are rejected
    Given a sessionId the provider never opened or has already closed
    When the provider receives a session.prompt for that sessionId
    Then it rejected the input synchronously with a clear `Unknown session` error and emitted no prompt_result or turn
    And the equivalent session.interrupt, session.configure, and session.close inputs for that unknown id surface as request.failed with the same `Unknown session` error, while close of an unknown id is still answered as request.completed

  Scenario: Closing the connection releases every open session
    Given the provider has 3 open fspec sessions mapped to daemon ids A, B, and C
    When the provider connection is closed
    Then destroy_session was issued for A, B, and C and the session registry was cleared
    And close resolved without throwing even when one destroy failed, logged that failure, is idempotent on a second call, and emitted no events after close
