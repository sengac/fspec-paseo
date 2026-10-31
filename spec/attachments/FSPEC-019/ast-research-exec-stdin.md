# AST research: exec stdin
```
server/wire.ts:903:7:return { type: "unsupported", index: 27 };

server/wire.ts:905:7:return { type: "unsupported", index: 28 };

```
- The codec reads ExecStdinRequest's four fields and discards them; the session never sees the request, so interactive commands hang.
