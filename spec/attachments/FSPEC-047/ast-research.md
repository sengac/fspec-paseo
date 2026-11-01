# AST research: custom models (FSPEC-047)

```
client/settings-model.ts:127:1:export function buildTree(rows: readonly SettingsProvider[]): TreeProvider[] {

client/settings-model.ts:101:1:function childRows(row: SettingsProvider, profiles: ReadonlyArray<{ name: string; baseUrl: string }>): TreeRow[] {

server/settings.ts:75:1:function models(entries: readonly ModelEntry[]) {

server/wire.ts:1539:1:function writeCustomModelDefinition(w: BincodeWriter, m: CustomModelDefinition): void {

/Users/rquast/projects/fspec/rust/fspec-tui/src/views/model_selector/form.rs:193:5:pub fn build_definition(&self) -> Option<CustomModelDefinition> {

/Users/rquast/projects/fspec/rust/fspec-tui/src/views/model_selector/form.rs:226:1:pub fn parse_compaction_trigger(raw: &str) -> (Option<String>, Option<u32>) {

/Users/rquast/projects/fspec/rust/sessions/src/profile_sections.rs:66:1:pub fn build_profile_provider_info(

```

- FSPEC-041 already encodes add/update/delete_custom_model (idx 31-33, golden vectors) and
  `CustomModelDefinition`; nothing calls them.
- The settings list folds `openai:<profile>` provider rows under OpenAI (`buildTree`) but drops their models'
  `is_custom`/reasoning/vision (`models()` maps id, name and context window only).
- The TUI manages custom models from its model selector: `a` add on a profile section, `e` edit and `d`
  delete on a custom row; the form's `build_definition` omits blank fields and parses the trigger
  (`80%` -> percentage, `200000` -> tokens); edit prefill only has the wire fields.
- The daemon's add/update guard requires provider id `openai` (`handle_impl_6.rs`), while the TUI passes the
  row's provider key `openai:<profile>` (`build_profile_provider_info`).
