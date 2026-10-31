# AST Research — FSPEC-002 wire codec

## Target module layout (to be created)
- `server/bincode.ts` — focused LE reader/writer (u8/u16/u32/u64/u128 fixed-width, u64-LE length prefixes, 1-byte Option tag, u32-LE enum variant index, trailing bytes allowed)
- `server/wire.ts` — public surface: Envelope encode/decode (9 variants), tarpc request/response encode/decode, FspecService payloads for the 12 plugin-used methods

## Existing codebase integration points (AstGrep: function declarations in server/)
- `server/provider.ts` — `createFspecProvider()` (scaffold), `createConnection(capabilities)` — FSPEC-003 will import the wire codec here; no bincode logic may leak into it.
- No existing bincode/wire modules in `server/` (zero function-declaration matches for a codec — clean slate confirmed).

## Rust source of truth (verified at commit 626eee1e)
- `rust/rpc/src/lib.rs:68-716` — `#[tarpc::service] pub trait FspecService` — 123 async fns, indices 0-122; request variant = struct variant (params in order), response variant = tuple variant (return type); camelCase names.
- `rust/rpc-server/src/envelope.rs:37` — `pub enum Envelope` — 9 variants: Rpc=0, Event=1, LogEvent=2, WorkUnitsUpdate=3, StatusUpdate=4, CmdReq=5, CmdRes=6, SessionEvent=7, SessionSnapshot=8.
- Payload types in `rust/rpc-types/src/` (SessionId = struct{value: String} — u64 len + bytes; WorkUnitFocus = struct{revision: u64, context: Option<WorkUnitContext>, source: String}).

## Golden-vector strategy (rule 5)
Scratch crate `/tmp/fspec-golden`: bincode 1.3.3 + tarpc 0.34 (full) + codelet-rpc-types (path dep). Copies the FspecService trait VERBATIM and applies `#[tarpc::service]` so the macro regenerates the identical 123-variant enums (zero hand-mirror drift). Context deadline set in the past → Duration::ZERO (clamped) so 40-byte context is byte-deterministic.

## Verified tarpc 0.34.0 details (registry source read)
- `context.rs:42-62` — deadline serialized via `absolute_to_relative_time`: `duration_since(now).unwrap_or(ZERO)` → past deadline = `Duration::ZERO` (12 bytes: u64 secs + u32 nanos, all zero).
- `trace.rs:34-77` — trace::Context{trace_id: TraceId(u128 via u128_serde = 16 LE bytes), span_id: SpanId(u64), sampling_decision: u32 index (Sampled=0, Unsampled=1)}.
- Default Context = 12+16+8+4 = 40 bytes.
- `tarpc-plugins-0.13.1/src/lib.rs:466-488` — request enum = struct variants `{ args }` (zero-arg methods → empty struct variant, serializes as index only); response enum = tuple variants `(return_type)`.
- tarpc "full" feature includes serde1 (derives present on generated enums).

## Envelope wire table (bincode fixint LE)
| Variant | Index | Payload |
|---|---|---|
| Rpc | 00 00 00 00 | u64-LE len + raw bytes (inner = bincode tarpc message) |
| Event | 01 00 00 00 | SessionId + StreamChunk |
| LogEvent | 02 00 00 00 | LogRecord{level, target, message, timestamp_ms: i64} |
| WorkUnitsUpdate | 03 00 00 00 | Vec<WorkUnitInfo> |
| StatusUpdate | 04 00 00 00 | SessionId + SessionStatus(u32 0-5) |
| CmdReq | 05 00 00 00 | unit |
| CmdRes | 06 00 00 00 | unit |
| SessionEvent | 07 00 00 00 | SessionEvent |
| SessionSnapshot | 08 00 00 00 | Vec<SessionInfo> |

## tarpc framing inside Envelope::Rpc
Request: `00 00 00 00` (ClientMessage::Request) + context(40B) + id(u64) + FspecServiceRequest.
Response: request_id(u64) + Result tag (00=Err ServerError, 01=Ok) + FspecServiceResponse payload.

## 12 plugin-used methods (index: name(args) -> return)
3 CreateSession{role: Option<String>} -> SessionId
4 SendInput{session_id: SessionId, text: String} -> ()
5 Interrupt{session_id: SessionId} -> ()
6 GetSessionStatus{session_id: SessionId} -> SessionStatus
7 Health{} -> HealthInfo
20 GetModelInfo{session_id: SessionId} -> ModelInfo
21 GetThinkingLevel{session_id: SessionId} -> ThinkingLevel
28 ListProviders{} -> Vec<ProviderInfo>
29 SetSessionModel{session_id: SessionId, provider_id: String, model_id: String} -> Result<(), String>
39 SetThinkingLevel{session_id: SessionId, level: ThinkingLevel} -> Result<(), String>
46 SendInputWithThinking{session_id: SessionId, text: String, thinking: Option<ThinkingConfig>} -> ()
87 DestroySession{session_id: SessionId} -> Result<(), String>
