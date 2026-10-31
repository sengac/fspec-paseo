# AST research: board feed
```
server/provider.ts:98:7:connection.onEnvelope((envelope) => {

No matches found
server/daemon.ts:346:13:envelope.kind === "workUnitsUpdate"

./index.server.ts:7:3:server.registerProvider(createFspecProvider())

```
- Only provider.ts subscribes to envelopes (event + sessionEvent); workUnitsUpdate is only used for the handshake in daemon.ts and never surfaced.
- within() is module-private in server/session.ts — export it for the board's workspace guard.
- index.server.ts only registers the provider; no server.handle RPCs exist yet.
