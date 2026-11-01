@done
@provider
@core
@FSPEC-055
Feature: Start fspec orchestrator bots from Paseo with a bot mode

  """
  server/bot.ts: ORCHESTRATOR_ROLE (verbatim from fspec rust/sessions/src/bot.rs, TUI-114), BOT_ROLE_MARKER, isBotRole, FSPEC_MODES. server/wire.ts getSessionRole 44 (SessionId) -> Option<String>, setSessionRole 45 (SessionId, Option<String>) -> Result<(), String>. server/catalog.ts publishes the modes and defaultMode 'agent'; server/session.ts open() passes the role to createDaemonSession, reads the role of a resumed session, configure() maps mode to set_session_role, list() marks bot sessions from SessionInfo.role. TUI parity: New Bot creates the session with the role and no other engine change; the agent bar marks bot sessions from SessionInfo.role. The daemon's role decides a resumed session's mode, so an import with Paseo's default mode never strips a bot's role.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. The provider offers Paseo modes 'agent' (Agent, the default) and 'bot' (Bot) in its catalog and every session.config
  #   2. A new session opened in mode 'bot' is created with fspec's orchestrator role (rust/sessions/src/bot.rs ORCHESTRATOR_ROLE, copied verbatim) on both creation paths: create_session_checked(Some(role)) in the start workspace and create_session_in_workspace(workspace, Some(role)) elsewhere; mode 'agent' or none creates it with no role
  #   3. A session is a bot iff its role starts with '# fspec bot: orchestrator'; a resumed or imported session reads its role with get_session_role (idx 44) and its committed mode is 'bot' for a bot role, otherwise 'agent', whatever mode Paseo asked for
  #   4. session.configure with mode 'bot' sets the orchestrator role with set_session_role (idx 45); with mode 'agent' it clears a bot role (set_session_role None) and leaves any other role alone
  #   5. An unknown mode fails the open or configure with 'invalid fspec mode "<mode>" — expected agent or bot'
  #   6. The import list marks bot sessions: their description starts with 'Bot · '
  #
  # EXAMPLES:
  #   1. Paseo opens an agent in /work with mode 'bot' -> create_session_checked(Some(ORCHESTRATOR_ROLE)); session.config mode 'bot'
  #   2. Paseo opens a bot in /repos/app (not the start workspace) -> create_session_in_workspace('/repos/app', Some(ORCHESTRATOR_ROLE))
  #   3. Reopening fspec-sess-42 whose get_session_role is the orchestrator role -> session.config mode 'bot'
  #   4. configure { mode: 'agent' } on a bot -> set_session_role(fspec-sess-42, None); session.config mode 'agent'
  #
  # ========================================

  Background: User Story
    As a Paseo user who wants fspec to orchestrate work
    I want to start an fspec orchestrator bot from Paseo by choosing a bot mode
    So that one agent breaks my request into tasks, runs sub-agents on them and reports back, as New Bot does in the fspec TUI

  Scenario: The catalog offers agent and bot modes
    Given an fspec provider connected to the daemon
    When Paseo asks for the catalog
    Then the catalog's modes are "agent" labelled "Agent" and "bot" labelled "Bot", and its defaultMode is "agent"

  Scenario: A bot is created with fspec's orchestrator role
    Given the orchestrator role starts with "# fspec bot: orchestrator"
    When Paseo opens an fspec session in the daemon's start workspace with mode "bot"
    Then the provider called create_session_checked with the orchestrator role
    And the committed session.config mode is "bot"

  Scenario: A bot in another workspace is created there with the orchestrator role
    Given the fspec daemon started in "/work" serves no other workspace
    When Paseo opens an fspec session in "/repos/app" with mode "bot"
    Then the provider called create_session_in_workspace for "/repos/app" with the orchestrator role

  Scenario: An agent opened without a mode has no role
    Given an fspec provider connected to the daemon
    When Paseo opens an fspec session with no mode
    Then the provider called create_session_checked with no role
    And the committed session.config mode is "agent"

  Scenario: A resumed session with the bot role opens in bot mode
    Given a saved fspec session "fspec-sess-42" whose role is the orchestrator role
    When Paseo reopens it with mode "agent"
    Then the committed session.config mode is "bot" and no set_session_role was sent

  Scenario: Changing the mode switches the session's role
    Given an open fspec agent session "fspec-sess-42"
    When Paseo configures mode "bot" and then mode "agent"
    Then the provider called set_session_role with the orchestrator role and then with no role
    And the committed session.config modes were "bot" then "agent"

  Scenario: The import list marks bot sessions
    Given the daemon lists session "bot-1" with the orchestrator role and session "agent-1" with no role
    When Paseo lists importable fspec sessions
    Then the description of "bot-1" starts with "Bot · " and the description of "agent-1" does not

  Scenario: Session role RPCs match the daemon's encoding
    Given the Rust golden vectors for an Option<String> reply and for String plus Option<String> arguments
    When the codec decodes a get_session_role reply and encodes set_session_role arguments
    Then they match the golden vectors at variant indices 44 and 45
