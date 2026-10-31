# AST research: daemon workspace guard
```
server/session.ts:360:14:input.config.cwd

```
- config.cwd is only echoed into session.opened; nothing compares it with the daemon workspace.
- fspec: get_workspace_info (rust/rpc/src/service_declaration/workspace.rs:134) returns WorkspaceInfo { cwd, git_branch }; no RPC sets a per-session cwd.
