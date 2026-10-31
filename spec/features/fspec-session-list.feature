@done
@core
@provider
@FSPEC-022
Feature: List and import fspec sessions in Paseo

  """
  server/session.ts list() answers 'sessions' from list_sessions (idx 1) for the daemon workspace; provider.ts advertises session.list.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. The provider advertises 'session.list' and answers a 'sessions' input with exactly one 'sessions' event for its requestId, built from list_sessions (idx 1) for the daemon's workspace (get_workspace_info)
  #   2. Each fspec session becomes { persistence: { version: 1, data: { sessionId } }, cwd: the daemon workspace, title: the session name, description: '<n> messages' plus the model when known, updatedAt: ISO time of updated_at_ms when present }, newest first
  #   3. Sessions already open on this connection are left out; a query keeps sessions whose name or id contains it (case-insensitive); limit caps the count
  #   4. A cwd outside the daemon's workspace yields an empty list, because that daemon cannot open sessions there (FSPEC-015)
  #   5. Importing a listed session is a normal session.open with that persistence, which resumes it (FSPEC-009) and can replay its history (FSPEC-006/013)
  #
  # EXAMPLES:
  #   1. list_sessions returns 'Fix login' (12 messages, anthropic/claude, updated 2026-10-30T08:00Z) and 'Spike' (3 messages, updated 2026-10-30) -> sessions [Fix login, Spike] with persistence data.sessionId of each
  #   2. Query 'login' -> only 'Fix login'; limit 1 -> only the newest
  #   3. Paseo asks with cwd /repos/other while the daemon serves /repos/fspec -> sessions []
  #
  # ========================================

  Background: User Story
    As a Paseo user with past fspec sessions
    I want to browse and import fspec sessions from Paseo's session list
    So that work started in the fspec TUI or an earlier Paseo agent can be continued in Paseo

  Scenario: Paseo lists the daemon's fspec sessions newest first
    Given list_sessions for the daemon workspace returns "Fix login" (12 messages, updated 2026-10-30) and "Spike" (3 messages, updated 2026-10-30)
    When Paseo sends a sessions request
    Then the provider replied with one sessions event listing "Fix login" then "Spike" with their persistence, cwd, description and updatedAt


  Scenario: Query, limit and open sessions narrow the list
    Given list_sessions returns "Fix login", "Spike" and the session already open as "paseo-1"
    When Paseo sends a sessions request with query "login" and limit 1
    Then the reply lists only "Fix login"


  Scenario: A directory the daemon does not serve lists nothing
    Given the daemon serves workspace "/work"
    When Paseo sends a sessions request with cwd "/elsewhere"
    Then the reply lists no sessions and list_sessions was not called


  Scenario: Importing a listed session resumes it
    Given a listed session with persistence data.sessionId "fspec-old-1"
    When Paseo opens it with that persistence
    Then the provider resumed "fspec-old-1" and reached session.ready

