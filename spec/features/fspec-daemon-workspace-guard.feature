@done
@core
@provider
@FSPEC-015
@FSPEC-052
Feature: Run each fspec session in the workspace of its Paseo directory

  """
  server/session.ts open() calls get_workspace_info (idx 22, added to server/wire.ts) first and compares realpaths with config.cwd. FSPEC-052 (multi-workspace daemons, fspec RPC-441..445): open() resolves the workspace from list_workspaces (idx 124) — the deepest listed workspace holding the cwd, else the cwd itself — and creates the session with create_session_checked in the start workspace or create_session_in_workspace (idx 126) elsewhere; the refusal is gone. server/wire.ts listWorkspaces 124 (WorkspaceEntry rpc-types chrome.rs), listWorkspaceWorkUnits 125, createSessionInWorkspace 126. fspec side: rpc service_implementation/schedule_loops.rs create_session_in_workspace (opens the workspace through SharedFspecService::workspace, registry RPC-441), sessions/src/default_project.rs create_session_in_workspace_checked (canonicalises, rejects non-directories, needs a default model). TUI parity (board-workspace-dropdown.feature): session creation uses create_session_in_workspace when a non-start workspace is selected.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. session.open asks the daemon for its workspace with get_workspace_info (RPC idx 22, returns WorkspaceInfo { cwd, git_branch }) before creating or resuming any daemon session
  #   2. The open proceeds only when the session cwd is the daemon workspace or a directory inside it, compared after resolving symlinks and trailing separators
  #   3. Otherwise the open answers request.failed with a diagnostic naming both directories and the fix (start fspec in the session's directory), and no daemon session is created, resumed or configured — SUPERSEDED by FSPEC-052: the session runs in that directory's workspace instead
  #   4. FSPEC-052: list_workspaces (idx 124) answers Result<Vec<WorkspaceEntry { path, name, start }>, String>, start workspace first; create_session_in_workspace (idx 126: workspace, role) answers Result<SessionId, String> and opens the workspace if needed
  #   5. FSPEC-052: the open's workspace is the deepest listed workspace holding the cwd, else the cwd; the start workspace (and directories inside it) keeps create_session_checked, any other workspace uses create_session_in_workspace(<workspace>, role)
  #   6. FSPEC-052: a failed create_session_in_workspace fails the open with 'fspec could not create a session in <workspace>: <reason>' and nothing is configured
  #   7. FSPEC-052: the import list for a cwd lists the sessions of the listed workspace holding it; a cwd no listed workspace holds lists nothing and opens no workspace
  #
  # EXAMPLES:
  #   1. Daemon workspace /repos/fspec, Paseo opens an fspec agent with cwd /repos/fspec-paseo: FSPEC-052 create_session_in_workspace('/repos/fspec-paseo', None) and the open reaches ready (FSPEC-015 refused it)
  #   4. FSPEC-052: listed /repos/fspec (start) and /repos/app; an agent in /repos/app/web -> create_session_in_workspace('/repos/app', None)
  #   5. FSPEC-052: create_session_in_workspace answers Err('workspace path is not a directory: /gone') -> request.failed 'fspec could not create a session in /gone: workspace path is not a directory: /gone'
  #   2. Daemon workspace /repos/fspec, cwd /repos/fspec/rust: the open proceeds (inside the workspace)
  #   3. Daemon workspace reported as /private/tmp/ws (realpath) while Paseo passes /tmp/ws (macOS symlink): the open proceeds
  #
  # ========================================

  Background: User Story
    As a Paseo user starting an fspec agent in a project
    I want to have the agent run in that project's workspace on the fspec daemon, whichever directory the daemon started in
    So that an agent never silently reads or edits the wrong repository and I need no daemon per project

  Scenario: An open outside the daemon's start workspace runs in that directory's workspace
    Given the fspec daemon started in "/repos/fspec" and serves no other workspace
    When Paseo opens an fspec session with cwd "/repos/fspec-paseo"
    Then the provider created the session with create_session_in_workspace for "/repos/fspec-paseo" and no create_session_checked
    And the open reached session.ready


  Scenario: An open inside the daemon workspace proceeds
    Given the fspec daemon serves workspace "/repos/fspec"
    When Paseo opens an fspec session with cwd "/repos/fspec/rust"
    Then the provider resolved the workspace with list_workspaces before create_session_checked and the open reached session.ready


  Scenario: Symlinked paths to the daemon workspace are accepted
    Given the fspec daemon reports its workspace by its resolved real path
    When Paseo opens an fspec session with a symlinked path to the same directory
    Then the open reaches session.ready


  Scenario: An open inside another served workspace creates the session there
    Given the fspec daemon started in "/repos/fspec" and also serves "/repos/app"
    When Paseo opens an fspec session with cwd "/repos/app/web"
    Then the provider created the session with create_session_in_workspace for "/repos/app"


  Scenario: A workspace the daemon refuses fails the open with its reason
    Given create_session_in_workspace answers "workspace path is not a directory: /gone"
    When Paseo opens an fspec session with cwd "/gone"
    Then the open fails with "fspec could not create a session in /gone: workspace path is not a directory: /gone"
    And no set_session_model or set_thinking_level was sent


  Scenario: Workspace RPCs match the daemon's encoding
    Given the Rust golden vectors for list_workspaces, create_session_in_workspace and list_workspace_work_units
    When the codec decodes the replies and encodes the requests
    Then the workspaces decode to "/w/a" named "a" as the start workspace and "/w/b" named "b"
    And the create_session_in_workspace and list_workspace_work_units arguments and reply match the golden vectors exactly


  Scenario: The import list shows the sessions of the served workspace holding the directory
    Given the fspec daemon started in "/repos/fspec" and also serves "/repos/app"
    When Paseo lists importable fspec sessions for cwd "/repos/app/web"
    Then the provider listed the sessions of "/repos/app" and each summary carries cwd "/repos/app"

