# AST research: bot mode (FSPEC-055)

```
/Users/rquast/projects/fspec/rust/sessions/src/bot.rs:14:1:pub const ORCHESTRATOR_ROLE: &str = "# fspec bot: orchestrator

/Users/rquast/projects/fspec/rust/sessions/src/bot.rs:30:1:pub fn is_bot_role(role: &str) -> bool {

/Users/rquast/projects/fspec/rust/rpc/src/service_declaration/providers_sessions.rs:132:    async fn get_session_role(session_id: SessionId) -> Option<String>;   (grep: the trait method has no body for ast-grep)
server/session.ts:273:3:function configState(session: FspecSession): ProviderConfigState {

server/session.ts:898:65:createDaemonSession(workspace, null)

server/catalog.ts:76:    modes: [],
server/session.ts:278:      modes: [],
   (grep: `modes: []` is an object property, not a statement)
```

- TUI-114 New Bot = `create_session(Some(ORCHESTRATOR_ROLE))` / `create_isolated_session(Some(role))`; nothing else
  changes in the engine. A bot is recognised from `SessionInfo.role` by `is_bot_role` (marker prefix).
- The plugin publishes `modes: []` in the catalog and every config, and creates sessions with `role: null`
  (`createDaemonSession(workspace, null)` after FSPEC-052), so both creation paths only need the role passed.
- A resumed session's role comes back with `get_session_role` (idx 44, `Option<String>`); `set_session_role`
  (idx 45, `Result<(), String>`) changes it live (RPC-022), which maps Paseo's `session.configure` mode.
