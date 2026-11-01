# AST research: daemon frame decoding and explicit URL (FSPEC-064)

```
$ fspec astgrep --lang typescript --path server --pattern 'decodeEnvelope($A)'
server/daemon.ts:422:22:decodeEnvelope(bytes)

```

```
$ fspec astgrep --lang typescript --path server --pattern 'decodeResponseFrame($A)'
server/daemon.ts:436:30:decodeResponseFrame(envelope.frame)

```

```
$ fspec astgrep --lang typescript --path server --pattern 'parsed.port !== "" ? $A : $B'
server/daemon.ts:326:9:parsed.port !== "" ? Number(parsed.port) : parsed.protocol === "wss:" ? 443 : 80

```

- decodeEnvelope/decodeResponseFrame are called in daemon.ts onFrame only; both failures are swallowed there.
