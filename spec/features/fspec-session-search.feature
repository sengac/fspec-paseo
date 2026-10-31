@done
@core
@provider
@FSPEC-032
Feature: Find fspec sessions in Paseo's import list by their conversation text

  """
  server/wire.ts: persistenceSearchHistory (26) { query: String } -> Result<Vec<HistoryMatch { session_id, text, timestamp_iso }>, String>. server/session.ts list(). Paseo agent-manager.ts matchesImportableSessionQuery filters on title/firstPromptPreview/lastPromptPreview/cwd basename; plugin-provider.ts maps description -> lastPromptPreview.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. With a non-empty query the provider calls persistence_search_history (idx 26) for the workspace and lists every persisted session whose id appears in a match, as well as sessions whose name or id contains the query
  #   2. Paseo re-filters provider results on title, prompt previews and cwd basename, so a session found by prompt text carries its most recent matching prompt (trimmed, at most 200 characters) as its description
  #   3. Only sessions listSessions returns for the workspace (and not already open) are listed; matches for other session ids are ignored
  #   4. If persistence_search_history fails the list falls back to name/id matching; an empty query lists as before
  #
  # EXAMPLES:
  #   1. Session 'Refactor terminal' (sess-7) had the prompt 'port the VTCode diff view'; searching 'vtcode' lists sess-7 with description 'port the VTCode diff view'
  #   2. Searching 'refactor' still lists sess-7 by its name with the usual '<n> messages' description
  #   3. persistence_search_history returns an error: searching 'refactor' still lists sess-7 by name
  #   4. A history match for a deleted session sess-99 that listSessions no longer returns is not listed
  #
  # ASSUMPTIONS:
  #   1. fspec's history search covers the prompts the user typed, not agent replies; searching replies would mean paging every transcript and is out of scope
  #
  # ========================================

  Background: User Story
    As a Paseo user importing fspec sessions
    I want to find a past fspec session by searching for something I said in it
    So that I can resume the right session without remembering its name

  Scenario: A session is found by text from one of its prompts
    Given a persisted fspec session "sess-7" named "Refactor terminal" whose prompt history includes "port the VTCode diff view"
    When Paseo lists importable sessions with query "vtcode"
    Then the provider called persistence_search_history with "vtcode"
    And it listed "sess-7" with description "port the VTCode diff view"


  Scenario: A session is still found by its name
    Given a persisted fspec session "sess-7" named "Refactor terminal" with 4 messages
    When Paseo lists importable sessions with query "refactor"
    Then it listed "sess-7" with the usual description "4 messages · anthropic/claude"


  Scenario: A failed history search falls back to name matching
    Given a persisted fspec session "sess-7" named "Refactor terminal" and persistence_search_history fails
    When Paseo lists importable sessions with query "refactor"
    Then it listed "sess-7"


  Scenario: History matches for sessions no longer listed are ignored
    Given persistence_search_history matches deleted session "sess-99" that listSessions does not return
    When Paseo lists importable sessions with query "vtcode"
    Then it listed no sessions
