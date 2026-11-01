@done
@provider
@core
@FSPEC-046
@FSPEC-061
Feature: Follow fspec's default model in Paseo
  """
  server/wire.ts getDefaultModel 127 (request no fields, response Option<String>). server/catalog.ts buildCatalog(providers, defaultModel). server/provider.ts catalog and server/session.ts open() read it. FSPEC-061: the plugin never calls setDefaultModel (30) on its own; a fresh open without fspec's default model fails before creating anything, because fspec creates every session on its default model (rust/sessions/src/handle_creation.rs create_session_checked, default_project.rs create_session_in_workspace_checked); the catalog default is fspec's default only when listed (no first-model default); a resumed session keeps its model unless one is chosen; configure(model null) applies fspec's current default. An empty created id is still the PROV-101 decline (rust/sessions/src/handle_creation.rs create_session_checked returns Ok(empty) without a default). shared/settings.ts: settings.list gains defaultModel; new fspec.settings.set-default-model RPC. client/settings-model.ts defaultModelChoice (pure); client/settings-screen.tsx a Default model SettingsSelect section.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. get_default_model (idx 127, no arguments) answers Option<String> 'provider/model'; the provider reads it for the catalog and for every session.open
  #   2. The catalog's defaultModel (and isDefault) is fspec's default model when the catalog lists it; otherwise the first reachable model, as before
  #   3. An agent opened with no explicit or saved model gets fspec's default model; an explicit or saved model still wins and is applied with set_session_model
  #   4. When fspec has no default model, the model the agent opens with (explicit, saved, else the catalog's first) is made fspec's default with set_default_model before the session is created, as the fspec TUI does when a model is chosen with no session (PROV-118); with no model at all the open fails
  #   5. create_session_checked answering Ok with an empty id (fspec declined: no default model) fails the open with 'fspec could not create a session: fspec has no default model — choose one under fspec providers' instead of a later 'Session not found'
  #   6. The fspec providers screen has a Default model row listing every reachable model as provider/model, showing fspec's current default (or 'Not set'); choosing one calls set_default_model (idx 30), then reloads and refreshes Paseo's fspec models
  #   FSPEC-061: no implicit set_default_model; no first-model catalog default; a fresh open without fspec's default model fails before anything is created; a resumed session keeps its model unless one is chosen; resetting the model applies fspec's current default or fails
  #
  # EXAMPLES:
  #   1. get_default_model = Some('openai/gpt-5'), catalog anthropic/claude-sonnet-4, openai/gpt-5 -> catalog defaultModel 'openai/gpt-5' with isDefault on it; Paseo opens an agent with no model -> set_session_model(openai, gpt-5), session.config model 'openai/gpt-5'
  #   2. get_default_model = None; Paseo opens with model 'openai/gpt-5' -> set_default_model('openai/gpt-5') then create_session_checked, set_session_model(openai, gpt-5)
  #   3. Settings screen: Default model shows 'anthropic/claude-sonnet-4'; the user picks 'openai/gpt-5' -> fspec.settings.set-default-model { model: 'openai/gpt-5' } -> set_default_model('openai/gpt-5'), list reloads, paseo.providers.refresh(['fspec'])
  #   4. Golden: get_default_model reply 01 19000000.. 'anthropic/claude-sonnet-4' decodes to model 'anthropic/claude-sonnet-4'; 00 decodes to null; the request is variant index 127 (7f000000) with no argument bytes
  #
  # ========================================
  Background: User Story
    As a Paseo user running fspec agents
    I want to have Paseo follow fspec's default model and change that default from the fspec providers screen
    So that new agents use the model I chose in fspec instead of whichever model happens to be listed first

  Scenario: get_default_model matches the daemon's encoding
    Given the Rust golden vectors for get_default_model answering "anthropic/claude-sonnet-4" and answering nothing
    When the codec decodes those replies and encodes a get_default_model request
    Then the replies decode to the model "anthropic/claude-sonnet-4" and to no model
    And the request is variant index 127 with no argument bytes

  Scenario: The catalog marks fspec's default model as the default
    Given fspec's default model is "openai/gpt-5" and the catalog lists "anthropic/claude-sonnet-4" then "openai/gpt-5"
    When Paseo asks the provider for its catalog
    Then the catalog's defaultModel is "openai/gpt-5" and only that model is marked isDefault

  Scenario: A default the catalog does not list leaves the catalog without a default
    Given fspec's default model is "gone/old-model" and the catalog lists "anthropic/claude-sonnet-4" then "openai/gpt-5"
    When Paseo asks the provider for its catalog
    Then the catalog has no defaultModel and no model is marked isDefault

  Scenario: An agent opened without a model follows fspec's default model
    Given fspec's default model is "openai/gpt-5"
    When Paseo opens an fspec agent with no model and no saved model
    Then the provider set the session's model to provider "openai" and model "gpt-5"
    And the committed session.config model is "openai/gpt-5"
    And fspec's default model was not changed

  Scenario: With no default model an agent with a chosen model fails to open
    Given fspec has no default model
    When Paseo opens an fspec agent with model "openai/gpt-5"
    Then the open fails with "fspec has no default model — fspec starts every session on its default model, so set one under fspec providers before opening openai/gpt-5"
    And the provider sent no set_default_model and created no session

  Scenario: With no default model an agent without a model fails with what to do
    Given fspec has no default model
    When Paseo opens an fspec agent with no model
    Then the open fails with "fspec has no default model — choose a model for this agent and set fspec's default model under fspec providers"
    And the provider sent no set_default_model, no create_session_checked and no set_session_model

  Scenario: A resumed session keeps its own model when none is chosen
    Given fspec's default model is "openai/gpt-5" and a saved session "fspec-sess-7" whose persistence names no model
    When Paseo reopens it with no model
    Then the provider resumed "fspec-sess-7" and sent no set_session_model

  Scenario: Resetting an agent's model follows fspec's current default
    Given an open fspec agent and fspec's default model is now "openai/gpt-5"
    When Paseo resets the agent's model to the default, and later resets it again after fspec's default model was cleared
    Then the first reset set the session's model to provider "openai" and model "gpt-5"
    And the second fails with "fspec has no default model to reset to — choose a model"

  Scenario: The settings screen shows and changes fspec's default model
    Given fspec's default model is "anthropic/claude-sonnet-4" and the reachable models are "anthropic/claude-sonnet-4" and "openai/gpt-5"
    When the settings list is loaded and the user chooses "openai/gpt-5" as the default model
    Then the Default model row shows "anthropic/claude-sonnet-4" and offers both models
    And the server called set_default_model with "openai/gpt-5"
    And the screen reloaded the list and refreshed Paseo's fspec models
