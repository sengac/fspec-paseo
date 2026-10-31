# AST research: fspec's default model (FSPEC-046)

```
server/catalog.ts:53:1:export function buildCatalog(providers: readonly ProviderInfo[]): ProviderCatalog {

server/session.ts:763:23:buildCatalog(providers)
server/provider.ts:154:70:buildCatalog(providers)

server/session.ts:738:3:async function createDaemonSession(): Promise<string> {

server/settings.ts:96:1:export function createSettingsFeed(

client/settings-screen.tsx:78:1:export function SettingsScreen({ theme }: PluginSurfaceProps) {

/Users/rquast/projects/fspec/rust/sessions/src/handle_creation.rs:5:1:pub(crate) fn create_session_checked(

/Users/rquast/projects/fspec/rust/fspec-tui/src/app/dispatch_model_thinking_dialogs.rs:88:5:fn handle_model_selected_no_session(&mut self, provider_id: String, model_id: String) {

```

- `buildCatalog` picks `models[0]` as the default ("the wire exposes no get_default_model"); callers: provider.ts
  `catalog` and session.ts `open` (for `session.defaultModel`, used by open and configure(model: null)).
- `createDaemonSession` calls `create_session_checked`; fspec's implementation answers `Ok("")` when no default
  model is set (PROV-101 decline, logged as "create_session declined: no default model set"), which the plugin
  currently passes on as an id and then fails with "Session not found: ".
- The TUI's no-session model selection calls `set_default_model("{provider}/{model}")` and then creates the
  session — the same `provider/model` form as the plugin's catalog ids (`catalogModelId`).
- Settings: `createSettingsFeed` already encodes `setDefaultModel` (idx 30, FSPEC-041) but nothing calls it;
  `SettingsScreen` has one Providers section; `SettingsSelect` from `@getpaseo/plugin/client/ui` fits a model pick.
