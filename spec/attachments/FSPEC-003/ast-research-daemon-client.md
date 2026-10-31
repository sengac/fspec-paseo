# AST research — FSPEC-003 Discover and connect to the fspec daemon

Date: 2026-10-30. Tool: AstGrep / Grep over `server/` (this repo) and
`fspec/rust` (the daemon side, verified source).

## 1. What already exists here (the surface the client must build on)

`AstGrep(language="typescript", pattern="export function $NAME($$$ARGS): $RET { $$$BODY }", path="server/")`

```
server/wire.ts:918   export function encodeEnvelope(envelope: Envelope): Uint8Array
server/wire.ts:962   export function decodeEnvelope(bytes: Uint8Array): Envelope
server/wire.ts:1006  export function envelopeVariantIndex(envelope: Envelope): number
server/wire.ts:1194  export function encodeRequestFrame(input: {...}): Uint8Array
server/wire.ts:1208  export function decodeRequestFrame(bytes: Uint8Array): TarpcRequestFrame
server/wire.ts:1223  export function encodeResponseFrame(input: {...}): Uint8Array
server/wire.ts:1265  export function decodeResponseFrame(bytes: Uint8Array): DecodedResponse
server/wire.ts:1334  export function encodeRpcEnvelope(frame: Uint8Array): Uint8Array
server/provider.ts:20 export function createFspecProvider(): ProviderRegistration
```

Conclusion: the FSPEC-002 codec is complete and exposes exactly the surface the
FSPEC-003 assumptions demand — encode/decode of an Envelope and of tarpc
request/response frames. **No bincode logic belongs in the daemon client.**
`server/provider.ts` still carries the FSPEC-001 placeholder `status()`
(`available: false, "no fspec daemon reachable"`) — that is what FSPEC-003's
`status()` replaces, and what FSPEC-004 consumes.

## 2. The Rust side the client must mirror

`AstGrep(language="rust", pattern="pub fn $NAME($$$ARGS) { $$$BODY }", path="rust/fspec/src")`
plus targeted Grep:

```
rust/fspec/src/common.rs:327 pub fn daemon_json_path() -> Result<PathBuf>
rust/fspec/src/common.rs:411 pub fn remove_daemon_json(path: &Path)
rust/fspec/src/common.rs:615 pub fn read_and_verify_daemon_json(path: &Path) -> Result<DaemonHandshake>
```

`daemon_json_path` is the single resolution the daemon and the client share:
`$XDG_RUNTIME_DIR/fspec/daemon.json` when XDG_RUNTIME_DIR is set and non-empty,
otherwise `~/.fspec/daemon.json`. `remove_daemon_json` confirms the stale-file
deletion behaviour rule 2 relies on. `read_and_verify_daemon_json` is the
verification the client duplicates (port u16 + pid u32 required, `kill(pid,0)`
liveness with EPERM counted alive, delete + specific error when dead).

## 3. Consequences for the implementation

- New module `server/daemon.ts`: target resolution (explicit URL → env
  `FSPEC_DAEMON_URL` → daemon.json), loopback validation BEFORE any socket,
  `status()` as a socket-free probe, `connect()` as WS open + handshake
  (WorkUnitsUpdate then SessionSnapshot), connection-lost teardown, idempotent
  `close()`.
- The WebSocket transport must be injectable (default: Node global `WebSocket`)
  so the suite runs without a real daemon — the assumption in the feature file.
- Frames ride binary WS messages only; text frames are ignored by the daemon.
  The client decodes every frame through `decodeEnvelope` and must tolerate the
  server-pushed variants it does not use (already handled by the codec).
- No auto-reconnect: availability changes are re-probed by `status()`/`connect()`.
