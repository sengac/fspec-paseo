# AST research: explicit daemon discovery (FSPEC-060)

```
$ fspec astgrep --lang typescript --path server --pattern 'function resolveFromDiscovery(): $T { $$$B }'
server/daemon.ts:275:3:function resolveFromDiscovery(): { target?: DaemonTarget; diagnostic?: string } {


$ fspec astgrep --lang typescript --path server --pattern 'function resolveFromDaemonJson(): $T { $$$B }'
server/daemon.ts:290:3:function resolveFromDaemonJson(): { target?: DaemonTarget; diagnostic?: string } {


$ fspec astgrep --lang typescript --path server --pattern 'function liveEntries(): DaemonJson[] { $$$B }'
server/daemon.ts:250:3:function liveEntries(): DaemonJson[] {


$ fspec astgrep --lang typescript --path server --pattern '$X.preferWorkspace($A)'
server/provider.ts:154:28:daemon.preferWorkspace(cwd)
server/board.ts:80:5:probe.preferWorkspace(cwd)


$ fspec astgrep --lang typescript --path server --pattern 'createFspecDaemonClient($A)'
server/settings.ts:120:21:createFspecDaemonClient(options)
server/provider.ts:45:36:createFspecDaemonClient(daemonOptions)
server/provider.ts:63:43:createFspecDaemonClient(daemonOptions)
server/provider.ts:75:18:createFspecDaemonClient(options)
server/board.ts:79:19:createFspecDaemonClient(options)
server/board.ts:227:21:createFspecDaemonClient(options)


$ fspec astgrep --lang typescript --path server --pattern 'async function catalogCacheKey($A: DaemonClientOptions): $T { $$$B }'
server/provider.ts:74:1:async function catalogCacheKey(options: DaemonClientOptions): Promise<string | undefined> {


```

- Discovery lives in `resolveFromDiscovery` (entry, daemon.json, lowest pid) and `resolveFromDaemonJson`; `liveEntries` already reads daemons/*.json.
- Directory hints: provider.ts (first input with a cwd) and board.ts (per panel); settings.ts and the provider's status probe and catalog key have no directory.
- board.ts maps a failed probe to a feed created without the directory.
