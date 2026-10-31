# AST research: replay coalescing
```
server/session.ts:233:11:publish(session, parseStreamChunkJson(pending), {

```
- replay() publishes each assembled chunk immediately through publish(), so every delta snapshot becomes a timeline.item.
