# FSPEC-063 root cause: a sub-agent child is attached to whichever tool output mentions its id

## Problem

- `openChild` (`server/session.ts:548`) sets the child's `toolCallId` from
  `parent.transcript.toolCallMentioning(daemonSessionId)`, which returns the
  most recent tool call whose **output text contains** the id
  (`server/transcript.ts:277-280`). An AgentManager `get_status`, `message`,
  `list` or `await_idle` result, or a shell command that printed the id, is
  newer than the spawn and wins, so Paseo nests the child under the wrong call.
- `adoptUnknown` (`server/session.ts:506-508`) turns a failed
  `get_supervisors` into "not a sub-agent" with `.catch(() => undefined)`.

## The explicit link fspec provides

- The AgentManager tool (`rust/tools/src/agent_manager/mod.rs:72`, name
  `AgentManager`) takes `{"action":"spawn",…}`
  (`types.rs:45-52`, `#[serde(tag = "action", rename_all = "snake_case")]`)
  and returns `serde_json::to_string_pretty(&result)` (`mod.rs:216-219`)
  where the spawn result is `AgentManagerResult::Spawned { session_id }`
  (`types.rs:209`, untagged): `{"session_id": "<uuid>"}`.
- The supervisor link itself is `get_supervisors` / `get_subordinates`
  (ChainOfCommand); neither carries a tool call id, and no chunk correlation
  id names the spawn. The spawn result is the only explicit link.

## Fix

- `transcript.spawnCallOf(id)`: the parent's tool call named `AgentManager`
  whose input is an object with `action: "spawn"` and whose output parses as
  a JSON object with `session_id` equal to the child's daemon id. No text
  search.
- No such call: `session.opened` carries no `toolCallId` (the child shows
  unattached).
- A failed `get_supervisors` is logged (`[fspec] …`) and the session is not
  adopted; nothing is guessed.

## Alternatives rejected

- Keep the text search as a fallback after the spawn match: the rule is no
  guessed links.
- Match `close`/`message` results that carry `session_id`: they are not the
  spawn.
