# AST research: provider settings failures (FSPEC-065)

```
$ fspec astgrep --lang typescript --path server --pattern 'async function catalogCacheKey($$$A): $R { $$$B }'
server/provider.ts:77:1:async function catalogCacheKey(options: DaemonClientOptions): Promise<string | undefined> {

```

```
$ fspec astgrep --lang typescript --path client/settings-actions.ts --pattern '$X.catch(() => {})'
client/settings-actions.ts:39:9:Promise.resolve(deps.reload()).catch(() => {})
client/settings-actions.ts:40:9:deps.refreshPaseo().catch(() => {})

```

```
$ fspec astgrep --lang tsx --path client/settings-screen.tsx --pattern 'runWrite($$$A)'
client/settings-screen.tsx:149:27:runWrite({
client/settings-screen.tsx:166:27:runWrite({ write: () => rpcRef.current.setDefaultModel({ model }), reload, refreshPaseo })
client/settings-screen.tsx:240:39:runWrite({
client/settings-screen.tsx:249:39:runWrite({
client/settings-screen.tsx:269:39:runWrite({
client/settings-screen.tsx:278:39:runWrite({
client/settings-screen.tsx:287:39:runWrite({
client/settings-screen.tsx:311:25:runWrite({ write: async () => ({ ok: true as const }), reload, refreshPaseo })
client/settings-screen.tsx:327:39:runWrite({
client/settings-screen.tsx:336:39:runWrite({

```

```
$ fspec astgrep --lang tsx --path client/oauth-sheet.tsx --pattern '$X.catch(() => {})'
client/oauth-sheet.tsx:161:42:rpcs.current.cancel({ loginId: loginId.current }).catch(() => {})
client/oauth-sheet.tsx:222:88:copyText(step.userCode).catch(() => {})

```

```
$ fspec astgrep --lang tsx --path client/oauth-sheet.tsx --pattern 'try { $$$A } catch { $$$B }'
client/oauth-sheet.tsx:130:7:try {

```

- runWrite has eight call sites in settings-screen.tsx, each showing the outcome's warning or error on the row; the OAuth sheet's watch loop retries silently in its bare catch.
