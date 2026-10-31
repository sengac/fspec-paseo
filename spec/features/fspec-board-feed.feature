@FSPEC-038
@done
@kanban
@board
@FSPEC-034
Feature: Serve the live fspec board to Paseo plugin UI

  """
  New: shared/board.ts (defineRpc contract + zod schemas, imported by server and later the client), server/board.ts (board store + watch handler built on createFspecDaemonClient; reuses within() from server/session.ts), index.server.ts registers server.handle(watchBoardRpc, ...) and disposes the store in its cleanup. The board uses its own daemon client (own socket) like each provider connection does.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. The board comes from the daemon over its own socket, never from reading spec files: seeded from the connect-time WorkUnitsUpdate and SessionSnapshot frames (kept by the daemon client as connection.initial), then kept current by every Envelope::WorkUnitsUpdate; list_live_sessions (idx 2) answers bare session ids
  #   2. Which fspec sessions are focused on which work unit comes from SessionInfo.workUnitFocus in the seed and from SessionEvent focusChanged; a cleared focus removes the session from its work unit
  #   3. Every observable change (new units snapshot that differs, focus change, connection lost, reconnected) gets a new opaque revision string '<instance epoch>:<counter>' so a restarted plugin server never reuses a revision a panel already holds
  #   4. Plugin RPC fspec.board.watch({ cwd, sinceRevision }) answers immediately when sinceRevision is null or differs from the current revision; otherwise it holds until the next change or 20 seconds (Paseo's plugin-process request timeout is 30 s), then answers with the current board
  #   5. The board is only served for a cwd inside the daemon's workspace (FSPEC-015 guard); otherwise watch answers state 'unavailable' with the same 'the fspec daemon serves X, not Y' reason
  #   6. When the daemon is unreachable or the connection drops, watch answers state 'unavailable' with the reason (held waiters are woken); the next watch call reconnects and re-seeds
  #   7. The plugin server opens one board daemon connection lazily on the first watch and closes it, waking every held watch, when the plugin is unloaded
  #
  # EXAMPLES:
  #   1. First watch { cwd: '/ws', sinceRevision: null } with the daemon serving /ws and list_work_units = [FSPEC-001 backlog 3pts] -> { state: 'ready', revision: 'E:1', workspace: '/ws', units: [FSPEC-001 ...], focus: {} }
  #   2. Panel holds watch { sinceRevision: 'E:1' }; the daemon pushes WorkUnitsUpdate moving FSPEC-001 to specifying -> the held watch answers within the push with revision 'E:2' and FSPEC-001 status specifying
  #   3. Held watch { sinceRevision: 'E:2' } with no change for 20 s -> answers { state: 'ready', revision: 'E:2' } with the unchanged board
  #   4. list_live_sessions has fspec-sess-1 focused on FSPEC-001; then focusChanged moves fspec-sess-1 to FSPEC-002 -> focus goes from { 'FSPEC-001': ['fspec-sess-1'] } to { 'FSPEC-002': ['fspec-sess-1'] } with a new revision
  #   5. watch { cwd: '/elsewhere' } while the daemon serves /ws -> { state: 'unavailable', reason: 'the fspec daemon serves /ws, not /elsewhere — start fspec in /elsewhere to use it there' }
  #   6. Held watch, then the daemon socket closes -> the watch answers { state: 'unavailable', reason: 'fspec daemon connection was lost: ...' }; the next watch reconnects and answers 'ready' with a fresh seed
  #
  # ASSUMPTIONS:
  #   1. Column grouping, points summary and display limits are the panel's job (FSPEC-035); the store returns the daemon's flat, ordered WorkUnitInfo list
  #
  # ========================================

  Background: User Story
    As a Paseo user running fspec on desktop or mobile
    I want to have the plugin server keep the fspec board live and hand it to the board panel
    So that the panel shows the same board the fspec TUI shows, within about a second of every change, without polling the daemon

  Scenario: The first watch seeds the board from the daemon
    Given the fspec daemon serves "/ws" and its connect-time WorkUnitsUpdate holds "FSPEC-001" in backlog with 3 points
    When the panel calls fspec.board.watch with cwd "/ws" and no revision
    Then it answers state ready for workspace "/ws" with the unit "FSPEC-001" and an empty focus map
    And the revision has the form "<epoch>:<counter>"

  Scenario: A held watch answers when the daemon pushes a work-units update
    Given a panel holding fspec.board.watch with the current revision
    When the daemon pushes a WorkUnitsUpdate moving "FSPEC-001" to specifying
    Then the held watch answers with a new revision and "FSPEC-001" in status specifying

  Scenario: A held watch with no change answers after 20 seconds
    Given a panel holding fspec.board.watch with the current revision
    When 20 seconds pass without a change
    Then the watch answers state ready with the same revision and the unchanged board

  Scenario: Focus changes move sessions between work units
    Given the connect-time SessionSnapshot has session "fspec-sess-1" focused on "FSPEC-001"
    When the daemon reports focusChanged for "fspec-sess-1" to "FSPEC-002"
    Then the focus map goes from "FSPEC-001" to "FSPEC-002" for "fspec-sess-1" with a new revision
    And a cleared focus removes "fspec-sess-1" from the focus map

  Scenario: The board is refused outside the daemon workspace
    Given the fspec daemon serves "/ws"
    When the panel calls fspec.board.watch with cwd "/elsewhere"
    Then it answers state unavailable with reason "the fspec daemon serves /ws, not /elsewhere — start fspec in /elsewhere to use it there"
    And a repeated watch with that revision is held instead of answered at once

  Scenario: A lost daemon connection makes the board unavailable until the next watch reconnects
    Given a panel holding fspec.board.watch with the current revision
    When the daemon socket closes
    Then the held watch answers state unavailable with a reason starting "fspec daemon connection was lost"
    And the next watch reconnects, re-seeds and answers state ready

  Scenario: Unloading the plugin closes the board connection
    Given a panel holding fspec.board.watch with the current revision
    When the plugin is unloaded
    Then the held watch answers and the board daemon socket is closed

  Scenario: list_live_sessions decodes bare session ids
    Given the daemon answers list_live_sessions with the session ids "fspec-sess-1" and "fspec-sess-2"
    When the provider decodes the response frame
    Then it reads sessionIds "fspec-sess-1" and "fspec-sess-2"
