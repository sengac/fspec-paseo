# FSPEC-067 root cause: a session's background daemon calls fail silently

## Problem (server/session.ts)

| line | call | swallowed by |
|---|---|---|
| 599 | `set_active_session` (markActive) | `.catch(() => {})` |
| 1159-1161 | `interrupt` — `request.completed` is sent first | `.catch(() => {})` |
| 984 | `destroy_session` cleanup after a failed configure | `.catch(() => {})` |
| 991 | `list_checkpoints` (rememberCheckpoints) | `.catch(() => {})` — later every old checkpoint looks new and becomes a revert point |
| 1023 / 588-594 | `get_work_unit_focus` (seedFocus) | `.catch(() => {})`, and a `result` error is ignored |
| 1284 | `list_checkpoints` (attachCheckpoint) | `.catch(() => {})` |
| 786-792 | the steer's deny `reply_interaction_checked` | `.catch(() => {})`, result ignored |
| 571-574 | a child's `get_active_session`/`clear_active_session` | `.catch(() => {})` |
| 842, 849 | sub-agent walk and destroys on close | `.catch(() => {})` |
| 859 | `persistence_search_history` | `.catch(() => ({ result: null }))`, error result ignored |
| 1043 | `can_stop_runtime` status reads | bare `catch` |
| 1355-1371 | closeAll destroys | `Promise.allSettled`, results dropped |

## Fix

A `report(session, title, error)` helper logs `[fspec] <title>: <reason>`
(plugin stderr = Paseo's plugin log) and emits a warning `session.notice`
on the session when it is still open. Then:

- markActive, seedFocus (including an error result), attachCheckpoint, the
  steer's deny (including an error result) and a child's active-mark clear
  (on its parent) are reported.
- `interrupt` is awaited before `request.completed`; a failure fails the
  request.
- `list_checkpoints` is read before any session is created; a failure fails
  the open.
- A failed cleanup destroy keeps the original error first:
  `<original>; the fspec session <id> it created could not be destroyed: <reason>`.
- Close destroys the session even when sub-agent lookups or destroys fail,
  then fails the close with `fspec could not close sub-agents of <id>: …`.
- The prompt search failure fails the list with its reason.
- `can_stop_runtime` read failures are logged and answer false (keeping the
  runtime is the only safe answer, Paseo asks again later).
- closeAll logs each failed destroy.

## Alternatives rejected

- Notices for every log line: closeAll runs on unload with no session left
  to show them on, and canStopRuntime is invisible background bookkeeping.
