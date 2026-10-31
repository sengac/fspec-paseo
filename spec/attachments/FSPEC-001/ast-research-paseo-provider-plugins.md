# AST Research — Paseo provider plugin reference templates (FSPEC-001)

Date: 2026-10-30. Scope: `paseo/plugins` and
`paseo/plugin-examples`. Purpose: confirm the concrete
code shape the fspec-paseo scaffold must mirror (registration entry, provider
registration factory, connection object, admission validation).

## Query 1 — server entry contribution functions (all plugins)

Pattern: `export default function $NAME($$$ARGS) { $$$BODY }`
Language: typescript. Path: `paseo/plugins`.

Results (13 matches) — every plugin exposes a `contribute` default export:

```
plugins/cursor-usage-source/index.server.ts:5:export default function contribute(server: PluginServerContext) {
plugins/grok-usage-source/index.server.ts:5:export default function contribute(server: PluginServerContext) {
plugins/muse-provider/index.server.ts:6:export default function contribute(
plugins/kimi-usage-source/index.server.ts:5:export default function contribute(server: PluginServerContext) {
plugins/codex-usage-source/index.server.ts:5:export default function contribute(server: PluginServerContext) {
plugins/worktree-include/index.server.ts:4:export default function contribute(server: PluginServerContext) {
plugins/hoplite-provider/index.server.ts:4:export default function contribute(server: PluginServerContext) {
plugins/zai-usage-source/index.server.ts:5:export default function contribute(server: PluginServerContext) {
plugins/antigravity-provider/index.server.ts:4:export default function contribute(server: PluginServerContext) {
plugins/copilot-usage-source/index.server.ts:5:export default function contribute(server: PluginServerContext) {
plugins/minimax-usage-source/index.server.ts:5:export default function contribute(server: PluginServerContext) {
plugins/opencode-go-usage-source/index.server.ts:5:export default function contribute(server: PluginServerContext) {
plugins/claude-usage-source/index.server.ts:5:export default function contribute(server: PluginServerContext) {
```

Conclusion: `index.server.ts` is a thin wiring module whose default export
calls `server.registerProvider(...)` and returns a cleanup function.

## Query 2 — provider registration factories

Pattern: `export function $NAME($$$ARGS): ProviderRegistration { $$$BODY }`
Path: `paseo/plugins`.

```
plugins/muse-provider/server/provider.ts:32:export function createMuseProvider(usage: Usage): ProviderRegistration {
plugins/hoplite-provider/server/provider.ts:5:export function createHopliteProvider(): ProviderRegistration {
plugins/antigravity-provider/server/provider.ts:23:export function createAntigravityProvider(): ProviderRegistration {
```

Conclusion: the registration object is built by a factory in
`server/provider.ts`, named `create<Name>Provider`.

## Query 3 — direct (non-ACP) reference provider

`plugin-examples/provider-direct/server/provider.ts` (399 lines) is the
template for the fspec plugin shape: a `ProviderRegistration` with `id`,
`label`, `description`, `icon`, `connect()` (version check at line 42,
`negotiateProviderCapabilities` at line 43) and no `command`. The
`createConnection(capabilities)` helper (line 48) returns the
`ProviderConnection` object:

- `version: 1`
- `capabilities` (the negotiated list)
- `send(input)`: throws if `closed`; runs `validateAdmission(input, ...)`
  synchronously, then `queueMicrotask(() => dispatch(input, ...))`
- `onEvent(listener)`: adds to a `Set`, returns an unsubscribe
- `close()`: idempotent (`if (closed) return`), clears sessions + listeners

`validateAdmission` (line 81): `session.open` rejects duplicates + checks
capabilities; any input carrying `sessionId` throws
`` `Unknown session: ${input.sessionId}` `` when the session is not in the
map; other inputs only get a capability check. The dispatch switch (line 108)
covers all `ProviderInput` variants; `session.interrupt` answers with
`request.completed`; `session.close` emits `session.closed` then
`request.completed`.

## Query 4 — hoplite (minimal ACP provider)

`plugins/hoplite-provider/server/provider.ts` line 5 is the minimal real
plugin: `createHopliteProvider()` spreads `runAcpProvider({...})` and adds
`requiresConfiguration: true`. Confirms that the fspec plugin — which is NOT
ACP and needs no `command` — should follow the `provider-direct` example
shape instead.

## Implications for the scaffold (FSPEC-001)

1. `index.server.ts`: default export `contribute(server)` that calls
   `server.registerProvider(createFspecProvider())` and returns `() => {}`.
   Narrow the parameter to
   `Pick<PluginServerContext, "registerProvider">`.
2. `server/provider.ts`: `createFspecProvider(): ProviderRegistration` with
   `id: "fspec"`, `label: "fspec"`, no `command`, a placeholder `status()`
   returning `{ available: false, diagnostic: "no fspec daemon reachable" }`,
   and `connect()` that checks `request.versions.includes(1)` and returns a
   minimal `createConnection(negotiated)` with an empty session map, so
   session-scoped inputs reject with "Unknown session".
3. Test harness mirrors `plugins/*/test/provider.test.ts`: drive the real
   `ProviderRegistration.connect()` with real `ProviderInput`, collect
   `ProviderEvent`s through `onEvent`, parse every event with
   `ProviderEventSchema`.
