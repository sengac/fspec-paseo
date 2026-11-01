# AST research: sessions in their own workspace (FSPEC-052)

```
Error: Invalid AST pattern 'async open(input: $T): Promise<void> { $$$B }' for typescript.

Pattern error: Multiple AST nodes are detected. Please check the pattern source `async open(input: $T): Promise<void> { $$$B }`.
server/session.ts:876:35:request({ method: "getWorkspaceInfo" })
server/session.ts:1021:35:request({ method: "getWorkspaceInfo" })

server/session.ts:189:1:export function within(root: string, dir: string): boolean {

server/session.ts:877:12:within(workspace.cwd, input.config.cwd)
server/session.ts:1022:39:within(workspace.cwd, input.cwd)
server/board.ts:186:14:within(current.workspace, cwd)
server/board.ts:210:14:within(current.workspace, cwd)
server/board.ts:229:14:within(current.workspace, cwd)
server/board.ts:242:29:within(current.workspace, cwd)

No matches found
No matches found
```

- `open` (session.ts) asks `get_workspace_info` and refuses any cwd outside the daemon's single workspace
  (FSPEC-015); `list` does the same for the import list. `within` (realpath compare) is reused by board.ts.
- fspec now serves several workspaces: `list_workspaces` (start first, from the persisted registry, RPC-441/442)
  and `create_session_in_workspace(workspace, role)`, which opens the workspace (`SharedFspecService::workspace`)
  and creates the session with its project set to the canonical path; it errors for non-directories and when
  no default model is set (`create_session_in_workspace declined: no default model set`).
- The plugin must keep `create_session_checked` for the start workspace (the session's default project) and
  map a cwd inside a listed workspace to that workspace instead of opening a nested one.
