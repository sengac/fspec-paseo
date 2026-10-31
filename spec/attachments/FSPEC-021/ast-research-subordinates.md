# AST research: subordinate sessions
```
server/session.ts:619:7:const session = byDaemonId.get(daemonSessionId);

server/provider.ts:93:9:if (envelope.kind === "event") sessions.handleChunk(envelope.sessionId, envelope.chunk);

```
- handleChunk drops chunks for unmapped daemon sessions; sessionEvent envelopes are never routed. Subordinate output is invisible.
