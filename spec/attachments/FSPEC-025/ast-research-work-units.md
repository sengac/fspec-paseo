# AST research: work units
```
server/session.ts:950:7:if (event.type !== "removed") return;

server/transcript.ts:65:3:const { command, work_unit_id: _workUnit, ...args } = input;

```
- handleSessionEvent ignores focusChanged; fspecDetail drops work_unit_id; no focus is shown anywhere.
