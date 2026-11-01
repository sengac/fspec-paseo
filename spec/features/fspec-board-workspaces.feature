@done
@kanban
@board
@FSPEC-053
@FSPEC-058
Feature: Show the fspec board for every workspace the daemon serves
  """
  server/board.ts keeps one board per served workspace path (units + revision), a session -> project map, and per-workspace waiters; watch/available/details/move resolve the cwd with server/workspaces.ts servingWorkspace over list_workspaces. Boards of non-start workspaces load with list_workspace_work_units (which opens the workspace and makes the daemon push WorkspaceWorkUnitsUpdate for it, fspec RPC-445 workspace_fanout.rs) and stay live from those pushes. FSPEC-058: get_work_unit_details and move_work_unit_up/down take (workspace, id) since fspec RPC-450 (an unknown workspace is an error), so details and moves pass the served workspace holding the panel's cwd on every board. list_workspaces failing, empty or without a start workspace is an error (no get_workspace_info substitute) for the board and for server/session.ts, and a session of unknown project shows on no board. TUI parity: board-workspace-dropdown.feature (WorkUnitsLoaded from the start stream is dropped while another workspace is selected; WorkspaceWorkUnitsLoaded applies only to the selected path; sessions shown per workspace by project). The client is unchanged: the panel and the phone entry already go through watch/available.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. The board serves a cwd held by any workspace list_workspaces lists (deepest match); the start workspace's board comes from the connect-time WorkUnitsUpdate and later WorkUnitsUpdate pushes, any other workspace's from list_workspace_work_units (idx 125) on first watch and WorkspaceWorkUnitsUpdate pushes (envelope 9) tagged with its path
  #   2. A push for one workspace changes only that workspace's board: watches of other workspaces keep holding; pushes for workspaces no panel has loaded are ignored
  #   3. A workspace's board shows the focus of the sessions whose project is that workspace (SessionInfo.project from the snapshot and Created events); sessions of other workspaces are left out
  #   4. fspec.board.available answers true for a cwd held by any served workspace, so the phone '···' menu entry appears for every served workspace, not only the start workspace
  #   5. A cwd no served workspace holds answers unavailable 'the fspec daemon serves <paths>, not <cwd> — start fspec in <cwd> to use it there' and is never opened as a workspace by the board
  #   6. FSPEC-058: Card details (get_work_unit_details) and Move up/down (move_work_unit_up/down) take (workspace, id); every board sends its own served workspace
  #   7. FSPEC-058: list_workspaces failing, empty or naming no start workspace is an error with that reason for the board and for opening an agent, never replaced by get_workspace_info; a session of unknown project is on no board
  #
  # EXAMPLES:
  #   1. Daemon started in /ws also serves /app; watch { cwd: '/app/web' } -> list_workspace_work_units('/app') -> ready, workspace '/app', units [APP-001]
  #   2. Held watch on /app; push WorkspaceWorkUnitsUpdate('/app', [APP-002]) -> answers APP-002; push WorkUnitsUpdate (start) -> /app's board unchanged
  #   3. Sessions s-ws (project /ws, focused FSPEC-001) and s-app (project /app, focused APP-001) -> /app's focus { APP-001: [s-app] }
  #   4. available('/app/web') -> true, available('/other') -> false
  #   5. FSPEC-058: panel /app/web, card APP-001 -> get_work_unit_details('/app', 'APP-001') and move_work_unit_up('/app', 'APP-001'); golden work_unit_details_args = ('/w/b', 'AUTH-001')
  #   6. FSPEC-058: list_workspaces Err('workspace registry unavailable: locked') -> watch unavailable and open fails, both naming 'fspec daemon list_workspaces failed: workspace registry unavailable: locked'
  #
  # ========================================
  Background: User Story
    As a Paseo user with several projects on one fspec daemon
    I want to see the live fspec board of whichever served workspace I am in, on desktop and phone
    So that every project's board is one tap away without restarting the daemon in it

  Scenario: The board of another served workspace is read from the daemon
    Given the fspec daemon started in "/ws" also serves "/app", whose work units are "APP-001"
    When the panel calls fspec.board.watch with cwd "/app/web" and no revision
    Then the provider read list_workspace_work_units for "/app"
    And it answers state ready for workspace "/app" with the unit "APP-001"

  Scenario: Pushes for a served workspace keep only its board live
    Given a panel holding fspec.board.watch for "/app" at its current revision
    When the daemon pushes WorkUnitsUpdate for the start workspace
    Then the held watch is still waiting
    And when the daemon pushes WorkspaceWorkUnitsUpdate for "/app" with "APP-002" the held watch answers with the unit "APP-002"

  Scenario: A workspace's board shows only its own sessions' focus
    Given session "s-ws" in "/ws" is focused on "FSPEC-001" and session "s-app" in "/app" is focused on "APP-001"
    When the panel watches the board of "/app"
    Then its focus map is "APP-001" for "s-app" only

  Scenario: Every served workspace offers the board on phones
    Given the fspec daemon started in "/ws" also serves "/app"
    When the client asks fspec.board.available for "/app/web", "/ws" and "/other"
    Then "/app/web" and "/ws" are available and "/other" is not

  Scenario: Card details and moves act on the panel's workspace
    Given the fspec daemon started in "/ws" also serves "/app"
    When the panel of "/app/web" asks for card "APP-001"'s details and to move it up and down, and the panel of "/ws" asks for card "FSPEC-001"'s details
    Then the daemon received get_work_unit_details("/app", "APP-001"), move_work_unit_up("/app", "APP-001"), move_work_unit_down("/app", "APP-001") and get_work_unit_details("/ws", "FSPEC-001")
    And the details answer ready and both moves answer ok

  Scenario: Card details and move requests match the daemon's encoding
    Given the Rust golden vectors for the arguments ("/w/b", "AUTH-001") and for move_work_unit_up answering Ok(())
    When the codec encodes get_work_unit_details, move_work_unit_up and move_work_unit_down for workspace "/w/b" and card "AUTH-001" and decodes the reply
    Then each request's argument bytes equal the golden vector after variant indices 123, 18 and 19
    And the reply decodes to an ok result

  Scenario: A workspace list the daemon cannot give is an error
    Given list_workspaces answers "workspace registry unavailable: locked"
    When the panel watches the board of "/ws" and Paseo opens an fspec agent in "/ws"
    Then the watch answers unavailable with "fspec daemon list_workspaces failed: workspace registry unavailable: locked"
    And the open fails with the same reason and get_workspace_info was never called

  Scenario: A session of unknown project shows on no board
    Given the panel watches the board of "/ws"
    When the daemon reports session "s-x", never listed in a snapshot or Created event, focused on "FSPEC-001"
    Then the board of "/ws" shows no focus for "FSPEC-001"
