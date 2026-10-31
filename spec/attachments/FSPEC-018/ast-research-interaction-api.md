# AST research: interaction API
```
server/session.ts:354:23:await request({ method: "getPauseState", sessionId: session.daemonSessionId })

server/session.ts:623:30:await request({ method: "pauseTriple", sessionId: session.daemonSessionId, choice })

server/session.ts:613:30:await request({

```
- Legacy calls answer whatever pause is current; reply_interaction_checked checks request_id atomically (interaction_slot.rs respond(expected)).
