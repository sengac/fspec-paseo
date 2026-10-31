# AST research: HITL questions
```
server/session.ts:324:3:async function openPause(session: FspecSession): Promise<void> {

server/session.ts:326:5:const { pause } = await request({ method: "getPauseState", sessionId: session.daemonSessionId });

```
- openPause only reads get_pause_state; a HITL pause (pause state None) emits nothing, so the question never reaches Paseo.
