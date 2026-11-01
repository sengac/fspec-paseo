# FSPEC-057 root cause: refused input is invisible and a failed resume silently starts over

## Problem

- fspec BUG-328 (commit 8bb44c52): `send_input` (idx 4) and
  `send_input_with_thinking` (idx 46) now return `Result<(), String>`
  (`/Users/rquast/projects/fspec/rust/rpc/src/service_declaration/workspace.rs:30`,
  `providers_sessions.rs:149`), and `send_input`, `send_input_with_thinking`
  and `submit_input` accept input only for a session the daemon holds live
  (`rust/sessions/src/session_manager/manager_impl_6.rs:9-14` `live_session`):
  "Session not found: <id> (resume it with resume_session before sending
  input)". The implicit resume inside input (`live_or_resumed`) is gone.
- The plugin decodes no payload for either reply (`server/wire.ts:2546-2549`,
  response union `:2223`, `:2237`) and `prompt` awaits `sendInput` without
  looking at a result (`server/session.ts:1137`): a refused prompt leaves its
  turn running forever. The trailing Result bytes are silently ignored.
- `open` resumes a saved session with `resume_session`
  (`server/session.ts:409-416`, `:915`), but when the resume fails it creates a
  brand-new daemon session and shows a warning notice
  ("Previous fspec session could not be resumed; started a new one",
  `server/session.ts:983-994`): a fallback that replaces the user's session
  with another one.

## Paths that send input (checked)

- `prompt` → `send_input` / `submit_input(queue)` (`server/session.ts:1134-1137`)
  and `steerPrompt` → `submit_input(steer)` (`:791`), on:
  - sessions the plugin created (`create_session_checked` /
    `create_session_in_workspace`): live by construction;
  - saved sessions reopened or imported from Paseo's session list
    (`session.open` with persistence): both go through `open` →
    `resume_session` before the session is registered, so no input can reach
    them before the resume succeeded;
  - sub-agent children (`openChild`): adopted only from the live stream of a
    daemon session, so the daemon holds them.
- No other path sends input (`fspec astgrep` for `sendInput`, `submitInput`,
  `sendInputWithThinking`).

## Design

- `sendInput` and `sendInputWithThinking` decode `Result<void>` (golden
  vectors `send_input_ok`, `send_input_err`); `prompt` unwraps it, so a refused
  input fails its turn with the daemon's reason
  (`fspec daemon send_input failed: Session not found: …`).
- `open` with persistence resumes first; a failed resume fails the open with
  `fspec could not resume session <id>: <reason>` and creates nothing. The
  "started a new one" notice is removed.

## Alternatives rejected

- Resume on a refused send and retry: the implicit resume fspec just removed,
  re-implemented on the client.
- Keep starting a fresh session after a failed resume: silently swaps the
  user's conversation for an empty one.

## Wire changes

- `send_input(session_id, text) -> Result<(), String>` (idx 4)
- `send_input_with_thinking(session_id, text, thinking) -> Result<(), String>` (idx 46)
