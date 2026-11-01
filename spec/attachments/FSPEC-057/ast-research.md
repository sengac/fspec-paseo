# AST research: send_input results and explicit resume (FSPEC-057)

```
$ fspec astgrep --lang typescript --path server --pattern 'request({ method: "sendInput", $$$A })'
server/session.ts:1137:17:request({ method: "sendInput", sessionId: session.daemonSessionId, text })


$ fspec astgrep --lang typescript --path server --pattern 'request({ method: "submitInput", $$$A })'
server/session.ts:791:32:request({ method: "submitInput", sessionId: session.daemonSessionId, text, mode: "steer" })
server/session.ts:1134:36:request({ method: "submitInput", sessionId: session.daemonSessionId, text, mode: "queue" })


$ fspec astgrep --lang typescript --path server --pattern 'request({ method: "sendInputWithThinking", $$$A })'
No matches found

$ fspec astgrep --lang typescript --path server --pattern 'async function resume($A: string): Promise<string | null> { $$$B }'
server/session.ts:409:3:async function resume(daemonSessionId: string): Promise<string | null> {


$ fspec astgrep --lang typescript --path server --pattern 'await resume($A)'
server/session.ts:915:35:await resume(saved.sessionId)


$ fspec astgrep --lang typescript --path server --pattern 'createDaemonSession($$$A)'
server/session.ts:922:17:createDaemonSession(workspace, requested === "bot" ? ORCHESTRATOR_ROLE : null)


```

- One `send_input` call site (prompt to an idle session); `submit_input` is used for queued and steered input and already unwraps its Result.
- `resume` is called only from `open` for a saved session (reopen and import both arrive as `session.open` with persistence); a failed resume currently falls through to `createDaemonSession`.
- The codec reads no payload for `sendInput`/`sendInputWithThinking` replies; `sendInputWithThinking` is never sent by the plugin but its reply must decode.
