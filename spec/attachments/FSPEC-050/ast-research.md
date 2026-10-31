# AST research: PauseState details and tool_call_id (FSPEC-050)

```
server/session.ts:424:3:async function openPause(session: FspecSession): Promise<void> {

No matches found
server/interactions.ts:108:1:export function permissionRequest(

server/wire.ts:390:1:export interface PauseState {

/Users/rquast/projects/fspec/rust/rpc-types/src/session_state.rs:87:1:pub struct PauseState {

/Users/rquast/projects/fspec/rust/sessions/src/background_session/interactions.rs:72:5:pub fn interaction_snapshot(&self) -> Result<String, String> {

```

- `openPause` (session.ts) builds the request from `get_interaction_snapshot` and attaches it to
  `transcript.runningToolCall()` — the most recent running call, which is wrong when several calls run.
- fspec's interaction snapshot JSON only carries `kind/tool_name/message/details` (no tool call id), so
  the id must come from `get_pause_state` (idx 80), whose 4th field `tool_call_id` is new in BUG-291.
- `permissionRequest` (interactions.ts) takes the tool `{ name, detail }`; adding `toolCallId` lets it set
  `metadata.toolCallId`. The transcript keeps every tool by call id (`tools` map), so a `toolCall(id)`
  accessor gives the gated call's name and detail.
- Wire: `PauseState` reader/writer in wire.ts reads 3 fields; the 3rd is now `details`, the 4th `tool_call_id`.
