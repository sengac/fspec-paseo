# AST research: WorkspaceWorkUnitsUpdate envelope (FSPEC-049)

```
server/wire.ts:1622:1:export function decodeEnvelope(bytes: Uint8Array): Envelope {

server/wire.ts:1578:1:export function encodeEnvelope(envelope: Envelope): Uint8Array {

server/daemon.ts:355:22:decodeEnvelope(bytes)

server/board.ts:88:3:function onEnvelope(envelope: Envelope): void {

server/provider.ts:130:7:connection.onEnvelope((envelope) => {
server/board.ts:135:7:connection.onEnvelope(onEnvelope)

/Users/rquast/projects/fspec/rust/rpc-server/src/workspace_fanout.rs:22:27:Envelope::WorkspaceWorkUnitsUpdate(push)
```

- `decodeEnvelope` throws `unknown Envelope variant index 9` for every index > 8; its only live caller is
  `server/daemon.ts` `onFrame`, which catches the throw and drops the frame, so the push never reaches
  `connection.onEnvelope` listeners (provider.ts session routing, board.ts).
- fspec appends `WorkspaceWorkUnitsUpdate(WorkspaceWorkUnits)` last (index 9) and sends it from the
  per-connection `workspace_fanout::run` task to every full-surface connection, only for workspaces opened
  besides the start workspace. Payload: `workspace: String` then `units: Vec<WorkUnitInfo>` (existing reader).
- Listeners branch on `envelope.kind`, so a new kind is ignored by provider.ts and board.ts without changes;
  the board must not treat it as a start-workspace `workUnitsUpdate`.
