# FSPEC-059 root cause: approvals without a tool call id are attached to a guessed call

## Problem

- `openPause` attaches the permission to the tool call `get_pause_state`'s
  `tool_call_id` names, else to the most recent running tool call
  (`server/session.ts:462-463`
  `gated ?? session.transcript.runningToolCall()`; `server/transcript.ts:281-287`).
  With two tool calls running, a pause without an id is shown on whichever
  started last — possibly not the one fspec gated.
- `pauseState` swallows a failed `get_pause_state` and returns null
  (`server/session.ts:467-473`), which then feeds the guess above.
- A failed `get_interaction_snapshot` returns silently (`server/session.ts:452`
  `if (!result.ok) return;`) and the caller drops every error
  (`server/session.ts:1256` `void openPause(session).catch(() => {})`): the
  session sits paused with nothing shown.
- An unknown pause kind is read as a confirm pause
  (`server/interactions.ts:72`).

## Design

- The permission is attached only to the tool call `tool_call_id` names
  (detail + `metadata.toolCallId`). Without an id, or with an id the
  transcript does not know, the approval is shown unattached: name and
  description from the snapshot, no `detail`, no `metadata`.
  `runningToolCall` is removed.
- `get_pause_state` and `get_interaction_snapshot` failures propagate;
  `openPause`'s caller shows them as an error notice
  ("fspec paused this session but the pause could not be read: <reason>").
- A pause kind other than Confirm, Triple or Continue is an error with the
  same notice.

## Alternatives rejected

- Keep the running-call fallback when exactly one call is running: still a
  guess (fspec pauses for non-tool reasons too), and the user asked for none.

## Wire changes

None.
