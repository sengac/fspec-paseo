import type { CustomModelInput, SettingsModel } from "../shared/settings.js";

/**
 * The custom model form (FSPEC-047): the fspec TUI's model selector form
 * (rust/fspec-tui/src/views/model_selector/form.rs, form_fields.rs) as pure
 * state and transforms, so the sheet only renders it.
 */

/** form_fields.rs Facade options; null is fspec's default (openai). */
export const FACADES = ["openai", "codex", "claude", "gemini", "zai"] as const;

export interface CustomModelForm {
  /** The id being edited; null for a new model. */
  originalId: string | null;
  id: string;
  displayName: string;
  facade: string | null;
  contextWindow: string;
  maxOutputTokens: string;
  compactionTrigger: string;
  reasoning: boolean;
  vision: boolean;
}

export type CustomModelBuild =
  | { ok: true; originalId: string | null; definition: CustomModelInput }
  | { ok: false; error: string };

export function newCustomModelForm(): CustomModelForm {
  return {
    originalId: null,
    id: "",
    displayName: "",
    facade: null,
    contextWindow: "",
    maxOutputTokens: "",
    compactionTrigger: "",
    reasoning: false,
    vision: false,
  };
}

/**
 * prefill_from_entry: list_providers reports only the id, name, context
 * window and capabilities, so facade, max output and the trigger start blank.
 * A name equal to the id means none is stored.
 */
export function customModelFormFor(model: SettingsModel): CustomModelForm {
  return {
    ...newCustomModelForm(),
    originalId: model.id,
    id: model.id,
    displayName: model.displayName === model.id ? "" : model.displayName,
    contextWindow: model.contextWindow > 0 ? String(model.contextWindow) : "",
    reasoning: model.supportsReasoning === true,
    vision: model.supportsVision === true,
  };
}

/** parse_compaction_trigger: "80%" is a percentage, "200000" tokens, anything else none. */
function trigger(raw: string): { type: string | null; value: number | null } {
  const text = raw.trim();
  const percent = /^(\d+)\s*%$/.exec(text);
  if (percent) return { type: "percentage", value: Number(percent[1]) };
  if (/^\d+$/.test(text)) return { type: "tokens", value: Number(text) };
  return { type: null, value: null };
}

/** A blank limit is omitted; anything else must be a whole number. */
function limit(raw: string, label: string): { value: number | null } | { error: string } {
  const text = raw.trim();
  if (text === "") return { value: null };
  if (!/^\d+$/.test(text) || Number(text) > 0xffffffff) return { error: `${label} must be a whole number` };
  return { value: Number(text) };
}

/** build_definition: the trimmed id is required, blank optional fields are omitted. */
export function buildCustomModel(form: CustomModelForm): CustomModelBuild {
  const id = form.id.trim();
  if (id === "") return { ok: false, error: "Enter the model ID" };
  const contextWindow = limit(form.contextWindow, "Context Window");
  if ("error" in contextWindow) return { ok: false, error: contextWindow.error };
  const maxOutputTokens = limit(form.maxOutputTokens, "Max Output Tokens");
  if ("error" in maxOutputTokens) return { ok: false, error: maxOutputTokens.error };
  const threshold = trigger(form.compactionTrigger);
  const displayName = form.displayName.trim();
  return {
    ok: true,
    originalId: form.originalId,
    definition: {
      id,
      displayName: displayName === "" ? null : displayName,
      facade: form.facade,
      contextWindow: contextWindow.value,
      maxOutputTokens: maxOutputTokens.value,
      compactionThresholdType: threshold.type,
      compactionThresholdValue: threshold.value,
      reasoning: form.reasoning,
      hasVision: form.vision,
    },
  };
}

export function deleteCustomModelPrompt(name: string, profile: string): string {
  return `Delete the custom model ${name} from ${profile}?`;
}
