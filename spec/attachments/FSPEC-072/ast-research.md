# AST research: section rows with no credential row (FSPEC-072)

```
$ fspec astgrep --lang typescript --path server/settings.ts --pattern '!provider.isUnreachable'
server/settings.ts:218:25:!provider.isUnreachable
```

```
$ fspec astgrep --lang typescript --path server/transcript.ts --pattern 'tool.error ?? $X'
server/transcript.ts:135:43:tool.error ?? "tool failed"
```

```
$ fspec astgrep --lang typescript --path client/settings-model.ts --pattern 'row.configured'
client/settings-model.ts:96:8   (headerStatus)
client/settings-model.ts:122:9  (oauth child rows)
client/settings-model.ts:129:40 (api key child row)
client/settings-model.ts:183:19, 184:16, 185:19 (buildTree configured / canTest / canRefresh)
```

```
$ fspec astgrep --lang typescript --path client/settings-screen.tsx --pattern 'provider.configured'
client/settings-screen.tsx:404:27, 496:19, 515:8 (truthiness only: null reads as not configured)
```

`credentialType: "custom"` for the section-only row is an object-literal
property at server/settings.ts:219 (no expression pattern match).
