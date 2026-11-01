# AST research: session background failures (FSPEC-067)

```
$ fspec astgrep --lang typescript --path server/session.ts --pattern '$X.catch(() => {})'
server/session.ts:572:10:request({ method: "getActiveSession" })
server/session.ts:599:10:request({ method: "setActiveSession", sessionId: session.daemonSessionId }).catch(() => {})
server/session.ts:786:11:request({
server/session.ts:842:11:visit(daemonSessionId).catch(() => {})
server/session.ts:849:13:request({ method: "destroySession", sessionId: subordinate }).catch(() => {})
server/session.ts:984:17:request({ method: "destroySession", sessionId: daemonSessionId }).catch(() => {})
server/session.ts:991:13:rememberCheckpoints().catch(() => {})
server/session.ts:1023:12:seedFocus(session).catch(() => {})
server/session.ts:1161:13:request({ method: "interrupt", sessionId: session.daemonSessionId }).catch(() => {})
server/session.ts:1284:14:attachCheckpoint(session, chunk.toolResult.toolCallId).catch(() => {})

```

```
$ fspec astgrep --lang typescript --path server/session.ts --pattern '$X.catch(() => undefined)'
server/session.ts:506:10:request({ method: "getSupervisors", sessionId: daemonSessionId })

```

```
$ fspec astgrep --lang typescript --path server/session.ts --pattern '$X.catch(() => ({ result: null }))'
server/session.ts:859:30:request({ method: "persistenceSearchHistory", query }).catch(() => ({ result: null }))

```

