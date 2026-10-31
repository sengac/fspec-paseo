# AST Research — FSPEC-005 "Drive the fspec session lifecycle from Paseo"

Performed with AstGrep (language=typescript) over the fspec-paseo repository.
Purpose: identify the existing surfaces the session-lifecycle module (planned
server/session.ts) must integrate with, and confirm conventions (ESM, strict TS,
admission validation, close semantics).

## 1. server/provider.ts — the connection scaffold the lifecycle extends

Top-level functions (AstGrep `function $NAME($$$ARGS): $RET { $$$BODY }`):

- `createFspecProvider(): ProviderRegistration` (provider.ts:20)
  - Returns the registration object (id `fspec`, label, description, icon, `status()`, `connect()`).
  - `connect(request)` validates `request.versions.includes(1)` (provider.ts:33, throws otherwise)
    and negotiates capabilities via `negotiateProviderCapabilities(request.capabilities, capabilities)`
    before returning `createConnection(negotiated)`.
- `createConnection(capabilities: readonly string[]): ProviderConnection` (provider.ts:42)
  - Owns `let closed = false`, `const listeners = new Set<(event: ProviderEvent) => void>()`,
    and `const sessions = new Set<string>()`.
  - `send(input)` guards on `closed` (provider.ts:59 throws "fspec provider connection is closed")
    then delegates to `validateAdmission(input)`.
  - `close()` is idempotent via the `closed` flag; it clears `sessions` and `listeners`
    (provider.ts:73-74: `sessions.clear()`, `listeners.clear()`).
- `validateAdmission(input: ProviderInput): void` (provider.ts:47)
  - For any input with a `sessionId`: throws `Unknown session: ${input.sessionId}` if the id is
    not in `sessions` (provider.ts:49). This is the exact admission hook the lifecycle must extend:
    rule 9 (unknown/closed session rejection) already partially lives here and must be preserved.

Integration note: the scaffold currently advertises NO capabilities (`capabilities = []`).
FSPEC-004 (provider registration/catalog) and FSPEC-005 (session lifecycle) will replace
`createConnection`'s stub with the real session-owning connection; `status()`/`connect()`
admission and version checks stay.

## 2. server/bincode.ts — FSPEC-002 codec foundation (present on disk)

Exports (grep `^export`):
- `class WireDecodeError extends Error` (bincode.ts:8) — the descriptive-error type used for
  bad variant indices / length prefixes / out-of-bounds reads (matches FSPEC-002 scenarios 4-5).
- `class BincodeReader` (bincode.ts:10) — focused LE reader; internal bounds checks confirmed at
  lines 27 (`this.pos + n > this.buf.length`), 69/83 (`n < 0 || n > this.remaining`), 110
  (option tag `v !== 0 && v !== 1`), 149 (`Number.isSafeInteger` + non-negative u64 check).
- `class BincodeWriter` (bincode.ts:124) — mirror writer.

The FSPEC-005 lifecycle module will NOT touch BincodeReader/BincodeWriter directly; it consumes
the FSPEC-002 public surface in server/wire.ts (encode/decode Envelope, tarpc request/response
frames, FspecMethodIndex — expected to land with FSPEC-002's implementing phase).

## 3. test/ — red-phase test layout

- test/scaffold.test.ts (FSPEC-001, green) — loads the contribution via `contribute()` from
  index.server.ts, asserts registration + placeholder status + clean close.
- test/wire.test.ts (FSPEC-002, currently RED) — loads hex golden vectors from
  test/golden/golden-vectors.txt (11 vectors: 9 Envelope variants + CreateSession request/response
  frames) and asserts byte-exact encoding via `wire.encodeEnvelope` / `wire.encodeRequestFrame`
  / `wire.decodeResponseFrame` and `wire.FspecMethodIndex.createSession === 3`.
  This file defines the exact wire.ts public API the lifecycle will rely on:
  - Envelope variants as tagged objects: `{kind:"rpc", frame}`, `{kind:"event", sessionId, chunk}`,
    `{kind:"workUnitsUpdate", workUnits}`, `{kind:"sessionSnapshot", sessions}`, ...
  - `encodeEnvelope(value)`, `decodeEnvelope(bytes)`
  - `encodeRequestFrame({deadlineMs, id, message})`, `decodeResponseFrame(bytes)` returning
    `{requestId, ok, ...}`
  - Method payloads as tagged unions: `{method:"createSession", role}`, ...
  - `FspecMethodIndex` constant mapping method names to trait positions.

## 4. Conventions confirmed

- ESM everywhere (`.js` import specifiers, `import.meta.url` for fixture paths).
- Tests use vitest; every Gherkin step gets a `// @step <exact line>` comment.
- `@getpaseo/plugin/server/provider` supplies `ProviderConnection`, `ProviderInput`,
  `ProviderEvent`, `ProviderRegistration`, `ProviderEventSchema`, `negotiateProviderCapabilities`.
- No real daemon / no external network in tests — stub transports only (per FSPEC-002/003 rules).

## 5. Implications for FSPEC-005 implementation

- The lifecycle connection must keep the `closed`/`listeners`/`sessions` idiom so that
  connection.close() can destroy every mapped daemon session (rule 10) and emit nothing after close.
- Unknown-session admission (rule 9) extends `validateAdmission`: prompt (no requestId) throws
  synchronously; request-id inputs answer `request.failed`; `session.close` of an unknown id still
  answers `request.completed` (rule 7 no-op path).
- Turn settlement (rules 4, 5) is a per-turnId `Map<string, "active"|"settled">` fed by the
  daemon's terminal StreamChunks (Done/Error/Interrupted/InterruptedWithReason); duplicates ignored.
- ProviderPersistence `{version:1, data:{sessionId, model?, thinkingOption?}}` (contract §6.2)
  carries the mapped daemon SessionId so reopens (Paseo refresh) resume instead of recreating.
