# AST research: daemon discovery and bearer auth (FSPEC-054)

```
server/daemon.ts:232:3:function resolveFromDaemonJson(): { target?: DaemonTarget; diagnostic?: string } {

server/daemon.ts:263:3:async function resolveTarget(): Promise<DaemonTarget> {

server/daemon.ts:586:1:function defaultOpenSocket(url: string): SocketLike {

server/daemon.ts:462:18:openSocket(resolved.url)

server/settings.ts:108:21:createFspecDaemonClient(options)
server/provider.ts:45:36:createFspecDaemonClient(daemonOptions)
server/provider.ts:63:43:createFspecDaemonClient(daemonOptions)
server/provider.ts:75:18:createFspecDaemonClient(options)
server/board.ts:165:21:createFspecDaemonClient(options)

/Users/rquast/projects/fspec/rust/fspec/src/common/daemon_registry.rs:50:1:pub fn list_live_daemons(dir: &Path) -> Result<Vec<DaemonEntry>> {

/Users/rquast/projects/fspec/rust/fspec/src/common/daemon_registry.rs:85:1:pub fn claim_default_pointer(

```

- Discovery reads exactly one file, daemon.json, and knows no workspace: `resolveTarget()` takes no argument.
  `createFspecDaemonClient` callers: provider.ts (status probe, cache key, one per connection),
  board.ts (one for the board), settings.ts (one for settings).
- fspec RPC-446 writes `daemons/<pid>.json` (daemon.json schema) for every local daemon; `list_live_daemons`
  keeps live pids, deletes the rest, orders by pid. BUG-289: `claim_default_pointer` never overwrites a
  daemon.json that names another live daemon, and `release_default_pointer` hands it to another live one.
- `defaultOpenSocket(url)` calls `new WebSocket(url)`; RPC-447 needs `Authorization: Bearer <token>` on the
  upgrade (`rpc/src/auth_token.rs` reads FSPEC_DAEMON_TOKEN; `rpc-server/src/client/connect.rs` sends it).
  Node's undici WebSocket accepts `new WebSocket(url, { headers })`.
- Board panels carry a cwd per call, so the board can pick a daemon per directory; a provider connection
  learns a cwd only from its first catalog/sessions/session.open input.
