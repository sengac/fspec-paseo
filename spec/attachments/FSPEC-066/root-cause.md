# FSPEC-066 root cause: a failing daemon looks like an unserved directory; open in agent guesses a model

## Problem

- The per-daemon `available()` (`server/board.ts:420-427`) answers
  `{ available: false }` for every error, and the client turns a failed RPC
  into `false` as well (`client/board-buttons.ts:53`). A refused
  `list_workspaces`, a lost connection or an unreadable daemons directory is
  shown exactly like "the daemon does not serve this directory": the button
  disappears and nobody learns why.
- `openInAgent` (`client/open-in-agent.ts:61`) uses the first listed model
  when none is marked default, starting an agent on a model nobody chose
  (FSPEC-061 removed the same guess on the server).
- `listModels` (`client/board-panel.tsx:224`) treats a response without
  `models` as an empty list and ignores its `error`
  (`paseo/packages/protocol/src/messages.ts:6274-6283`).
- The workspace subscription's release failure is swallowed
  (`client/register.ts:137`).

## Fix

- `fspec.board.available` answers `{ state: "served" }`,
  `{ state: "unserved", reason }` or `{ state: "failed", error }`.
  Unserved: discovery finds no daemon (no live entry, or none whose workspace
  holds the directory — `DaemonNotFoundError` from server/daemon.ts), or the
  daemon's workspaces hold none for it. Everything else is failed.
- Client: served → the button; unserved → no button; failed → the error is
  logged and the button is shown titled `fspec board (error)`, so the panel
  it opens reports the failure.
- `openInAgent` uses the model marked default (fspec's default model) and
  fails `fspec has no default model — set one under fspec providers` without
  one; `listModels` throws Paseo's `error`, and a response without models
  fails `Paseo listed no fspec models`.
- The release failure is logged.

## Alternatives rejected

- Hide the button on failure and only log: invisible to the user.
