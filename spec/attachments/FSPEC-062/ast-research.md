# AST research: workspace path comparison (FSPEC-062)

```
$ fspec astgrep --lang typescript --path server/workspaces.ts --pattern 'function canonicalPath($$$A): string { $$$B }'
server/workspaces.ts:14:1:function canonicalPath(path: string): string {

```

```
$ fspec astgrep --lang typescript --path server --pattern 'within($A, $B)'
server/workspaces.ts:35:10:within(entry.path, cwd)
server/workspaces.ts:36:26:within(best.path, entry.path)
server/daemon.ts:301:80:within(entry.workspace, dir)

```

- canonicalPath is the only path canonicaliser; within() is used by discovery (daemon.ts) and servingWorkspace (sessions, board).
