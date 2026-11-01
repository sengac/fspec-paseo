# AST research: sub-agent child tool call link (FSPEC-063)

```
$ fspec astgrep --lang typescript --path server --pattern '$T.toolCallMentioning($A)'
server/session.ts:548:24:parent.transcript.toolCallMentioning(daemonSessionId)

```

```
$ fspec astgrep --lang typescript --path server --pattern 'request({ method: "getSupervisors", $$$A })'
server/session.ts:506:10:request({ method: "getSupervisors", sessionId: daemonSessionId })
server/session.ts:835:49:request({ method: "getSupervisors", sessionId: subordinate })

```

- The only caller of toolCallMentioning is openChild; adoptUnknown swallows the getSupervisors failure with .catch(() => undefined).
