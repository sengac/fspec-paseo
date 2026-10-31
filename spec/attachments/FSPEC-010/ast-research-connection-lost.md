# AST research: connection lost
```
server/daemon.ts:415:5:emitEvent({ type: "connection-lost", reason, code })

No matches found
server/transcript.ts:110:3:function terminalize(): ProviderTimelineItem[] {

```
- daemon.ts emits connection-lost from handleDrop, but nothing in server/ subscribes (no daemon.onEvent match), so the provider never reacts.
