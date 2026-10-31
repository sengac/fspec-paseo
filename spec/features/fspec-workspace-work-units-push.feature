@done
@core
@provider
@FSPEC-049
Feature: Decode fspec's WorkspaceWorkUnitsUpdate envelope instead of dropping it
  """
  server/wire.ts: WorkspaceWorkUnitsUpdateEnvelope { kind: 'workspaceWorkUnitsUpdate', workspace, units }, ENVELOPE_NAMES/envelopeVariantIndex/encode/decode gain index 9 (fspec rust/rpc-server/src/envelope.rs; rpc-types chrome.rs WorkspaceWorkUnits). The daemon fans it out to every full-surface connection (rpc-server/src/server/connection_fanouts.rs -> workspace_fanout.rs), only for workspaces opened besides the start workspace (the start workspace keeps WorkUnitsUpdate). server/board.ts ignores it for now; FSPEC-053 serves those workspaces' boards.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. The codec decodes and encodes Envelope variant index 9 WorkspaceWorkUnitsUpdate(WorkspaceWorkUnits { workspace: String, units: Vec<WorkUnitInfo> }) byte-exactly; only indices 10 and above are unknown
  #   2. The daemon client hands a WorkspaceWorkUnitsUpdate push to its envelope listeners like any other push; it is never dropped as undecodable
  #   3. Consumers that do not use workspace pushes ignore them: the provider's sessions are untouched and the board of the daemon's start workspace keeps its units and revision
  #
  # EXAMPLES:
  #   1. Golden vector: Envelope 09000000 + 02000000000000002f770000000000000000 decodes to { kind: workspaceWorkUnitsUpdate, workspace: '/w', units: [] } and encodes back to the same bytes
  #   2. The board of /work is at revision r; the daemon pushes WorkspaceWorkUnitsUpdate for /other with one unit; a held watch for /work keeps holding and its next answer still shows /work's units
  #
  # ========================================
  Background: User Story
    As a Paseo user whose fspec daemon serves several workspaces
    I want the plugin to understand the daemon's work-unit pushes for its other workspaces
    So that those pushes reach the plugin instead of being thrown away as undecodable frames

  Scenario: The WorkspaceWorkUnitsUpdate envelope matches the daemon's encoding
    Given the Rust golden vector for Envelope index 9 carrying WorkspaceWorkUnits for workspace "/w" with no units
    When the codec decodes it and encodes the decoded value
    Then it decodes to a workspaceWorkUnitsUpdate envelope for "/w" with no units at variant index 9
    And the encoded bytes match the golden vector exactly

  Scenario: The daemon client delivers a workspace push to its listeners
    Given an established daemon connection with an envelope listener
    When the daemon pushes WorkspaceWorkUnitsUpdate for "/other" with work unit "OTHER-001"
    Then the listener receives that push with workspace "/other" and work unit "OTHER-001"

  Scenario: A push for another workspace leaves the start workspace's board alone
    Given the board of "/work" is held at its current revision showing "FSPEC-001"
    When the daemon pushes WorkspaceWorkUnitsUpdate for "/other" with work unit "OTHER-001"
    Then the held watch is still waiting
    And the next board for "/work" still shows only "FSPEC-001" at the same revision
