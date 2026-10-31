# AST research: refused watch
```
server/board.ts:169:9:if (!within(current.workspace, cwd)) {

server/board.ts:171:11:if (sinceRevision === revision) await hold();
server/board.ts:181:9:if (sinceRevision === revision) await hold();

```
- The guard branch returned before the hold check; only the error and ready paths held unchanged watches.
