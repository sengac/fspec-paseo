# FSPEC-068 root cause: daemon JSON is decoded leniently

## Problem

- `server/transcript-json.ts:56-64`: `str`, `num`, `strings` and `severity`
  turn a missing or mistyped field into `""`, `0`, `[]` or `"info"`;
  `InterruptedWithReason.reason` is `"user"` for anything but loopdetector
  (line 195); an object with no key is variant `""` (line 79); a variant
  body that is not an object becomes `{}` (line 82).
- `server/interactions.ts:78,100`: a snapshot or question that is not an
  object becomes `{}`, `text()` (line 57) defaults strings to `""`, a missing
  `options` to `[]`.
- `server/interactions.ts:174`: a HITL answer without an `answers` object is
  sent as empty answers; `:198-202`: an unknown `selectedActionId` falls back
  to the response's behavior.

## The shapes fspec writes

- Transcript entries: serde JSON of `StreamChunk`
  (`rust/rpc-types/src/stream_chunk.rs`) — externally tagged, unit variants
  as a bare string, no `skip_serializing_if`, so every field is present and
  `Option`s are `null`. `NotificationSeverity` is `"Info" | "Warning" |
  "Error"`, `InterruptionReason` `"user" | "loopDetector"`
  (`work_units.rs:36-41`); field types in `chunk_support.rs`.
- Interaction snapshot (`rust/sessions/src/background_session/interactions.rs:72-77`):
  `{"pause":{"request_id","state":null|{kind,tool_name,message,details}},
  "hitl":{"request_id","state":null|{questions:[{id,header,question,options:null|[{label,description}]}]}}}`.

## Fix

Strict readers that throw `<where>.<field> is not a <type>`: required
strings/numbers/booleans/arrays must have their type; `Option` fields must be
`null` or their type; enums must be one of their serde names; an entry must
be a bare unit-variant string or an object with exactly one key whose body is
an object. Snapshot: `pause` and `hitl` objects required, a non-null state
needs a string `request_id`, a HITL request needs at least one question.
Answers: an allowed HITL reply needs an `answers` object; an unknown
`selectedActionId` is an error. Failures surface through the existing paths
(replay notice, FSPEC-059 pause-unreadable notice, permission request
failure).

## Alternatives rejected

- Keep defaults for "robustness": a wrong row or reply is worse than a
  visible error, and the shapes are fixed by fspec.
