# AST research: session resume on reopen
```
server/session.ts:272:9:saved?.sessionId ?? (await request({ method: "createSession", role: null })).sessionId

```
- open() reuses saved.sessionId without telling the daemon; destroy_session (close) removed it from memory, so the reopened id is unknown to the daemon.
- fspec: resume_session (rust/sessions/src/handle_impl.rs:133) loads the manifest and recreates the session in memory when absent.
