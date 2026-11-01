@done
@provider
@core
@FSPEC-047
@FSPEC-056
Feature: Manage fspec custom models from Paseo
  """
  shared/settings.ts: settingsModelSchema gains optional isCustom/supportsReasoning/supportsVision (set for custom models); settingsProviderSchema carries providerId (the base provider) and profileName (FSPEC-056); saveCustomModelRpc { providerId, profile, originalId, definition } and deleteCustomModelRpc. server/settings.ts: saveCustomModel (originalId null -> addCustomModel, else updateCustomModel) and deleteCustomModel over the FSPEC-041 codec (idx 31-33). client/custom-model-form.ts (pure: fields, prefill, build, prompts); client/settings-model.ts folds profile sections by providerId/profileName and builds customModel/addCustomModel rows carrying the section's providerId; client/custom-model-sheet.tsx; client/settings-screen.tsx sends that providerId. FSPEC-056: ProviderInfo's last field provider_id (fspec BUG-325, rpc-types/src/dialogs.rs) names the base provider of a profile section ('openai' for 'openai:<profile>'); fspec refuses every custom-model write it cannot apply (rust/sessions/src/profile_sections/custom_models.rs).
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. Custom models belong to a profile of the openai provider (fspec's profile_sections guard rejects any other provider id); the provider tree lists each openai profile's custom models (list_providers entries of key 'openai:<profile>' with is_custom) under its profile row, then '+ Add model to <profile>'
  #   2. The custom model sheet has the fspec TUI's eight fields (rust/fspec-tui/src/views/model_selector/form_fields.rs): Model ID (required), Display Name, Facade (openai, codex, claude, gemini, zai or default), Context Window, Max Output Tokens, Compaction Trigger ('80%' or '200000'), Reasoning, Vision
  #   3. Saving builds a CustomModelDefinition like the TUI's build_definition: trimmed id, blank optional fields omitted, a trailing-% trigger is percentage, a bare number is tokens; a blank Model ID or a non-number limit is refused in the form and nothing is sent
  #   4. A new model is written with add_custom_model (idx 31: 'openai', profile, definition); an edited one with update_custom_model (idx 32) carrying its original id, so renaming the id replaces the entry; delete asks 'Delete the custom model <name> from <profile>?' and calls delete_custom_model (idx 33)
  #   5. Editing prefills only what list_providers reports (id, display name unless it equals the id, context window, reasoning, vision); facade, max output and trigger start blank, as in the TUI
  #   6. After every successful write the screen reloads the list and refreshes Paseo's fspec models, so the model appears in the picker; a daemon error is shown on the sheet and changes nothing
  #   7. FSPEC-056: ProviderInfo is { key, display_name, models, profile_name, is_unreachable, provider_id }; a settings row carries providerId and profileName from it (a credential row is its own base provider, no profile); the tree folds sections by providerId/profileName without parsing keys, and custom-model writes send the section's providerId
  #
  # EXAMPLES:
  #   1. Profile Strata of openai serves custom model qwen3-coder ('Qwen3 Coder') -> tree rows '📁 Strata → http://10.0.0.5:8080/v1', '◆ Qwen3 Coder', '+ Add model to Strata'
  #   2. Add: Model ID 'qwen3-coder', Display Name 'Qwen3 Coder', Facade openai, Context Window 32768, Trigger '80%', Reasoning on -> add_custom_model('openai', 'Strata', { id: 'qwen3-coder', displayName: 'Qwen3 Coder', facade: 'openai', contextWindow: 32768, compactionThresholdType: 'percentage', compactionThresholdValue: 80, reasoning: true, hasVision: false })
  #   3. Edit qwen3 -> id changed to qwen3-coder -> update_custom_model('openai', 'Strata', 'qwen3', { id: 'qwen3-coder', ... })
  #   4. Delete qwen3-coder -> confirm 'Delete the custom model Qwen3 Coder from Strata?' -> delete_custom_model('openai', 'Strata', 'qwen3-coder')
  #   5. FSPEC-056: a section keyed 'lab-section' with providerId 'openai' and profileName 'Lab' folds under OpenAI as profile Lab; delete answers "Model 'qwen3' not found in profile 'Strata'" -> shown, nothing reloads
  #
  # ========================================
  Background: User Story
    As a Paseo user running local OpenAI-compatible servers through fspec profiles
    I want to add, edit and delete the custom models of an fspec profile from the fspec providers screen
    So that models my server offers but fspec cannot discover appear in Paseo's model picker without editing fspec-config.json

  Scenario: Custom models show under their profile in the provider tree
    Given the openai profile "Strata" at "http://10.0.0.5:8080/v1" serves the custom model "qwen3-coder" named "Qwen3 Coder" and the plain model "llama3"
    When the screen builds the provider tree
    Then the OpenAI rows include "📁 Strata → http://10.0.0.5:8080/v1", "◆ Qwen3 Coder" and "+ Add model to Strata" in that order
    And "llama3" has no custom model row

  Scenario: Adding a custom model writes it to the profile
    Given the custom model sheet for a new model in profile "Strata"
    When the user enters Model ID "qwen3-coder", Display Name "Qwen3 Coder", Facade "openai", Context Window "32768", Compaction Trigger "80%" and turns Reasoning on, then saves
    Then the daemon received add_custom_model for provider "openai" and profile "Strata" with id "qwen3-coder", facade "openai", context window 32768, a percentage trigger of 80, reasoning on and vision off
    And the screen reloaded the list and refreshed Paseo's fspec models

  Scenario: Editing a custom model replaces it by its original id
    Given the custom model sheet for "qwen3" in profile "Strata", prefilled from the listed model
    When the user changes the Model ID to "qwen3-coder" and saves
    Then the daemon received update_custom_model for provider "openai", profile "Strata" and original id "qwen3" with id "qwen3-coder"
    And the prefilled display name was blank because the listed name equals the id

  Scenario: Deleting a custom model asks first
    Given the custom model sheet for "qwen3-coder" named "Qwen3 Coder" in profile "Strata"
    When the user deletes it and confirms
    Then the confirmation read "Delete the custom model Qwen3 Coder from Strata?"
    And the daemon received delete_custom_model for provider "openai", profile "Strata" and id "qwen3-coder"

  Scenario: A custom model needs a model id and whole-number limits
    Given the custom model sheet for a new model in profile "Strata"
    When the user saves with an empty Model ID, and then with Context Window "lots"
    Then the form shows "Enter the model ID" and then "Context Window must be a whole number"
    And nothing was sent to the daemon

  Scenario: A refused write is shown and changes nothing
    Given add_custom_model answers "Profile 'Strata' not found"
    When the user saves a new custom model
    Then the sheet shows "Profile 'Strata' not found"
    And the list was not reloaded

  Scenario: ProviderInfo carries its base provider as its last field
    Given the Rust golden vectors for ProviderInfo of the "openai:lab" profile section with provider_id "openai" and of the "anthropic" provider
    When the codec decodes and re-encodes them
    Then the profile section decodes to key "openai:lab", profile "lab" and provider id "openai", the cloud provider to provider id "anthropic"
    And both re-encode to the golden bytes

  Scenario: Profile sections fold under the provider their provider id names
    Given list_providers lists a section keyed "lab-section" with provider id "openai", profile "Lab" and the custom model "qwen3-coder", and OpenAI's settings list the profile "Lab"
    When the settings list is loaded and the screen builds the provider tree
    Then the OpenAI rows include "📁 Lab → http://lab:8080/v1", "◆ Qwen3 Coder" and "+ Add model to Lab"
    And the custom model row and the add row carry provider id "openai", which saving the custom model sends

  Scenario: A refused custom model delete is shown and changes nothing
    Given delete_custom_model answers "Model 'qwen3' not found in profile 'Strata'"
    When the user deletes the custom model "qwen3" from "Strata"
    Then the sheet shows "Model 'qwen3' not found in profile 'Strata'"
    And the list was not reloaded
