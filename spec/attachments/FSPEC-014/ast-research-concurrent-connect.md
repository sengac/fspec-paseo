# AST research: concurrent connect
```
server/daemon.ts:421:5:if (state === "established" && socket !== null) {

server/daemon.ts:427:5:const sock = openSocket(resolved.url);

```
- connect() reuses only an established socket; during 'connecting' every caller opens another socket.
