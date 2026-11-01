# AST research: default model without implicit writes (FSPEC-061)

```
$ fspec astgrep --lang typescript --path server --pattern 'request({ method: "setDefaultModel", $$$A })'
server/session.ts:911:23:request({ method: "setDefaultModel", model })


$ fspec astgrep --lang typescript --path server --pattern 'request({ method: "getDefaultModel" })'
server/session.ts:905:45:request({ method: "getDefaultModel" })
server/provider.ts:158:33:request({ method: "getDefaultModel" })


$ fspec astgrep --lang typescript --path server --pattern 'export function buildCatalog($$$A): ProviderCatalog { $$$B }'
server/catalog.ts:55:1:export function buildCatalog(providers: readonly ProviderInfo[], fspecDefault: string | null = null): ProviderCatalog {


$ fspec astgrep --lang typescript --path server --pattern 'applyModel(session, $A)'
server/session.ts:956:15:applyModel(session, model)
server/session.ts:1157:38:applyModel(session, model ?? session.defaultModel)


```

- The only `set_default_model` outside the settings feed is in `open`.
- `catalog.defaultModel` (first-model fallback) feeds `open` and `session.defaultModel`, which `configure` applies for a null model.
