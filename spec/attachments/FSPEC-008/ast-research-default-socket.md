# AST research: default WebSocket factory
```
server/daemon.ts:158:62:new globalThis.WebSocket(url)

No matches found
```
- Default factory never sets binaryType; Node's WebSocket defaults to 'blob'. toBytes returns null for Blob, so onMessage drops every frame.
