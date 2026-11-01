# AST research: ProviderInfo.provider_id and custom-model writes (FSPEC-056)

```
$ fspec astgrep --lang typescript --path server/wire.ts --pattern 'function readProviderInfo($R: BincodeReader): ProviderInfo { $$$B }'
server/wire.ts:1440:1:function readProviderInfo(r: BincodeReader): ProviderInfo {


$ fspec astgrep --lang typescript --path server/wire.ts --pattern 'function writeProviderInfo($W: BincodeWriter, $P: ProviderInfo): void { $$$B }'
server/wire.ts:1434:1:function writeProviderInfo(w: BincodeWriter, p: ProviderInfo): void {


$ fspec astgrep --lang typescript --path client --pattern 'export function buildTree($A: readonly SettingsProvider[]): TreeProvider[] { $$$B }'
client/settings-model.ts:143:1:export function buildTree(rows: readonly SettingsProvider[]): TreeProvider[] {


$ fspec astgrep --lang typescript --path client --pattern 'row.id.indexOf(":")'
client/settings-model.ts:149:19:row.id.indexOf(":")


$ fspec astgrep --lang typescript --path client --pattern 'CUSTOM_MODEL_PROVIDER'
client/settings-model.ts:105:14:CUSTOM_MODEL_PROVIDER
client/settings-model.ts:127:20:CUSTOM_MODEL_PROVIDER


$ fspec astgrep --lang tsx --path client --pattern 'rpcRef.current.saveCustomModel($A)'
client/settings-screen.tsx:241:32:rpcRef.current.saveCustomModel({ providerId: open.id, profile: sheet.profile, ...input })


$ fspec astgrep --lang tsx --path client --pattern 'rpcRef.current.deleteCustomModel($A)'
client/settings-screen.tsx:250:32:rpcRef.current.deleteCustomModel({ providerId: open.id, profile: sheet.profile, id })


$ fspec astgrep --lang typescript --path server/settings.ts --pattern 'catalog.get($A)'
server/settings.ts:189:28:catalog.get(row.providerId)


```

- `readProviderInfo`/`writeProviderInfo` stop after `is_unreachable`; the new `provider_id` is not read, so the next ProviderInfo misdecodes.
- `buildTree` is the only place deriving a base provider from a section key (`indexOf(":")`); `CUSTOM_MODEL_PROVIDER` gates which profiles show custom-model rows.
- The custom-model writes send the tree row's id (`open.id`); server/settings.ts keys catalog rows by `provider.key`.
