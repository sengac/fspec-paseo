@done
@provider
@core
@FSPEC-045
Feature: Edit fspec provider settings and profiles from Paseo

  """
  Observed live (FSPEC-042): local-server profiles already appear in list_provider_credentials and list_providers as their own provider rows keyed '<provider>:<profile>' (e.g. 'openai:Strata', credential_type 'custom'), so Paseo catalog ids are 'openai:Strata/<model>'. parseCatalogModelId splits on the first '/', so profile names must not contain '/'. Also: ProfileDefinition has 14 fields (FSPEC-041), not the 7 in this card's research attachment.
  Server (server/settings.ts + shared/settings.ts): fspec.settings.provider-settings {providerId} → { settings, profiles: [{ name, definition }] } with every apiKey replaced by apiKeySet; fspec.settings.save-settings {providerId, definition}; fspec.settings.save-profile {providerId, originalName | null, name, definition, apiKey: string | null (null keeps the stored key, read back from list_provider_settings)} → rename_profile when the name changed, else save_profile; fspec.settings.delete-profile {providerId, name}. Client: client/settings-form.ts mirrors rust/fspec-tui/src/views/provider_settings/profile_form.rs, profile_form_context.rs and profile_form_parse.rs (fields, placeholders, defaults, parsing, messages, touched toggles); the screen renders it with SettingsInput / SettingsSwitch in the sheet.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. Every provider's '⚙ Settings' row opens a Settings sheet with the TUI's fields from Context Window on — Context Window, Max Output Tokens, Compaction Threshold, Streaming, Auto-Continue, Preserve Thinking, Max Images, Loop Detection, Loop Window, Loop Repeat, Loop Retries — grouped as Limits, Behaviour and Loop detection, with the TUI's placeholders; Save calls save_provider_settings.
  #   2. A profile row opens the profile sheet (and '+ Add profile' a new one) with Name, Base URL and API Key followed by the same fields; openai profiles need a Base URL and an API key, other providers' profiles inherit authentication ('Authentication: inherited unless overridden') so both may stay empty; a new openai profile's Base URL starts as http://localhost:8888.
  #   3. Forms are prefilled like the TUI: an existing definition shows its effective values (streaming on unless off, max images 4, loop window 160, repeat 10, retries 10, loop detection on, preserve thinking on for anthropic and gemini unless set); a new profile starts with streaming and loop detection on and preserve thinking off (on for anthropic and gemini profiles).
  #   4. Values are parsed exactly as the TUI does: Context Window and Max Output Tokens are positive whole numbers or empty (Automatic); Compaction Threshold is 'N%' with N 1-100 or a token count of at least 1000, anything else is dropped; Auto-Continue, Max Images, Loop Window, Loop Repeat and Loop Retries are whole numbers or empty; invalid entries show the TUI's message and nothing is saved.
  #   5. On forms that inherit authentication (provider Settings and non-openai profiles) a toggle is sent only once the user changes it, so untouched toggles keep the daemon's default, as in the TUI.
  #   6. Profile API keys never reach the client: the sheet shows whether a key is stored; an empty key field keeps the stored key and a typed key replaces it.
  #   7. Saving a profile under a new name renames it (rename_profile); Delete asks 'Delete the <profile> profile of <provider>?' and calls delete_profile.
  #   8. After a successful save or delete the list reloads and Paseo refreshes the fspec provider; a failure keeps the sheet open with the daemon's or the parser's message.
  #
  # EXAMPLES:
  #   1. Anthropic's Settings sheet with no stored settings shows Context Window and Max Output Tokens empty ('Automatic (model-specific)'), Streaming on, Preserve Thinking on, Max Images 4, Loop Detection on, Window 160, Repeat 10, Retries 10.
  #   2. Setting Compaction Threshold '80%' saves compaction_threshold_type 'percentage' value 80; '200000' saves 'tokens' 200000; '500' or '150%' save no threshold.
  #   3. Context Window 'abc' shows 'Context Window must be a positive whole number, or empty for Automatic' and saves nothing.
  #   4. Editing OpenAI's Strata profile shows Name 'Strata', Base URL http://10.0.0.5:8080/v1, 'API key stored', and leaving the key empty saves with the stored key.
  #   5. Renaming Strata to 'Strata2' calls rename_profile(openai, Strata, Strata2, …); deleting spark asks 'Delete the spark profile of OpenAI?' then calls delete_profile(openai, spark).
  #   6. A new OpenAI profile without a key is not saved ('Enter the Base URL and API key'); a new Anthropic profile named 'fast' with only Context Window 100000 saves with base URL and key empty.
  #   7. On Gemini's Settings sheet, saving without touching Streaming sends streaming absent; turning it off sends streaming false.
  #
  # ========================================

  Background: User Story
    As a Paseo user running fspec agents
    I want to edit every provider's settings and its profiles from the fspec providers screen
    So that I can tune context, compaction, streaming, thinking, images and loop detection, and manage endpoints, exactly as in the fspec TUI

  Scenario: A provider's Settings sheet shows the TUI's fields and defaults
    Given anthropic has no stored settings
    When the Settings sheet for anthropic opens
    Then its fields are Context Window, Max Output Tokens, Compaction Threshold, Streaming, Auto-Continue, Preserve Thinking, Max Images, Loop Detection, Loop Window, Loop Repeat and Loop Retries, grouped as Limits, Behaviour and Loop detection
    And Context Window shows the placeholder "Automatic (model-specific)" and Compaction Threshold "80% or 200000"
    And Streaming, Preserve Thinking and Loop Detection are on, and Max Images, Loop Window, Loop Repeat and Loop Retries are empty with the placeholders "4 (default), 0 = no vision", "160 (default)", "10 (default)" and "10 (default), 0 = never retry"

  Scenario: The compaction threshold accepts a percentage or a token count
    Given a Settings form
    When Compaction Threshold is "80%", then "200000", then "500", then "150%"
    Then the definition carries percentage 80, then tokens 200000, then no threshold, then no threshold

  Scenario: An invalid number is refused with the TUI's message
    Given a Settings form
    When Context Window is "abc", or Auto-Continue is "-1"
    Then the form is refused with "Context Window must be a positive whole number, or empty for Automatic", or "Auto-Continue must be 0 (off) or a positive integer budget (e.g. 300)"

  Scenario: Untouched toggles keep the daemon's default on inherited forms
    Given gemini's Settings form opened from a definition without streaming
    When it is saved without touching Streaming, and again after turning Streaming off
    Then the first definition has streaming absent and the second has streaming false

  Scenario: Profile forms follow the provider's authentication rules
    Given a new profile form for openai and one for anthropic
    When the openai form is saved without an API key, and the anthropic form is saved as "fast" with Context Window 100000
    Then the openai form is refused with "Enter the Base URL and API key"
    And the openai form's Base URL starts as "http://localhost:8888"
    And the anthropic profile saves with an empty base URL and key and its untouched toggles absent

  Scenario: Provider settings reach the client without profile keys
    Given the daemon stores openai's Strata profile with key "lm-secret"
    When the client reads openai's provider settings
    Then Strata's definition shows its base URL and that a key is stored
    And the response does not contain "lm-secret"

  Scenario: Saving settings and profiles goes to the right daemon call
    Given openai's Strata profile with key "lm-secret"
    When the client saves openai's settings, saves Strata with an empty key, renames Strata to "Strata2", and deletes "spark"
    Then the daemon receives save_provider_settings, save_profile with key "lm-secret", rename_profile from "Strata" to "Strata2", and delete_profile "spark"

  Scenario: Deleting a profile asks first
    Given OpenAI's spark profile
    When the user asks to delete it
    Then the confirmation reads "Delete the spark profile of OpenAI?"
