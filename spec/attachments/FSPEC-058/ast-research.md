# AST research: workspace-scoped card details and moves (FSPEC-058)

```
$ fspec astgrep --lang typescript --path server --pattern 'call($C, { method: "getWorkUnitDetails", $$$A })'
server/board.ts:392:34:call(found.current.connection, { method: "getWorkUnitDetails", id })


$ fspec astgrep --lang typescript --path server --pattern 'call($C, { method, id })'
server/board.ts:411:34:call(found.current.connection, { method, id })


$ fspec astgrep --lang typescript --path server --pattern 'function startOnly($A: string): string { $$$B }'
server/board.ts:348:3:function startOnly(startPath: string): string {


$ fspec astgrep --lang typescript --path server --pattern 'async function workspaces($$$A): Promise<WorkspaceEntry[]> { $$$B }'
server/session.ts:877:3:async function workspaces(): Promise<WorkspaceEntry[]> {
server/board.ts:243:3:async function workspaces(connection: DaemonConnection): Promise<WorkspaceEntry[]> {


$ fspec astgrep --lang typescript --path server --pattern 'request({ method: "getWorkspaceInfo" })'
server/session.ts:880:33:request({ method: "getWorkspaceInfo" })


$ fspec astgrep --lang typescript --path server --pattern 'call($C, { method: "getWorkspaceInfo" })'
server/board.ts:247:35:call(connection, { method: "getWorkspaceInfo" })


```

- The three RPCs are called only from server/board.ts `details` and `move`, both behind `startOnly`.
- `workspaces()` exists twice (board and session registry) with the same get_workspace_info fallback.
