# AST research: stderr markers
```
server/transcript.ts:189:9:state.output = chunk.toolResult.content

```
- Tool result content is stored verbatim, so fspec's '⚠stderr⚠' line markers reach Paseo's shell cards.
- Live evidence: session 8ef5bc9b seq 593 ToolResult content '⚠stderr⚠real	0m0.017s
⚠stderr⚠user	0m0.004s
⚠stderr⚠sys	0m0.007s
'.
