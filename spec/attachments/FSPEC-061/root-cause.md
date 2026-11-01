# FSPEC-061 root cause: Paseo writes fspec's default model and guesses one

## Problem

- `open` calls `set_default_model` with the model a fresh session opens with
  whenever fspec has no default (`server/session.ts:908-912`): opening an
  agent silently rewrites fspec's configuration.
- The catalog default falls back to the first listed model when fspec has no
  default or does not list it (`server/catalog.ts:55-62`), and `open` uses it
  (`server/session.ts:907`), so a model nobody chose runs the session; a
  resumed session is switched to it too unless a model was saved.
- `configure` with `model: null` applies `session.defaultModel`
  (`server/session.ts:1157`), the open-time guess; with none, `applyModel`
  returns silently (`server/session.ts:288-289`).
- fspec creates every session with its default model before any
  `set_session_model` (`/Users/rquast/projects/fspec/rust/sessions/src/handle_creation.rs:9-12`
  declines with an empty id; `rust/sessions/src/default_project.rs:37-39`
  errors), so without a default no fresh session can open, chosen model or
  not.

## Design

- No `set_default_model` outside the settings screen's Default model row.
- The catalog's `defaultModel` is fspec's default model when the catalog
  lists it, otherwise absent; no model is marked default.
- Fresh session: `get_default_model` must answer a model. Without one the
  open fails before anything is created:
  - no model chosen: "fspec has no default model — choose a model for this
    agent and set fspec's default model under fspec providers";
  - a model chosen: "fspec has no default model — fspec starts every session
    on its default model, so set one under fspec providers before opening
    <model>".
  The session runs the chosen model, else fspec's default.
- Resumed session: the chosen model, else the saved one; with neither it keeps
  the model fspec restored.
- `configure` with `model: null` reads `get_default_model` and applies it;
  without one it fails with "fspec has no default model to reset to — choose
  a model".

## Alternatives rejected

- Keep writing the default "like the TUI": the user's rule is no implicit
  writes; the settings screen sets it explicitly.
- Keep the first-model default: a model nobody chose.

## Wire changes

None.
