# AST research: approval pauses attached by tool call id (FSPEC-059)

```
$ fspec astgrep --lang typescript --path server --pattern 'session.transcript.runningToolCall()'
server/session.ts:463:83:session.transcript.runningToolCall()


$ fspec astgrep --lang typescript --path server --pattern 'async function pauseState($A: FspecSession): Promise<PauseState | null> { $$$B }'
server/session.ts:467:3:async function pauseState(session: FspecSession): Promise<PauseState | null> {


$ fspec astgrep --lang typescript --path server --pattern 'void openPause($A).catch($$$B)'
server/session.ts:1256:11:void openPause(session).catch(() => {})


$ fspec astgrep --lang typescript --path server --pattern 'export function permissionRequest($$$A): ProviderPermissionRequest { $$$B }'
server/interactions.ts:112:1:export function permissionRequest(


$ fspec astgrep --lang typescript --path server --pattern 'export function parseInteractionSnapshot($A: string): Interaction | null { $$$B }'
server/interactions.ts:63:1:export function parseInteractionSnapshot(json: string): Interaction | null {


```

- `runningToolCall` has a single caller: the fallback in `openPause`.
- `pauseState` and the `openPause` caller swallow errors; `permissionRequest` already omits detail/metadata when given no gated tool.
