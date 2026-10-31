@done
@core
@provider
@FSPEC-015
Feature: Refuse sessions outside the fspec daemon's workspace

  """
  server/session.ts open() calls get_workspace_info (idx 22, added to server/wire.ts) first and compares realpaths with config.cwd.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. session.open asks the daemon for its workspace with get_workspace_info (RPC idx 22, returns WorkspaceInfo { cwd, git_branch }) before creating or resuming any daemon session
  #   2. The open proceeds only when the session cwd is the daemon workspace or a directory inside it, compared after resolving symlinks and trailing separators
  #   3. Otherwise the open answers request.failed with a diagnostic naming both directories and the fix (start fspec in the session's directory), and no daemon session is created, resumed or configured
  #
  # EXAMPLES:
  #   1. Daemon workspace /repos/fspec, Paseo opens an fspec agent with cwd /repos/fspec-paseo: request.failed 'the fspec daemon serves /repos/fspec, not /repos/fspec-paseo — start fspec in /repos/fspec-paseo to use it there'; no create_session
  #   2. Daemon workspace /repos/fspec, cwd /repos/fspec/rust: the open proceeds (inside the workspace)
  #   3. Daemon workspace reported as /private/tmp/ws (realpath) while Paseo passes /tmp/ws (macOS symlink): the open proceeds
  #
  # ========================================

  Background: User Story
    As a Paseo user starting an fspec agent in a project
    I want to be stopped with a clear message when the running fspec daemon serves a different directory
    So that an agent never silently reads or edits the wrong repository

  Scenario: An open outside the daemon workspace is refused
    Given the fspec daemon serves workspace "/repos/fspec"
    When Paseo opens an fspec session with cwd "/repos/fspec-paseo"
    Then the open answers request.failed naming "/repos/fspec", "/repos/fspec-paseo" and the fix to start fspec in "/repos/fspec-paseo"
    And no create_session, resume_session, set_session_model or set_thinking_level was sent


  Scenario: An open inside the daemon workspace proceeds
    Given the fspec daemon serves workspace "/repos/fspec"
    When Paseo opens an fspec session with cwd "/repos/fspec/rust"
    Then the provider called get_workspace_info before create_session and the open reached session.ready


  Scenario: Symlinked paths to the daemon workspace are accepted
    Given the fspec daemon reports its workspace by its resolved real path
    When Paseo opens an fspec session with a symlinked path to the same directory
    Then the open reaches session.ready

