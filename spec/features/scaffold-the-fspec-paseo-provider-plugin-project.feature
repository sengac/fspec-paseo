@done
@provider
@core
@FSPEC-001
Feature: Scaffold the fspec Paseo provider plugin project
  """
  Standalone ESM TypeScript plugin: paseo-plugin.json manifest (id `fspec-paseo-provider`, requirements.paseo >=0.13.0 since the FSPEC-035 board panel), default-exported contribute() in index.server.ts (and index.client.tsx since FSPEC-035), runtime code under server/, shared/ and client/. The provider registration declares id `fspec`, no `command`, and a placeholder status() that reports unavailable. Host types come from the published @getpaseo/plugin package (devDependency); vitest is the test runner. docs/ holds the two research specs (paseo-provider-contract.md, fspec-wire-protocol.md) that later stories implement against.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. The project is a standalone Paseo plugin (not an in-repo builtin): it ships a paseo-plugin.json manifest, a default-exported index.server.ts contribution function, and a server/ directory for runtime code. It is installable via `paseo plugin install /abs/path`.
  #   2. The plugin registers a provider with id `fspec` and label `fspec`. It declares NO `command` (it does not spawn an executable - it attaches to an already-running daemon), so its availability comes from its `status()` method, not from command resolution.
  #   3. package.json declares only devDependencies (typescript, vitest, @types/node, @getpaseo/plugin, zod) - Paseo supplies the host runtime at load time. It lists a `files` field covering paseo-plugin.json, index.server.ts, server/, and icon.svg.
  #   4. The scaffold's provider `connect()` returns a minimal ProviderConnection (version 1, an empty-negotiated capability list, a `send()` that rejects unknown session ids, an `onEvent` that registers a listener, and a no-op `close()`) so the plugin is loadable and testable before protocol behaviour exists. It advertises no capabilities yet - those are added by later stories.
  #
  # EXAMPLES:
  #   1. The developer installs the plugin into a Paseo daemon with `paseo plugin install <path>` and it appears in the plugin list as a provider named `fspec`.
  #   2. Paseo calls the provider's `status()` and the scaffold reports `{ available: false, diagnostic: 'no fspec daemon reachable' }` because no daemon connection logic exists yet.
  #   3. The developer runs the project's test suite and a test proves the contribution function registers a provider and that a connected session can be closed cleanly.
  #
  # ========================================
  Background: User Story
    As a the fspec-paseo developer
    I want to have a loadable Paseo provider plugin project scaffolded
    So that every later story lands in a real repo with a test harness that proves the plugin loads and registers a provider

  Scenario: Plugin installs and registers the fspec provider
    Given the project ships paseo-plugin.json, index.server.ts, and a provider registration
    When the developer installs the plugin into a Paseo daemon with `paseo plugin install <path>`
    Then the plugin appears in the plugin list and registers a provider with id `fspec` and label `fspec`
    And the provider declares no `command`

  Scenario: Scaffold reports unavailable with a diagnostic
    Given no fspec daemon is reachable (the provider is pointed at an empty daemons directory)
    When Paseo calls the provider's `status()`
    Then the provider reports `{ available: false }` with a user-actionable diagnostic naming the missing piece (e.g. 'no fspec daemon reachable' or 'no fspec daemon is running ... start fspec daemon first')

  Scenario: Scaffold registers a provider and closes a connected session cleanly
    Given the scaffold's test harness loads the contribution function
    When the harness connects to the provider and closes the resulting session
    Then the provider was registered by the contribution function
    And the connection close resolves without error
