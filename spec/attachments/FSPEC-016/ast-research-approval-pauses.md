# AST research: approval pauses
```
No matches found
server/provider.ts:20:1:const capabilities = ["prompt.message", "session.configure", "session.persistence"] as const;

```
- No code reacts to sessionStateChange; capabilities lack 'permission'; dispatch() has no session.permission branch.
- Live evidence: get_pause_state on a paused session returned Triple 'Bash: RLCD security: P(risk)=0.46282515 >= promptThreshold 0.45 — the engine suspects this operation ...' with the Bash tool_call_id.
