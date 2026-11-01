# FSPEC-070 root cause: a tool result with no seen call is named "tool"

## Problem

`server/transcript.ts:212`: `tool(chunk.toolResult.toolCallId, "tool")`
creates the tool state with the invented name `"tool"` when no ToolCall or
ToolProgress for that id was folded, so Paseo shows a tool called "tool".

## Can it happen legitimately? Yes

- fspec appends each chunk to the session journal and then sends it on two
  tokio broadcasts (`rust/sessions/src/background_session/output.rs:78-85`);
  the WebSocket server's per-connection fan-out drains
  `SharedFspecService::chunks_rx()` (`rust/rpc/src/shared_broadcasts.rs:2-18`).
  A tokio broadcast receiver gets only values sent after it subscribed: there
  is no backlog.
- So the plugin legitimately receives a ToolResult whose ToolCall it never
  saw when (a) Paseo reopens a session whose turn is running without
  `history: "replay"` (session.ts open, line ~1071), or (b) a sub-agent is
  adopted from a chunk pushed after its call (session.ts `adoptUnknown`), e.g.
  after the plugin reconnected mid-run.
- Replay pages the journal from its start (`getTranscriptPage` with no
  cursor), which contains the call, so replay itself does not produce this.

It is not a protocol inconsistency, so it is not an error notice.

## Fix (decision)

A result-first tool state has no name (`name: null`). Its item is a
`tool_call` named `unmatched tool result` whose detail is
`plain_text` labelled `unmatched tool result · <tool_call_id>` with the result
content as text. `toolName()` returns undefined for it, so it never matches
the fspec checkpoint hook or the AgentManager spawn lookup. A later ToolCall
for the same id (not expected) would set the real name.

## Alternatives rejected

- Error notice: the case is legitimate (see above), so an error would be noise.
- Dropping the result: loses the tool output the user is watching.
- Fetching the call via `getTranscriptPage`: the call may precede a long
  journal; paging the whole transcript per result is not proportionate, and
  the reopen-with-replay path already exists for full history.
