@done
@kanban
@board
@FSPEC-053
Feature: Show the fspec board for every workspace the daemon serves

  """
  server/board.ts keeps one board per served workspace path (units + revision), a session -> project map, and per-workspace waiters; watch/available/details/move resolve the cwd with server/workspaces.ts servingWorkspace over list_workspaces. Boards of non-start workspaces load with list_workspace_work_units (which opens the workspace and makes the daemon push WorkspaceWorkUnitsUpdate for it, fspec RPC-445 workspace_fanout.rs) and stay live from those pushes. get_work_unit_details and move_work_unit_up/down take no workspace and act on the daemon's cwd (rpc service_implementation schedule_loops.rs / workspace_history.rs), so they are refused off the start workspace rather than answering for the wrong project. TUI parity: board-workspace-dropdown.feature (WorkUnitsLoaded from the start stream is dropped while another workspace is selected; WorkspaceWorkUnitsLoaded applies only to the selected path; sessions shown per workspace by project). The client is unchanged: the panel and the phone entry already go through watch/available.
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
  #   6. Card details (get_work_unit_details) and Move up/down (move_work_unit_up/down) read and write the daemon's start workspace only, so on another workspace's board they answer 'card details and moves are only available in the fspec daemon's start workspace (<start>)'
  #
  # EXAMPLES:
  #   1. Daemon started in /ws also serves /app; watch { cwd: '/app/web' } -> list_workspace_work_units('/app') -> ready, workspace '/app', units [APP-001]
  #   2. Held watch on /app; push WorkspaceWorkUnitsUpdate('/app', [APP-002]) -> answers APP-002; push WorkUnitsUpdate (start) -> /app's board unchanged
  #   3. Sessions s-ws (project /ws, focused FSPEC-001) and s-app (project /app, focused APP-001) -> /app's focus { APP-001: [s-app] }
  #   4. available('/app/web') -> true, available('/other') -> false
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

  Scenario: Card details and moves stay with the start workspace
    Given the fspec daemon started in "/ws" also serves "/app"
    When the panel of "/app" asks for card "APP-001"'s details and to move it up
    Then both answer "card details and moves are only available in the fspec daemon's start workspace (/ws)"
    And no get_work_unit_details or move_work_unit_up reached the daemon
