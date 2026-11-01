# fspec Wire Protocol — Implementation Spec

Source of truth: `rust/rpc-server/src/{envelope,transport,pump,server,bounded_reads}.rs`,
`rust/rpc/src/lib.rs` (trait), `rust/rpc-types/src/*.rs`, `rust/fspec/src/{daemon,client,common}.rs`,
`rust/fspec-tui/src/transport/websocket.rs`, `rust/fspec/src/common/daemon_registry.rs`. Verified at commit
`626eee1e`; re-verified at `344d00b4` (method order `rust/rpc/tests/fixtures/wire_order_frozen.txt`, indices
124–128, Envelope 9, PauseState details/tool_call_id, InputMode, discovery files, bearer auth); re-verified at
`76cb29f6` (fspec HEAD: `ProviderInfo.provider_id`).
Wire codec: **bincode 1.3.3 free functions** (`bincode::serialize` / `bincode::deserialize`).

---

## 1. Connection / Discovery

### 1.1 daemon.json

Path (client and daemon share the same resolution, `common::daemon_json_path`):

- If env `XDG_RUNTIME_DIR` is set and non-empty: `$XDG_RUNTIME_DIR/fspec/daemon.json`
- Otherwise: `~/.fspec/daemon.json`

Written by the daemon after bind, **atomically** (write `<path>.json.tmp` → `fs::rename`).
Schema (JSON, pretty-printed):

```json
{
  "port": 41413,
  "pid": 12345,
  "workspace": "/abs/canonicalized/workspace/path",
  "started_at": "2026-05-11T12:34:56Z",
  "version": "<CARGO_PKG_VERSION>"
}
```

- `port`: u16, required
- `pid`: u32, required
- `workspace`: canonicalized absolute path string
- `started_at`: RFC 3339 / ISO 8601 UTC, second precision, `YYYY-MM-DDTHH:MM:SSZ`
- `version`: `env!("CARGO_PKG_VERSION")`

Client-side verification (`read_and_verify_daemon_json`): parse JSON, require
`port` (u64→u16) and `pid` (u64→u32); `started_at`/`version` optional strings.
Probe `kill(pid, 0)` on unix (`EPERM` counts as alive; other errors = dead).
If the pid is dead, the file is **deleted** and the error is
`"no daemon.json found (stale daemon.json removed at <path>) — start 'fspec daemon' first"`.
Missing file → `"no daemon.json found at <path> — start 'fspec daemon' first"`.
The optional `--pidfile` form is two lines: `pid=<u32>\nport=<u16>\n`.

**Per-daemon entries (RPC-446, BUG-289).** Every local daemon also writes
`<dir of daemon.json>/daemons/<pid>.json` (same schema, atomic) and removes it on
shutdown (`rust/fspec/src/common/daemon_registry.rs`). `list_live_daemons` keeps the
entries whose pid is alive (ordered by pid) and deletes the rest. A daemon claims
`daemon.json` only when it is missing or names a dead pid (`claim_default_pointer`); on
shutdown it removes `daemon.json` only if it names itself, then points it at another live
daemon (`release_default_pointer`). So `daemon.json` names one live daemon, not
necessarily the last one started. The plugin (FSPEC-054) prefers the live entry whose
`workspace` holds the Paseo directory (deepest match), then `daemon.json`, then the
lowest-pid live entry; it ignores dead entries without deleting them.

### 1.2 WebSocket URL and loopback rule

- Daemon `--bind` must be loopback: host part must be exactly `127.0.0.1`, `::1`, or
  `localhost` (bracketed IPv6 allowed). Any other host is rejected at CLI validation:
  `--bind must be a loopback address (127.0.0.1, ::1, or localhost); auth/TLS for
  external binds are out of scope (future card)`.
- On successful bind the daemon prints the **port** (decimal) to stdout and flushes.
- Client connects to: `ws://127.0.0.1:<port>` (path `/`) for the standard surface.
- Explicit `--connect <ws-url>` bypasses daemon.json autodiscovery.
- **Bearer auth (RPC-447):** a daemon started with env `FSPEC_DAEMON_TOKEN` answers every
  WebSocket upgrade whose `Authorization` header is not exactly `Bearer <token>` with HTTP
  401 (`rust/rpc/src/auth_token.rs`, `rpc-server/src/server` `handle_connection`). Clients
  send the header on the upgrade (`rpc-server/src/client/connect.rs` `ws_connect(url,
  bearer)`); the plugin sends it when `FSPEC_DAEMON_TOKEN` is set in the Paseo daemon's
  environment (Node's WebSocket: `new WebSocket(url, { headers })`). A daemon without a
  token accepts plain clients.

### 1.3 Protocol path and handshake

The server accepts the WebSocket upgrade on ANY path. The **protocol surface is selected by
the request path** (exact string compare in the handshake callback):

- Path `/` (or anything else): the **full** server — request/response RPC plus all
  server-pushed fan-out frames (work units, chunks, logs, status, session lifecycle).
- Path exactly `/fspec-read-v2`: the **bounded read** surface — RPC request/response only;
  NO push frames of any kind (the server's envelope-out sender is deliberately dropped, so
  the push channel is dead on arrival). Use this for headless/CLI/MCP clients that only read.

Handshake response headers — added by the server **only** when the path is `/fspec-read-v2`:

```
x-fspec-rpc-schema: <FSPEC_RPC_SCHEMA>
x-fspec-read-version: 2
```

- `x-fspec-read-version: 2` → the client may use `read_work_units_bounded`.
- `x-fspec-rpc-schema` is a 16-hex-digit compatibility fingerprint
  (`codelet_rpc::mcp_dispatch::INTERFACE` = `env!("FSPEC_RPC_SCHEMA")`). It is a
  Rust `std::collections::hash_map::DefaultHasher` (SipHash-1-3) computed at build time
  by `rust/rpc/build.rs` over `rust/rpc/src/lib.rs` plus every `.rs` file in
  `rust/rpc-types/src` (sorted), hashing raw file bytes. **The hash is derived from
  rpc-types source; recompute it from the Rust build if the client needs to compare it**
  (it is emitted as a `cargo:rustc-env` line during the build). Clients compare it against
  the locally-compiled `INTERFACE` constant to know whether the full typed RPC surface
  (all MCP-dispatchable methods) is present.

There is **no application-level hello/ack frame**. After the WS upgrade, the server on the
full surface immediately sends two initial frames (see §6): `WorkUnitsUpdate` (initial
snapshot, may be empty) then `SessionSnapshot` (open-session snapshot, sent even when
empty so clients can distinguish "checked, none open" from "never asked"). On
`/fspec-read-v2` nothing is sent until the client issues a request.

Transport notes:

- All application traffic rides **binary** WS frames. Text frames are ignored (server logs
  `non-binary WS message; ignoring`).
- Ping/Pong: the server relies on tungstenite's automatic pong response; the pump does
  nothing with `Message::Ping`/`Message::Pong`. A client should send pings if it wants
  keep-alive.
- Close: on graceful shutdown the server sends `Close{code: 1001 (going_away),
  reason: "going_away"}`. A `Message::Close` from the client tears down the connection.
- A frame that fails to bincode-decode as an `Envelope` closes the connection (server logs
  `failed to bincode-decode envelope; closing`).

---

## 2. Envelope (WS frame payload) — verbatim

Each binary WS frame carries exactly one bincode-encoded `Envelope`
(`rust/rpc-server/src/envelope.rs`). Variant order IS the wire order
(bincode encodes externally-tagged enum variants as a u32 variant index,
so indices are 0-based and stable).

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Envelope {
    /// 0 — Bincode-encoded tarpc protocol message (both directions).
    Rpc(Vec<u8>),
    /// 1 — Server-pushed streaming chunk: (session_id, chunk).
    Event {
        session_id: SessionId,
        chunk: StreamChunk,
    },
    /// 2 — Server-pushed structured log record.
    LogEvent(LogRecord),
    /// 3 — Server-pushed full work-units snapshot replacement.
    WorkUnitsUpdate(Vec<WorkUnitInfo>),
    /// 4 — Server-pushed session status change.
    StatusUpdate {
        session_id: SessionId,
        status: SessionStatus,
    },
    /// 5 — Reserved (server→client command request). Rejected: logged + counted.
    CmdReq,
    /// 6 — Reserved (client→server command response). Rejected: logged + counted.
    CmdRes,
    /// 7 — RPC-433: server-pushed session lifecycle event.
    SessionEvent(SessionEvent),
    /// 8 — RPC-433: connect-time open-session snapshot (always sent, even empty).
    SessionSnapshot(Vec<SessionInfo>),
    /// 9 — RPC-445: work units of a workspace opened besides the start workspace.
    WorkspaceWorkUnitsUpdate(WorkspaceWorkUnits),
}
```

Wire encoding summary (bincode fixint, little-endian):

| Variant | Index bytes | Payload |
|---|---|---|
| `Rpc` | `00 00 00 00` | `Vec<u8>`: u64-LE length + raw bytes |
| `Event` | `01 00 00 00` | `SessionId` then `StreamChunk` |
| `LogEvent` | `02 00 00 00` | `LogRecord` |
| `WorkUnitsUpdate` | `03 00 00 00` | `Vec<WorkUnitInfo>` |
| `StatusUpdate` | `04 00 00 00` | `SessionId` then `SessionStatus` |
| `CmdReq` | `05 00 00 00` | (unit — rejected) |
| `CmdRes` | `06 00 00 00` | (unit — rejected) |
| `SessionEvent` | `07 00 00 00` | `SessionEvent` |
| `SessionSnapshot` | `08 00 00 00` | `Vec<SessionInfo>` |
| `WorkspaceWorkUnitsUpdate` | `09 00 00 00` | `WorkspaceWorkUnits { workspace: String, units: Vec<WorkUnitInfo> }` |

`WorkspaceWorkUnitsUpdate` (RPC-445) is pushed to every full-surface connection
(`rpc-server/src/workspace_fanout.rs`) whenever the work units of a workspace the
daemon opened **besides** its start workspace change; `workspace` is that
workspace's canonical path. A workspace is opened by `list_workspace_work_units` or
`create_session_in_workspace` (§5). The start workspace keeps using
`WorkUnitsUpdate` (3). The plugin decodes it (FSPEC-049); a client that does not
use it ignores it — it must never be treated as the start workspace's board. The
plugin's board (FSPEC-053) reads a served workspace's units with
`list_workspace_work_units` on its first watch and then follows these pushes for
that path only. `get_work_unit_details` (123) and `move_work_unit_up/down` (18/19)
take no workspace and act on the daemon's start workspace.

Direction rules: `Rpc` is the only client→server payload. All other variants
flow server→client only; a client-sent push variant is counted in
`rejected_envelopes` (named in `rejected_variants`) and dropped with a tracing
warning on the server. `CmdReq`/`CmdRes` are rejected on BOTH sides.

---

## 3. bincode 1.x wire conventions (EXACT)

The transport uses the **free functions** `bincode::serialize` /
`bincode::deserialize` from `bincode = "1"` (v1.3.3). Their fixed configuration
(verified in bincode source) is:

- **Endianness: LittleEndian** for all multi-byte integers.
- **Int encoding: FixintEncoding** (fixed-size, NOT varint):
  - `i8/u8` → 1 byte
  - `i16/u16` → 2 bytes LE
  - `i32/u32` → 4 bytes LE
  - `i64/u64` → 8 bytes LE
  - `i128/u128` → 16 bytes LE
  - **enum variant discriminants → u32 (4 bytes LE)**
  - **collection lengths, `usize`, string/byte/array lengths → u64 (8 bytes LE)**
  - `f32` → 4 bytes IEEE; `f64` → 8 bytes IEEE (LE bit layout)
- **Trailing bytes: allowed** on deserialize (`allow_trailing_bytes`) — a value
  may be a strict prefix of the buffer. (Serialization is exact.)
- No byte limit.

Concrete primitive encodings:

| Rust type | Wire bytes |
|---|---|
| `bool` | 1 byte: `00` false, `01` true |
| `String` | u64-LE byte-length, then raw UTF-8 |
| `Vec<T>` | u64-LE element count, then elements in order |
| `&[u8; N]` / `[u8; N]` | N raw bytes (NO length prefix for fixed arrays) |
| `Option<T>` | 1-byte tag: `00` = None, `01` = Some, then T |
| `Vec<u8>` | u64-LE length + raw bytes |
| `SystemTime`? not used on wire; `Duration` (in tarpc ctx) | 8-byte u64 secs + 4-byte u32 nanos (see §4) |
| C-style unit | 0 bytes |

Enum encoding (externally tagged, serde default; no `#[serde(tag)]` in use):

- **Tuple / unit variant** → u32-LE variant index only (unit: nothing after).
- **Newtype variant** `V(T)` → u32-LE index, then T.
- **Struct variant** `V { a, b }` → u32-LE index, then `a`, then `b` in
  declaration order (NO field names — bincode is self-describing-free; field
  names are NOT on the wire).

Struct encoding: fields in **declaration order**, no names.
`#[serde(default)]` / `#[serde(rename...)]` are IRRELEVANT to bincode (see §7).

---

## 4. tarpc framing inside `Envelope::Rpc`

`Envelope::Rpc(Vec<u8>)` carries the bincode serialization of
`tarpc::ClientMessage<FspecServiceRequest>` (client→server) or
`tarpc::Response<FspecServiceResponse>` (server→client). Both use the same
bincode config as §3 (fixint, LE, trailing-bytes allowed).

### 4.1 `ClientMessage` / `Request` (client → server)

Verbatim from tarpc 0.34.0 (`src/lib.rs`):

```rust
pub enum ClientMessage<T> {
    /// A request initiated by a user.
    Request(Request<T>),          // variant index 0
    /// A command to cancel an in-flight request, automatically sent by the
    /// client when a response future is dropped.
    Cancel {                      // variant index 1
        #[serde(default)]
        trace_context: trace::Context,
        request_id: u64,
    },
}

pub struct Request<T> {
    pub context: context::Context,  // field order: context FIRST
    pub id: u64,                    // per-channel monotonic request id
    pub message: T,                 // FspecServiceRequest
}
```

Wire layout of a `Request`:
`00 00 00 00` (ClientMessage::Request) → `context` → `id` (8-byte u64 LE) → `message`.

- The client assigns `id` as a monotonically increasing `u64` per connection,
  starting at 0. Cancellation is emitted only when a response future is dropped;
  a plain client that always awaits responses never sends `Cancel`.
- `Cancel` wire layout: `01 00 00 00` → `trace_context` (see 4.2; `#[serde(default)]`
  means an all-zero `Context` if the sender omits it — bincode always writes it)
  → `request_id` (8-byte u64 LE).

### 4.2 `context::Context` and `trace::Context`

Verbatim from tarpc 0.34.0 (`src/context.rs` / `src/trace.rs`):

```rust
// tarpc::context::Context
pub struct Context {
    /// Serialized as a Duration to prevent clock skew issues.
    #[serde(with = "absolute_to_relative_time")]
    pub deadline: SystemTime,
    pub trace_context: trace::Context,
}

// tarpc::trace::Context
pub struct Context {
    pub trace_id: TraceId,
    pub span_id: SpanId,
    pub sampling_decision: SamplingDecision,
}

pub struct TraceId(#[serde(with = "u128_serde")] u128);
pub struct SpanId(u64);

#[repr(u8)]
pub enum SamplingDecision {
    Sampled,    // index 0
    Unsampled,  // index 1
}
```

Exact wire layout of `context::Context` (field order: `deadline`, then
`trace_context`):

1. **`deadline`** — `#[serde(with = "absolute_to_relative_time")]` serializes the
   `SystemTime` as a **relative `Duration`** (time until deadline, clamped to 0 if
   in the past). bincode 1.x encodes `Duration` as its two fields in declaration
   order: **`secs` = 8-byte u64 LE**, then **`nanos` = 4-byte u32 LE**
   (12 bytes total). The `#[serde(default = "ten_seconds_from_now")]` attribute is
   irrelevant to bincode (bincode never consults serde defaults).
2. **`trace_context.trace_id`** — `#[serde(with = "u128_serde")]` serializes the
   `u128` as `u128::to_le_bytes()` = a **fixed 16-byte little-endian array**
   (NO length prefix, since it is a fixed array).
3. **`trace_context.span_id`** — newtype around `u64` → **8-byte u64 LE**.
4. **`trace_context.sampling_decision`** — enum → **4-byte u32 LE variant index**:
   `Sampled = 0`, `Unsampled = 1`.

So a default `context::Context` (no tracing) is exactly **12 + 16 + 8 + 4 = 40 bytes**.

### 4.3 `Response` (server → client)

Verbatim from tarpc 0.34.0 (`src/lib.rs`). NOTE: `Response` is a **struct, not an
enum** in tarpc 0.34 — there is no Delivery/Success/Error variant layer; errors are
carried inside `message` as `Result<T, ServerError>`:

```rust
pub struct Response<T> {
    pub request_id: u64,
    pub message: Result<T, ServerError>,
}

pub struct ServerError {
    // io::ErrorKind is custom-serialized:
    #[serde(serialize_with = "util::serde::serialize_io_error_kind_as_u32")]
    #[serde(deserialize_with = "util::serde::deserialize_io_error_kind_from_u32")]
    pub kind: io::ErrorKind,
    pub detail: String,
}
```

Wire layout:
`request_id` (8-byte u64 LE) → `message` as `Result`:
- `Ok(v)`  → u32-LE variant index `00 00 00 00` + `FspecServiceResponse` payload
- `Err(e)` → u32-LE variant index `01 00 00 00` + `ServerError { kind, detail }` where **`kind` is a
  4-byte u32 LE discriminant of `std::io::ErrorKind`** (the `with`-helper maps the
  `ErrorKind` variant index; `UnexpectedEof` = 0, … order follows the std enum
  declaration order — see `tarpc::util::serde` if you must match error kinds),
  then `detail` as a length-prefixed String.

`ServerError` only occurs when the server aborts a request early (throttling,
transport error); service-level errors use `Err(String)` in the method's own
return type (inside the `Ok` arm above).

### 4.4 `FspecServiceRequest` / `FspecServiceResponse` (generated enums)

The `#[tarpc::service]` macro (tarpc-plugins 0.13.1) generates, for the trait
`FspecService`:

```rust
pub enum FspecServiceRequest {
    ListWorkUnits { /* 0 zero-arg */ },
    ListSessions { project_path: String },
    /* ... one STRUCT variant per method, in trait order, camelCase-named ... */
    SessionManifestIssues { /* last */ },
}

pub enum FspecServiceResponse {
    ListWorkUnits(Vec<WorkUnitInfo>),
    ListSessions(Vec<SessionInfo>),
    /* ... one TUPLE variant per method, in trait order, camelCase-named ... */
    SessionManifestIssues(Result<Vec<SessionManifestIssue>, String>),
}
```

- Variant names = **camelCase of the method name** (e.g. `list_providers` →
  `ListProviders`, `set_session_model` → `SetSessionModel`).
- Request variants are **struct variants** (fields = method params, in order);
  response variants are **tuple variants** (field = method return type).
- **Variant index = method position in the trait, 0-based.** Indices below are
  for the trait as of commit 626eee1e (§5 has the numbered table).

---

## 5. `FspecService` trait — method order = variant indices

The `#[tarpc::service]` macro (tarpc-plugins 0.13.1) generates
`FspecServiceRequest` (struct variants, one per method, params in order) and
`FspecServiceResponse` (tuple variants, one per method, field = return type).
Variant index = 0-based position in the trait. Full order verified from
`rust/rpc/src/lib.rs` (129 methods, indices 0–128 as of fspec `344d00b4`).

### 5.1 Methods the Paseo plugin uses (by 0-based index)

| idx | wire variant | method | args | return |
|---|---|---|---|---|
| 0 | `ListWorkUnits` | `list_work_units` | — | `Vec<WorkUnitInfo>` |
| 2 | `ListLiveSessions` | `list_live_sessions` | — | `Vec<SessionId>` (bare ids, **not** `SessionInfo`) |
| 3 | `CreateSession` | `create_session` | `role: Option<String>` | `SessionId` |
| 121 | `CreateSessionChecked` | `create_session_checked` | `role: Option<String>` | `Result<SessionId, String>` (the provider uses this: the legacy 3 answers an empty id on failure) |
| 4 | `SendInput` | `send_input` | `session_id: SessionId, text: String` | `()` |
| 5 | `Interrupt` | `interrupt` | `session_id: SessionId` | `()` |
| 6 | `GetSessionStatus` | `get_session_status` | `session_id: SessionId` | `SessionStatus` |
| 7 | `Health` | `health` | — | `HealthInfo` |
| 18 | `MoveWorkUnitUp` | `move_work_unit_up` | `id: String` | `Result<(), String>` (refused in the done column) |
| 19 | `MoveWorkUnitDown` | `move_work_unit_down` | `id: String` | `Result<(), String>` |
| 20 | `GetModelInfo` | `get_model_info` | `session_id: SessionId` | `ModelInfo` |
| 21 | `GetThinkingLevel` | `get_thinking_level` | `session_id: SessionId` | `ThinkingLevel` |
| 28 | `ListProviders` | `list_providers` | — | `Vec<ProviderInfo>` |
| 29 | `SetSessionModel` | `set_session_model` | `session_id: SessionId, provider_id: String, model_id: String` | `Result<(), String>` |
| 39 | `SetThinkingLevel` | `set_thinking_level` | `session_id: SessionId, level: ThinkingLevel` | `Result<(), String>` |
| 80 | `GetPauseState` | `get_pause_state` | `session_id: SessionId` | `Option<PauseState>` (§6.8; read for the gated tool call id) |
| 119 | `GetInteractionSnapshot` | `get_interaction_snapshot` | `session_id: SessionId` | `Result<String, String>` (JSON, §6.8) |
| 124 | `ListWorkspaces` | `list_workspaces` | — | `Result<Vec<WorkspaceEntry { path, name, start: bool }>, String>` (start workspace first; RPC-443) |
| 125 | `ListWorkspaceWorkUnits` | `list_workspace_work_units` | `workspace: String` | `Result<Vec<WorkUnitInfo>, String>` (opens the workspace if needed) |
| 126 | `CreateSessionInWorkspace` | `create_session_in_workspace` | `workspace: String, role: Option<String>` | `Result<SessionId, String>` (opens the workspace; `Err` for a non-directory or no default model; RPC-444) |
| 128 | `SubmitInput` | `submit_input` | `session_id: SessionId, text: String, mode: InputMode` | `Result<(), String>` (`Err("Session not found: <id>")`; RIG-016, see §6.9) |
| 44 | `GetSessionRole` | `get_session_role` | `session_id: SessionId` | `Option<String>` (role overlay; a bot's starts with `# fspec bot: orchestrator`, TUI-114) |
| 45 | `SetSessionRole` | `set_session_role` | `session_id: SessionId, role: Option<String>` | `Result<(), String>` (`None` clears) |
| 46 | `SendInputWithThinking` | `send_input_with_thinking` | `session_id: SessionId, text: String, thinking: Option<ThinkingConfig>` | `()` |
| 30 | `SetDefaultModel` | `set_default_model` | `model: String` ("provider/model") | `Result<(), String>` (empty strings ignored) |
| 31 | `AddCustomModel` | `add_custom_model` | `provider_id: String, profile_name: String, definition: CustomModelDefinition` | `Result<(), String>` (`provider_id` is the profile section's `ProviderInfo.provider_id`; fspec refuses a missing profile, an unknown model id or a non-openai provider; FSPEC-047, FSPEC-056) |
| 32 | `UpdateCustomModel` | `update_custom_model` | `provider_id, profile_name, original_model_id: String, definition` | `Result<(), String>` (replaces the entry with `original_model_id`) |
| 33 | `DeleteCustomModel` | `delete_custom_model` | `provider_id, profile_name, model_id: String` | `Result<(), String>` |
| 127 | `GetDefaultModel` | `get_default_model` | — | `Option<String>` ("provider/model"; RPC-440) |
| 87 | `DestroySession` | `destroy_session` | `session_id: SessionId` | `Result<(), String>` |
| 123 | `GetWorkUnitDetails` | `get_work_unit_details` | `id: String` | `Result<String, String>` (JSON `{id, workspace, workUnit}`) |

### 5.2 Full ordered trait (indices 0–128, frozen in `rust/rpc/tests/fixtures/wire_order_frozen.txt`)

`0 list_work_units · 1 list_sessions · 2 list_live_sessions · 3 create_session · 4 send_input · 5 interrupt · 6 get_session_status · 7 health · 8 checkpoint_counts · 9 changed_files · 10 file_diff · 11 list_checkpoints · 12 checkpoint_diff_files · 13 checkpoint_file_diff · 14 restore_checkpoint_file · 15 restore_checkpoint_all · 16 delete_checkpoint · 17 delete_all_checkpoints · 18 move_work_unit_up · 19 move_work_unit_down · 20 get_model_info · 21 get_thinking_level · 22 get_workspace_info · 23 search_files · 24 persistence_add_history · 25 persistence_get_history · 26 persistence_search_history · 27 persistence_delete_session · 28 list_providers · 29 set_session_model · 30 set_default_model · 31 add_custom_model · 32 update_custom_model · 33 delete_custom_model · 34 list_provider_settings · 35 save_provider_settings · 36 save_profile · 37 delete_profile · 38 rename_profile · 39 set_thinking_level · 40 set_continue_state · 41 get_continue_state · 42 set_goal_state · 43 get_goal_state · 44 get_session_role · 45 set_session_role · 46 send_input_with_thinking · 47 get_session_tokens · 48 get_session_model · 49 get_compaction_progress · 50 get_buffered_output · 51 clear_history · 52 compact_session · 53 restore_session_messages · 54 restore_session_token_state · 55 resume_session · 56 get_work_unit_focus · 57 set_work_unit_focus · 58 get_work_unit_context · 59 set_work_unit_context · 60 get_pending_input · 61 set_pending_input · 62 set_active_session · 63 clear_active_session · 64 get_active_session · 65 get_effective_cwd · 66 get_supervisors · 67 add_supervisor · 68 remove_supervisor · 69 get_subordinate · 70 get_subordinates · 71 receive_incoming_message · 72 get_debug_enabled · 73 set_debug_enabled · 74 toggle_debug · 75 set_debug_directory · 76 pause_resume · 77 pause_confirm · 78 pause_triple · 79 send_hitl_response · 80 get_pause_state · 81 get_hitl_request · 82 get_exec_stdin_request · 83 write_exec_stdin · 84 send_fspec_result · 85 create_isolated_session · 86 set_thinking_level_default · 87 destroy_session · 88 list_provider_credentials · 89 get_provider_credential · 90 set_provider_credentials · 91 delete_provider_credentials · 92 test_provider_connection · 93 refresh_models_cache · 94 oauth_clear_tokens · 95 oauth_get_tokens · 96 oauth_browser_login · 97 oauth_headless_start · 98 oauth_headless_complete · 99 oauth_device_start · 100 oauth_device_poll · 101 oauth_copilot_device_start · 102 blocklist_list · 103 merge_session_worktree · 104 discard_session_worktree · 105 prune_orphaned_worktrees · 106 list_session_worktrees · 107 inspect_session_changes · 108 detach_session_worktree · 109 schedule_add · 110 schedule_list · 111 schedule_pause · 112 schedule_resume · 113 schedule_remove · 114 loop_add · 115 loop_cancel · 116 loop_list · 117 get_transcript_page · 118 read_work_units_bounded · 119 get_interaction_snapshot · 120 reply_interaction_checked · 121 create_session_checked · 122 session_manifest_issues · 123 get_work_unit_details · 124 list_workspaces · 125 list_workspace_work_units · 126 create_session_in_workspace · 127 get_default_model · 128 submit_input` (123 added at fspec `9fa9a798`: `get_work_unit_details(id: String) -> Result<String, String>`, JSON `{"id","workspace","workUnit"}`; 124–126 RPC-443/444/449, 127 RPC-440, 128 RIG-016 — new methods are only ever appended)

---

## 6. Server-pushed frame shapes (verbatim, variant indices)

### 6.1 `StreamChunk` (payload of `Envelope::Event`) — 32 variants, index 0–31

```rust
pub enum StreamChunk {
    ResponseAttemptStarted,        // 0  (unit)
    ResponseAttemptAborted,        // 1  (unit)
    Text { text, correlation_id: Option<String>, observed_correlation_ids: Option<Vec<String>> }, // 2
    Thinking { thinking, correlation_id: Option<String>, observed_correlation_ids: Option<Vec<String>> }, // 3
    ToolCall { tool_call: ToolCallInfo, correlation_id, observed_correlation_ids }, // 4
    ToolResult { tool_result: ToolResultInfo, correlation_id, observed_correlation_ids }, // 5
    ToolProgress { tool_progress: ToolProgressInfo, correlation_id, observed_correlation_ids }, // 6
    SessionStateChange { state: SessionState },        // 7
    UserNotification { message: String, severity: NotificationSeverity }, // 8
    Interrupted { queued_inputs: Vec<String> },        // 9
    TokenUpdate { tokens: TokenTracker },              // 10
    ContextFillUpdate { context_fill: ContextFillInfo }, // 11
    ContextSnapshot { snapshot: RequestContextSnapshot }, // 12
    Done,                                        // 13  (unit)
    Error { error: String },                     // 14
    UserInput { text: String },                  // 15
    IncomingMessage { text: String, images: Option<Vec<IncomingMessageImage>> }, // 16
    SupervisorPendingInjection { supervisor_pending_injection: SupervisorPendingInjectionInfo }, // 17
    CompactionComplete { compaction_result: CompactionResult }, // 18
    CommittedCompaction { snapshot: CommittedContextSnapshot }, // 19
    FspecCommandRequest { fspec_request: FspecRequest }, // 20
    FspecCommandResult { fspec_result: FspecResult }, // 21
    WorkUnitsUpdate { work_units: Vec<WorkUnitInfo> }, // 22
    IsolationStateChange { is_isolated: bool, worktree_path: Option<String>, base_commit: Option<String> }, // 23
    FooterStateUpdate { cwd: String, display_path: String, is_git_repo: bool, branch: Option<String> }, // 24
    DebugStateChange { enabled: bool },           // 25
    ContinueStateUpdate { continue_state: ContinueStateInfo }, // 26
    ExecStdinRequest { request: ExecStdinRequest }, // 27
    ExecStdinRequestCleared,                     // 28  (unit)
    CompactionProgressUpdate { progress: Option<CompactionProgress> }, // 29
    InterruptedWithReason { queued_inputs: Vec<String>, reason: InterruptionReason }, // 30
    ProviderWaiting { message: Option<String> },  // 31
}
```

Struct-variant fields are written **positionally** (declaration order, no names).
`Text`/`Thinking`/`ToolCall`/`ToolResult`/`ToolProgress` each carry the three
correlation fields AFTER their primary payload: `Option<String>` then
`Option<Vec<String>>`.

**Paseo transcript mapping** (the chunks FSPEC-006 renders): `Text`(2)→
assistant text, `Thinking`(3)→ reasoning, `ToolCall`(4)→ tool_call (running),
`ToolProgress`(6)→ tool_call detail update, `ToolResult`(5)→ tool_call
completed/failed, `UserNotification`(8)→ notification, `Error`(14)→ error,
`TokenUpdate`(10)+`ContextFillUpdate`(11)→ usage, `CompactionComplete`(18)/
`CommittedCompaction`(19)→ compaction row, `SessionStateChange`(7)/
`ProviderWaiting`(31)→ status. `Done`(13)/`Interrupted`(9)/
`InterruptedWithReason`(30) are turn terminals; an interrupt is followed by a
`Done` and its `queued_inputs` stay parked in the daemon (§6.9).

### 6.2 Supporting payloads (verbatim)

```rust
pub struct ToolCallInfo { pub id: String, pub name: String, pub input: String }
pub struct ToolResultInfo { pub tool_call_id: String, pub content: String, pub is_error: bool }
pub struct ToolProgressInfo { pub tool_call_id: String, pub tool_name: String, pub output_chunk: String, pub is_stderr: bool }
pub struct ContextFillInfo { pub fill_percentage: u32, pub effective_tokens: f64, pub threshold: f64, pub context_window: f64 }
pub enum SessionState { Idle, Running, Paused, Compacting, Interrupted, Cleared }        // 0-5
pub enum NotificationSeverity { Info, Warning, Error }                                   // 0-2
pub struct TokenTracker { pub input_tokens: u32, pub output_tokens: u32,
  pub cache_read_input_tokens: Option<u32>, pub cache_creation_input_tokens: Option<u32>,
  pub tokens_per_second: Option<f64>, pub cumulative_billed_input: Option<u32>,
  pub cumulative_billed_output: Option<u32>, pub reasoning_tokens: Option<u32> }
pub enum InterruptionReason { User, LoopDetector }                                        // 0-1
```

### 6.3 `Envelope::StatusUpdate` payload — `SessionStatus`

```rust
pub enum SessionStatus { Idle, Running, Interrupted, Paused, Compacting, Cleared } // 0-5
```
(`#[default] Idle`. The `From<u8>` impl confirms 0=Idle…5=Cleared.)

### 6.4 `Envelope::WorkUnitsUpdate` payload — `Vec<WorkUnitInfo>`

```rust
pub struct WorkUnitInfo {
    pub id: String, pub title: String,
    pub work_type: String,        // serde rename "workType" — irrelevant to bincode
    pub status: String,
    pub description: Option<String>,
    pub estimate: Option<i32>,
    pub epic: Option<String>,
    pub attachments: Vec<String>,
    pub last_state_change_at: Option<String>,
}
```

### 6.5 `Envelope::SessionEvent` payload — `SessionEvent`

```rust
pub enum SessionEvent {
    Created(SessionInfo),      // 0
    Removed(SessionId),        // 1
    Cleared(SessionId),        // 2
    FocusChanged { session_id: SessionId, focus: WorkUnitFocus }, // 3
}
```

### 6.6 `Envelope::SessionSnapshot` payload — `Vec<SessionInfo>`

```rust
pub struct SessionInfo {
    pub id: String, pub name: String, pub status: String, pub project: String,
    pub message_count: u32,
    pub provider_id: Option<String>, pub model_id: Option<String>,
    pub is_isolated: bool, pub worktree_path: Option<String>,
    pub role: Option<String>, pub updated_at_ms: Option<i64>,
    pub work_unit_focus: WorkUnitFocus,
}
```

### 6.7 Catalog / model / thinking / token shapes (RPC return payloads)

```rust
pub struct ProviderInfo { pub key: String, pub display_name: String,
  pub models: Vec<ModelEntry>, pub profile_name: Option<String>, pub is_unreachable: bool,
  pub provider_id: String }   // BUG-325: the base provider ("openai" for "openai:<profile>", else = key)
pub struct ModelEntry { pub id: String, pub display_name: String, pub context_window: u32,
  pub supports_reasoning: bool, pub supports_vision: bool, pub is_custom: bool }
pub enum ThinkingLevel { Off, Low, Medium, High }   // 0-3, #[default] Off
pub struct ModelInfo { pub display_name: String, pub supports_reasoning: bool,
  pub supports_vision: bool, pub context_window: u32, pub compaction_threshold: u32 }
pub struct SessionModel { pub provider_id: String, pub model_id: String,
  pub context_window: i64, pub max_output_tokens: i64, pub compaction_threshold: i64 }
pub struct SessionTokens { pub input_tokens: i64, pub output_tokens: i64 }
pub struct HealthInfo { pub uptime_secs: i64, pub connected_clients: i64,
  pub last_watcher_event_secs_ago: Option<i64>, /* … */ }
pub struct ThinkingConfig { pub provider_id: String, pub level: ThinkingLevel, pub config_json: String }
```

**Catalog build note (FSPEC-004):** `list_providers` (idx 28) returns
`Vec<ProviderInfo>`; map each `ProviderInfo` → one Paseo "provider" group and
each `ModelEntry` → a `ProviderModel` (`id` = `provider.key + "/" +
entry.id`, `label` = `display_name`, `contextWindowMaxTokens` =
`entry.context_window`, `supports_reasoning` → thinking options). The catalog
default is `get_default_model` (idx 127) when it names a listed model, else the
first model (FSPEC-046). `create_session_checked` answers **`Ok("")`** (not `Err`)
when fspec has no default model (PROV-101 decline,
`sessions/src/handle_creation.rs`); the plugin calls `set_default_model` first in
that case, as the TUI does for a model chosen with no session. Thinking
levels are global (`ThinkingLevel`, idx 21 via `get_thinking_level` / set via
`set_thinking_level` idx 39), not per-model.


### 6.8 Approval pauses — `get_pause_state` (idx 80) and `get_interaction_snapshot` (idx 119)

```rust
pub enum PauseKind { Confirm, Triple }                                   // 0-1
pub struct PauseState {
    pub kind: PauseKind,
    pub prompt: String,
    pub details: Option<String>,      // BUG-291: renamed in place from `tool_call_id` (it always carried the details text)
    pub tool_call_id: Option<String>, // BUG-291: NEW — id of the streamed ToolCall chunk that raised the pause
}
```

`get_pause_state` returns `Option<PauseState>` (tag byte, then the four fields in this
order). fspec 0.10.9 builds before BUG-291 sent only three fields, the third being the
details text. `get_interaction_snapshot` returns `Result<String, String>` JSON
`{"pause":{"request_id","state":{kind,tool_name,message,details}|null},"hitl":{"request_id","state":{questions}|null}}`
(`sessions/src/background_session/interactions.rs`); it carries the `request_id` every
answer must quote (`reply_interaction_checked`, idx 120) but **no tool call id**. The plugin
therefore reads the snapshot for the request and `get_pause_state` only for
`tool_call_id`, so the Paseo permission is attached to the gated tool call (FSPEC-050).

### 6.9 Steer, queue and interrupt — `submit_input` (idx 128, RIG-016)

```rust
pub enum InputMode { Steer, Queue, Interrupt }   // 0-2, #[default] Steer (rpc-types input_mode.rs)
```

Behaviour (`sessions/src/background_session/input_modes.rs`, `agent-loop/.../finalization.rs`,
`cli/src/interactive/stream_loop/{steer,interrupted}.rs`):

| session | `Steer` | `Queue` | `Interrupt` |
|---|---|---|---|
| idle | like `send_input` (new turn) | queued, then the **oldest parked input** starts (parked inputs run ahead of it) | like `send_input` |
| running | `UserInput` chunk emitted **now**; delivered at the next safe boundary (all tool results settled, before the next provider request) with no further chunk | starts as a new turn when the running turn completes, in order | cancels the turn; the text is parked at the front of the queue |

- A turn that completes without an interrupt starts the steers it never reached
  (joined with blank lines) as one new turn **before** the next queued input
  (`continue_with_inbox`); each such turn begins with a `UserInput` chunk of its text.
- An interrupted turn leaves queued inputs **parked**: `Interrupted`/`InterruptedWithReason`
  lists them in `queued_inputs` (without draining), followed by `Done`; they only run on
  resume, i.e. a `Queue` submit while idle. Older daemons dropped them.
- The plugin (FSPEC-051): `delivery: "steer"` → `Steer`; a prompt while a turn runs, waits or
  is parked → `Queue`; an idle prompt keeps `send_input`. It never sends `Interrupt` (Stop
  uses `interrupt`, idx 5).

---

## 7. Serde attributes that DO / DON'T affect the bincode wire form

bincode is **positional and self-description-free**. It reads fields by
declaration order and enums by variant index; it never sees field names.

**DOES affect the wire:**
- **Field/variant declaration ORDER** — the one thing that must match the
  Rust source exactly. Reorder a struct field or enum variant and every byte
  after it shifts.
- `#[serde(with = "...")]` / `serialize_with` / `deserialize_with` — changes
  how a field's value is encoded. Present on the wire types:
  - `trace::Context` (tarpc): `deadline` via `absolute_to_relative_time`
    (SystemTime → relative `Duration`), `TraceId` via `u128_serde`
    (u128 → `[u8;16]` LE bytes).
  - `tarpc::ServerError.kind`: `io::ErrorKind` → u32 discriminant via
    `serialize_io_error_kind_as_u32`.
- `#[serde(skip)]` — removes the field from the wire entirely.
- Any `#[derive(Serialize)]`-shaping: newtype structs flatten to their inner
  value (`SpanId(u64)` → 8-byte u64; `SessionId { value: String }` is a
  **struct** → u64 length + bytes, NOT transparent).

**DOES NOT affect the wire (cosmetic / JSON-only):**
- `#[serde(rename = "...")]` and `#[serde(rename_all = "...")]` — bincode
  ignores names. (These camelCase renames exist for the napi/JSON surface.)
- `#[serde(alias = "...")]`, `#[serde(default)]`, `#[serde(default = "...")]`
  — deserialization-only; bincode always writes the value.
- `#[cfg_attr(feature = "napi", ...)]` — the napi feature is off for the
  daemon; these attributes are inert on the wire.

### 7.1 Newtype vs struct — the two `SessionId`-like traps

- `SessionId { value: String }` — a **struct** with one public field →
  wire = `u64-LE(len) + bytes`. NOT a bare string.
- `SpanId(u64)` — a **newtype** → wire = just `u64-LE` (8 bytes), no length.
- `TraceId(#[serde(with="u128_serde")] u128)` — newtype with a `with` helper →
  wire = 16 raw LE bytes (`u128::to_le_bytes`), no length prefix.

### 7.2 Worked example — encode `CreateSession` (variant idx 3)

Full byte layout of one `Envelope::Rpc` frame carrying a
`tarpc::ClientMessage::Request` for `create_session(role: None)`:

```
Envelope::Rpc                       00 00 00 00            (u32 variant 0)
  Rpc payload Vec<u8>               8-byte u64-LE length N (then N bytes of the below)
    ClientMessage::Request          00 00 00 00           (u32 variant 0)
      Request.context               <40 bytes, see below>
      Request.id                    00 00 00 00 00 00 00 00   (u64-LE, e.g. 0)
      Request.message               FspecServiceRequest::CreateSession
                                     03 00 00 00            (u32 variant 3)
                                     <role: Option<String>> 00  (u8 None)
```
`context` (40 bytes): `deadline` Duration = `secs`(8 LE)+`nanos`(4 LE) — write
e.g. `10, 0`; then `trace_context`: `trace_id`(16 LE, all 0) + `span_id`(8 LE,
0) + `sampling_decision`(4 LE, 1=Unsampled). So a minimal request context is
`[0x0A,0x00,...0x00 (10s), 0x00, (16 zero), (8 zero), 01 00 00 00]`.

Response for the same call: `Envelope::Rpc` → `Response { request_id (u64),
message: Result }` → `Ok` variant `00 00 00 00` (serde `Result` is a bincode
enum, u32 index; FSPEC-007 verified this against tarpc 0.34 — an earlier
revision of this doc wrongly said a 1-byte `01` tag) + `SessionId` struct
(`u64 len + bytes`). Service-level `Result<(), String>` payloads use the same
encoding: `Ok(())` = `00 00 00 00`, `Err(s)` = `01 00 00 00` + String.

### 7.3 Golden-vector strategy (FSPEC-002)

Because the exact byte layout is load-bearing and easy to get wrong, the codec
must be validated against **golden vectors generated by the Rust side**: add a
small Rust helper (in `/tmp`, not the repo) that `bincode::serialize`s a
representative `Envelope` for each `StreamChunk` variant and a few
`ClientMessage::Request`s, hex-dumps them, and the TS codec's encode/decode
tests assert byte-for-byte equality. This catches varint-vs-fixint, endianness,
Option-tag, and field-order regressions that round-trip-only tests miss.
