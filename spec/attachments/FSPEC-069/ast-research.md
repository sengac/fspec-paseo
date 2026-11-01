# AST research: unlisted credential rows (FSPEC-069)

```
$ fspec astgrep --lang typescript --path server/settings.ts --pattern 'provider?.isUnreachable ?? $X'
server/settings.ts:200:26:provider?.isUnreachable ?? !row.configured
```

```
$ fspec astgrep --lang typescript --path server/settings.ts --pattern 'catalog.get($K)'
server/settings.ts:189:28:catalog.get(row.providerId)
```

```
$ fspec astgrep --lang typescript --path client/settings-model.ts --pattern 'provider.unreachable'
client/settings-model.ts:251:28:provider.unreachable
```

```
$ fspec astgrep --lang typescript --path shared/settings.ts --pattern 'z.boolean()'
shared/settings.ts:32:16:z.boolean()   (settingsProviderSchema.unreachable)
```

The only reader of `unreachable` is `defaultModelChoice` (client/settings-model.ts:251);
the header (`headerStatus`, :94) does not show reachability at all.
