# AST research: board availability and open in agent (FSPEC-066)

```
$ fspec astgrep --lang typescript --path client --pattern 'deps.available($A).catch(() => false)'
client/board-buttons.ts:53:26:deps.available(directory).catch(() => false)

```

```
$ fspec astgrep --lang typescript --path client --pattern 'models.find($F) ?? models[0]'
client/open-in-agent.ts:61:17:models.find((entry) => entry.isDefault) ?? models[0]

```

```
$ fspec astgrep --lang tsx --path client/board-panel.tsx --pattern '(await paseo.providers.listModels($A)).models ?? []'
client/board-panel.tsx:224:20:(await paseo.providers.listModels("fspec")).models ?? []

```

```
$ fspec astgrep --lang typescript --path index.server.ts --pattern 'board.available($A)'
index.server.ts:34:47:board.available(input)

```

```
$ fspec astgrep --lang typescript --path client --pattern 'release?.().catch(() => {})'
client/register.ts:137:16:release?.().catch(() => {})

```

- server/board.ts has two available() implementations (the per-directory router and the per-daemon feed, whose bare catch answers false).
