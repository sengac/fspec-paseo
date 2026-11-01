# AST research: boards for every served workspace (FSPEC-053)

```
server/board.ts:53:1:export function createBoardFeed(options: DaemonClientOptions = {}): BoardFeed {

server/board.ts:88:3:function onEnvelope(envelope: Envelope): void {

server/board.ts:186:14:within(current.workspace, cwd)
server/board.ts:210:14:within(current.workspace, cwd)
server/board.ts:229:14:within(current.workspace, cwd)
server/board.ts:242:29:within(current.workspace, cwd)

server/board.ts:176:3:function refusal(workspace: string, cwd: string): string {

No matches found
No matches found
No matches found
```

- `createBoardFeed` holds one `units` list for the daemon's single workspace (get_workspace_info) and refuses
  any cwd outside it with `refusal()`; watch/details/move/available all apply `within(current.workspace, cwd)`.
- `onEnvelope` takes `workUnitsUpdate` (start workspace) and session focus events; the
  `workspaceWorkUnitsUpdate` push (FSPEC-049) is ignored.
- The phone entry calls `fspec.board.available` per Paseo workspace (client/register.ts), so serving more
  workspaces there needs no client change.
- `get_work_unit_details` / `move_work_unit_*` use the service cwd (the start workspace) and take no
  workspace argument: they cannot serve another workspace's cards.
- Focus must be scoped by `SessionInfo.project` (snapshot / Created), because two workspaces can hold the
  same work unit id.
