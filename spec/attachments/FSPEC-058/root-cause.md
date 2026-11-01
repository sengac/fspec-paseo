# FSPEC-058 root cause: card details and moves only work on the start workspace

## Problem

- fspec RPC-450 (commit 76cb29f6): `get_work_unit_details`, `move_work_unit_up`
  and `move_work_unit_down` take `(workspace: String, id: String)`
  (`/Users/rquast/projects/fspec/rust/rpc/src/service_declaration/supervision_credentials.rs:266`,
  `workspace.rs:112`, `:115`); the workspace is resolved like
  `list_workspace_work_units` and an unknown one is an error. There is no
  start-workspace default.
- The plugin encodes `(id)` only (`server/wire.ts:676-678`, `:1852-1855`,
  `:2028-2031`), so every call misframes against a HEAD daemon.
- FSPEC-053 refuses details and moves on any board but the start workspace's
  (`server/board.ts:348-350` `startOnly`, `:391`, `:409`) — a restriction that
  existed only because the RPCs had no workspace.
- Workspace-list fallbacks in the same code: when `list_workspaces` errors or
  is empty both the board (`server/board.ts:243-251`) and the session registry
  (`server/session.ts:877-882`) pretend the daemon serves only
  `get_workspace_info`'s cwd; the board takes the first listed workspace as the
  start one when none is marked start (`server/board.ts:266`); a session whose
  project is unknown is counted on the start workspace's board
  (`server/board.ts:311`).

## Design

- Requests become `{ workspace, id }`, encoded `string(workspace) string(id)`
  (golden vector `work_unit_details_args`, identical bytes for both moves;
  `move_work_unit_ok`).
- `details` and `move` send the served workspace that holds the panel's cwd
  (`found.entry.path`) for every board; `startOnly` and its refusals are
  removed.
- `list_workspaces` failing is an error with the daemon's reason; an empty
  list is an error ("the fspec daemon lists no workspaces"); a list with no
  start entry is an error. No `get_workspace_info` substitute.
- A session whose project is unknown shows on no board.

## Alternatives rejected

- Keep refusing non-start workspaces: the daemon now serves them.
- Send the start workspace when the panel's workspace is unknown: the panel
  always resolves its workspace first; an unresolvable cwd is already refused.

## Wire changes

- `get_work_unit_details(workspace, id) -> Result<String, String>` (idx 123)
- `move_work_unit_up(workspace, id) -> Result<(), String>` (idx 18)
- `move_work_unit_down(workspace, id) -> Result<(), String>` (idx 19)
