# AST research — FSPEC-004 (provider registration + model picker)

Discovery analysis of the existing scaffold (read-only) to ground the FSPEC-004 spec.
Sources: `server/provider.ts`, `index.server.ts`, `test/scaffold.test.ts`, plus
`docs/paseo-provider-contract.md` §2–§3.3/§6 and `docs/fspec-wire-protocol.md` §5.1/§6.7.

## Entry point — `index.server.ts`
- `contribute(server)` default export → `server.registerProvider(createFspecProvider())`.
- The contribution function is the only connection point between the scaffold and Paseo's host.
  FSPEC-004 must keep this shape; it changes WHAT the registration object reports, not HOW it is registered.

## `server/provider.ts` (scaffold, FSPEC-001)
- `createFspecProvider(): ProviderRegistration` — exported factory; returns
  `{ id: "fspec", label: "fspec", description, icon: "icon.svg", status(), connect() }`.
  - `status()` (line 26): placeholder `async () => ({ available: false, diagnostic: "no fspec daemon reachable" })`.
    → FSPEC-004 replaces the placeholder body with a real FSPEC-003 daemon-client probe; signature stays `status()`.
  - `connect(request)` (line 32): version-1 check + `negotiateProviderCapabilities(request.capabilities, capabilities)`
    where `capabilities = [] as const` (line 11).
    → FSPEC-004 must add the catalog capability (the `catalog` input type) so `send({type:"catalog"})` is admitted,
    and handle `input.type === "catalog"` in `send()` by emitting exactly one `{type:"catalog", requestId, catalog}` event.
- `createConnection(capabilities)` (line 42): closure over `closed`, `listeners`, `sessions` (Set<string>).
  - `validateAdmission(input)` (line 47): throws `Unknown session: ${id}` for `"sessionId" in input` not in `sessions`.
    → `catalog` inputs have no sessionId; they must pass admission.
  - `send(input)` (line 58): closed-check + admission only today; no event emission.
  - `onEvent` / `close` are the event-channel API the catalog reply must use.

## Types (from `@getpaseo/plugin/server/provider`, verified in docs/paseo-provider-contract.md §2.2/§3.3)
- `ProviderRegistration`: descriptor fields + optional `status(launch)`, `connect(request)`, `onError`.
- `ProviderInput` is a discriminated union; `type: "catalog"` carries `{ requestId }`.
- `ProviderEvent` includes `{ type: "catalog", requestId, catalog: ProviderCatalog }`.
- `ProviderCatalog`: `{ models: ProviderModel[], modes: ProviderMode[], thinkingOptions?, defaultModel?, defaultMode?, defaultThinkingOption? }`.
- `ProviderModel`: `{ id, aliases?, isSelectable?, label, description?, isDefault?, metadata?, contextWindowMaxTokens?, thinkingOptions?, defaultThinkingOptionId? }`.
- `ProviderStatus` (scaffold usage): `{ available: boolean, diagnostic?: string }`.

## Wire inputs (docs/fspec-wire-protocol.md — consumed by FSPEC-003, read here for shapes)
- `list_providers` = FspecServiceRequest variant idx 28 → `Vec<ProviderInfo>`;
  `ProviderInfo { key, display_name, models: Vec<ModelEntry>, profile_name, is_unreachable }` (§6.7).
- `ModelEntry { id, display_name, context_window: u32, supports_reasoning, supports_vision, is_custom }`.
- `ThinkingLevel { Off=0, Low=1, Medium=2, High=3 }` (global; §6.7 note: levels are global, not per-model).
- daemon.json resolution: `$XDG_RUNTIME_DIR/fspec/daemon.json` else `~/.fspec/daemon.json`;
  missing → `"no daemon.json found at <path> — start 'fspec daemon' first"`; dead pid → stale-removed variant.

## Conclusions for FSPEC-004 spec
1. Registration surface unchanged (id `fspec`, no `command`); `status()` body swaps from placeholder to daemon probe.
2. Catalog mapping: `ProviderInfo → models[]` with `id = provider.key + '/' + entry.id`, `label = display_name`,
   `contextWindowMaxTokens = context_window`; `is_unreachable` providers dropped; first reachable provider's
   first model = `defaultModel` + `isDefault`; `modes: []`; global `thinkingOptions` off/low/medium/high, `defaultThinkingOption = 'off'`.
3. `send()` gains a `catalog` branch emitting one catalog event; unreachable daemon → reject with the daemon-client diagnostic.
4. Scaffold tests (test/scaffold.test.ts lines 59–98) pin `status()` returning `{available:false, diagnostic:'no fspec daemon reachable'}`
   and `capabilities: []` — FSPEC-004's testing phase updates these expectations (they belong to this work unit, not FSPEC-001's contract).
