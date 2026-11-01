# FSPEC-060 design: one explicit rule for the daemon serving a directory

## Problem

FSPEC-054's `resolveFromDiscovery` (`server/daemon.ts:275-290`) picks the live
`daemons/<pid>.json` entry whose workspace holds the hinted directory, else
the daemon `daemon.json` names (`:290-318`), else the live entry with the
lowest pid. A directory no daemon serves silently reaches whichever daemon
happens to own `daemon.json`. The board (`server/board.ts:77-90`) turns a
failed discovery into a feed with no directory, which then runs discovery
without one.

## What fspec exposes

- Every local daemon writes `daemons/<pid>.json` (`port, pid, workspace,
  started_at, version`) beside `daemon.json`
  (`/Users/rquast/projects/fspec/rust/fspec/src/common/daemon_registry.rs:8-16, 33-41`);
  `list_live_daemons` keeps live pids. `workspace` is the daemon's start
  workspace.
- The workspace registry (`rust/common/src/workspace_registry.rs`) lives in
  the fspec data directory (`workspaces.json`), shared by every daemon using
  that data directory, and each daemon records its start workspace there
  (`rust/fspec/src/daemon.rs:48-50`). It cannot tell daemons apart, and the
  discovery entry does not name a data directory, so "the registry serves the
  directory" is true of every daemon or of none. It is not used.
- `daemon.json` is only a default pointer (BUG-289); every daemon it can name
  also has a `daemons/` entry.

## Rule

- An explicit connect URL (`connectUrl` option or `FSPEC_DAEMON_URL`) wins and
  skips discovery; it must be loopback.
- Otherwise the candidates are the live `daemons/<pid>.json` entries.
  - A client bound to a Paseo directory: a daemon serves the directory when
    its entry's `workspace` holds it (realpath comparison, `within`).
  - A client with no directory (settings screen, availability probe, catalog
    key without a cwd): every live daemon qualifies.
- Exactly one qualifying daemon is used. None or more than one fails the
  connection with a message naming the candidates (pid, workspace, port) and
  the way out (start fspec in the directory, stop one, or set
  `FSPEC_DAEMON_URL`). Nested workspaces holding the same directory are "more
  than one".
- `daemon.json` is no longer read or removed.
- A directory is bound once (`bindDirectory`, first one wins, set before the
  first connect); the board binds a client per panel directory, and a failed
  discovery keeps a feed bound to that directory, reporting its reason.
- The catalog cache key binds the request's cwd when Paseo passes one.

## Alternatives rejected

- Deepest workspace wins among nested candidates: a choice the user did not
  make; the explicit URL covers it.
- Probing each daemon's `list_workspaces`: one socket per daemon per connect,
  and the shared registry makes every daemon answer the same.
- Keeping `daemon.json` as the no-directory default: a fallback.

## Wire changes

None.
