# AST research + live evidence: fspec command chunks
```
server/transcript.ts:56:1:function toolItem(tool: ToolState): ProviderTimelineItem {

```
- toolItem() renders non-shell tools as unknown {input, output}; the fspec tool therefore shows raw JSON.
- Daemon mode: use_callback=false (is_global_chunk_callback_registered() == false), so no client reply is awaited.
- Live transcript (session 93f4ac52, list-prefixes):
    0 {"UserInput":{"text":"Use your Fspec tool exactly once to run the list-prefixes command (read-only), then tell me how many prefixes there are."}}
    18 {"ToolCall":{"toolCall":{"id":"call_144bad9790534c9e8d05d735","name":"fspec","input":"{\"command\":\"list-prefixes\",\"work_unit_id\":\"NONE\"}"},"correlationId":null,"observedCorrelationIds":null}}
    20 {"ToolResult":{"toolResult":{"tool_call_id":"call_144bad9790534c9e8d05d735","content":"\nPrefixes (91)\n\nQUERY\n  Query and reporting features\n  Work Units: 0/1 (0%)\n\nEXMAP\n  Example Mapping features\n  Work Units: 12/13 (92%)\n\nINIT\n  Initialization and setup\n  Work Units: 16/16 (100%)\n
