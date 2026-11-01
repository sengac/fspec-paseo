@done
@provider
@core
@FSPEC-004
@FSPEC-055
Feature: Register the fspec provider and build Paseo's model picker

  """
  Boundary: applying a chosen model/thinking level to a LIVE session (set_session_model idx 29, set_thinking_level idx 39, session.configure) is FSPEC-005, NOT here. FSPEC-004 only builds the pre-session catalog (list_providers idx 28) and the availability probe. Wire shapes: ProviderInfo/ModelEntry/ThinkingLevel per docs/fspec-wire-protocol.md §6.7; catalog/picker contract per docs/paseo-provider-contract.md §3.3 + §6.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. The provider descriptor registered by the contribution function has id `fspec` and label `fspec`, declares no `command`, and its availability comes from `status()` (connection-based), per the FSPEC-001 scaffold contract.
  #   2. status() reflects REAL daemon availability by probing through the FSPEC-003 daemon client: when the daemon is reachable it returns { available: true }; when unreachable it returns { available: false, diagnostic } where the diagnostic names the missing piece (e.g. 'no fspec daemon reachable' / 'no daemon.json found ... start fspec daemon first'), never a bare boolean with no guidance.
  #   3. The catalog for a `catalog` input is built from the daemon's `list_providers` RPC (idx 28, returns Vec<ProviderInfo>): each ProviderInfo becomes one group of models; each ModelEntry becomes a ProviderModel with id = `<provider.key>/<entry.id>`, label = entry.display_name, contextWindowMaxTokens = entry.context_window. Model ids map 1:1 into Paseo catalog ids — no renaming or derivation beyond the key/entry.id join.
  #   4. The model picker catalog is built from the daemon's list_providers RPC (FspecMethodIndex 28) via the FSPEC-003 daemon client; the provider's catalog input handler replies with exactly one catalog event carrying the requested requestId
  #   5. Providers flagged `is_unreachable: true` in the daemon's `list_providers` response are excluded from the catalog (their models are not offered as selectable); a provider with zero reachable providers yields an empty model list, not an error.
  #   6. Thinking levels are GLOBAL on the wire (ThinkingLevel: Off=0, Low=1, Medium=2, High=3, default Off) not per-model, so the catalog publishes them once at catalog level: thinkingOptions = [{id:'off'},{id:'low'},{id:'medium'},{id:'high'}] with defaultThinkingOption = 'off'; models carry no per-model thinkingOptions.
  #   7. Default selection: the first model entry of the first reachable provider is marked isDefault and set as defaultModel in the catalog; the global defaultThinkingOption is 'off' (ThinkingLevel #[default] Off). When get_thinking_level is unavailable, 'off' is used and no per-model defaultThinkingOptionId is emitted
  #   8. When the daemon is unreachable the catalog input rejects with a diagnostic error naming the missing piece (e.g. 'no daemon.json found at <path> — start fspec daemon first'); it never returns a fabricated/empty catalog for an unreachable daemon. Availability probing (status()) and catalog fetch both go through the same FSPEC-003 daemon client
  #   9. Availability is NOT polled by the plugin: status() is a point-in-time probe through the FSPEC-003 client; availability changes are driven by the connection state, never by a background timer/poll loop inside the provider
  #   10. Default selection is never invented: the documented wire surface (verified commit 626eee1e) exposes only set_default_model (idx 30) — no get_default_model RPC, no default-model.json artifact — so the catalog default is the first model entry of the first reachable provider; when no reachable model exists the catalog carries no defaultModel at all
  #
  # EXAMPLES:
  #   1. list_providers returns [{key:'anthropic', display_name:'Anthropic', is_unreachable:false, models:[{id:'claude-sonnet-4-5', display_name:'Claude Sonnet 4.5', context_window:200000, supports_reasoning:true}, {id:'claude-haiku-4-5', display_name:'Claude Haiku 4.5', context_window:200000, supports_reasoning:false}]}, {key:'openai', display_name:'OpenAI', is_unreachable:true, models:[...]}] — catalog = models [{id:'anthropic/claude-sonnet-4-5', label:'Claude Sonnet 4.5', contextWindowMaxTokens:200000, isDefault:true}, {id:'anthropic/claude-haiku-4-5', label:'Claude Haiku 4.5', contextWindowMaxTokens:200000}] (openai excluded: is_unreachable), defaultModel='anthropic/claude-sonnet-4-5'
  #   2. Catalog reply carries exactly one catalog event: {type:'catalog', requestId:<the one Paseo asked with>, catalog:{models:[...], modes:[], thinkingOptions:[{id:'off',label:'Off'},{id:'low',label:'Low'},{id:'medium',label:'Medium'},{id:'high',label:'High'}], defaultModel:'anthropic/claude-sonnet-4-5', defaultThinkingOption:'off'}} — modes stay empty (fspec exposes no Paseo modes); since FSPEC-055 modes are agent and bot with defaultMode agent
  #   3. No daemon.json exists (~/.fspec/daemon.json missing, no XDG_RUNTIME_DIR override): status() returns {available:false, diagnostic:'no daemon.json found at /Users/me/.fspec/daemon.json — start fspec daemon first'} and a catalog request rejects with the same diagnostic text — Paseo shows the provider greyed out with that message, never a spinner-without-hint
  #
  # ========================================

  Background: User Story
    As a Paseo user running fspec agents
    I want to see fspec as an available provider with a model picker built from the daemon's provider/model catalog
    So that I can choose a model and thinking level before or while working in an fspec session

  Scenario: The fspec provider registers with status-based availability
    Given the fspec-paseo contribution function is loaded by Paseo
    When Paseo inspects the registered provider
    Then a provider with id `fspec` and label `fspec` is registered, declares no `command`, and its availability comes from `status()`


  Scenario: status() reports unavailable with a diagnostic when the daemon is down
    Given no daemon.json exists at the resolved path (no fspec daemon running)
    When Paseo calls the provider's `status()`
    Then it reports `{ available: false, diagnostic: 'no daemon.json found at /Users/me/.fspec/daemon.json — start fspec daemon first' }` naming the missing file and the fix


  Scenario: status() reports available when the daemon is reachable
    Given a live fspec daemon has written a valid daemon.json (port and pid) whose pid is alive
    When Paseo calls the provider's `status()`
    Then it reports `{ available: true }` so Paseo offers fspec sessions


  Scenario: The model picker catalog maps the daemon's provider catalog
    Given the daemon's `list_providers` returns a reachable `anthropic` provider with models `claude-sonnet-4-5` (display_name 'Claude Sonnet 4.5', context_window 200000, supports_reasoning true) and `claude-haiku-4-5` (display_name 'Claude Haiku 4.5', context_window 200000) plus an `openai` provider flagged `is_unreachable`
    When Paseo requests the model catalog with a requestId
    Then it replies with exactly one catalog event carrying the requested requestId and models `{id:'anthropic/claude-sonnet-4-5', label:'Claude Sonnet 4.5', contextWindowMaxTokens:200000, isDefault:true}` and `{id:'anthropic/claude-haiku-4-5', label:'Claude Haiku 4.5', contextWindowMaxTokens:200000}`
    And no openai models appear in the catalog because the provider is `is_unreachable`
    And the catalog lists the agent and bot `modes`, `thinkingOptions` = off/low/medium/high, `defaultModel` = 'anthropic/claude-sonnet-4-5', and `defaultThinkingOption` = 'off'


  Scenario: A catalog request fails with a diagnostic when no daemon is reachable
    Given no daemon.json exists at the resolved path (no fspec daemon running)
    When Paseo requests the model catalog with a requestId
    Then the catalog input rejects with `request.failed` for that requestId and an error diagnostic naming the missing piece, e.g. 'no daemon.json found at /Users/me/.fspec/daemon.json — start fspec daemon first'
    And no catalog event is emitted and no model is invented


  Scenario: An unreachable daemon yields no default model
    Given a live fspec daemon whose `list_providers` returns only providers flagged `is_unreachable`
    When Paseo requests the model catalog with a requestId
    Then it replies with exactly one catalog event whose `models` list is empty and which carries no `defaultModel`
    And the catalog still lists the agent and bot `modes`, the off/low/medium/high `thinkingOptions`, and `defaultThinkingOption` = 'off'


  Scenario: Availability is probe-driven, not polled
    Given a live fspec daemon is reachable and a second status() probe later finds no daemon.json (the daemon stopped)
    When Paseo calls the provider's `status()` at each point in time
    Then each call reflects only the daemon state observed during that probe, reporting `{ available: true }` while reachable and `{ available: false }` with a diagnostic once it is not
    And the provider runs no background timer or polling loop between calls


  Scenario: The catalog is empty but not an error when no provider is reachable
    Given the daemon is reachable but its `list_providers` returns only providers flagged `is_unreachable`
    When Paseo requests the model catalog with a requestId
    Then it replies with a valid catalog event whose `models` is `[]` and no `defaultModel` — Paseo shows an empty picker, not an error

