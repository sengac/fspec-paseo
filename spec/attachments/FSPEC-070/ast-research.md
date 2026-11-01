# AST research: unmatched tool results (FSPEC-070)

```
$ fspec astgrep --lang typescript --path server/transcript.ts --pattern 'tool($ID, $NAME)'
server/transcript.ts:198:23:tool(chunk.toolCall.id, chunk.toolCall.name)
server/transcript.ts:206:23:tool(chunk.toolProgress.toolCallId, chunk.toolProgress.toolName)
server/transcript.ts:212:23:tool(chunk.toolResult.toolCallId, "tool")
```

Only the ToolResult arm guesses a name; ToolCall and ToolProgress carry fspec's own.

```
$ fspec astgrep --lang typescript --path server/transcript.ts --pattern 'tool.name.toLowerCase()'
server/transcript.ts:86:7:tool.name.toLowerCase()
```

```
$ fspec astgrep --lang typescript --path server/session.ts --pattern 'session.transcript.toolName($ID)'
server/session.ts:1357:42:session.transcript.toolName(chunk.toolResult.toolCallId)
```

Readers of the name: `fspecDetail` (fspec tool rendering), `isSpawnOf`
(AgentManager), and the session's fspec-checkpoint hook via `toolName`.
An unmatched result must match none of them.
