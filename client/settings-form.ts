import type { Definition, StoredDefinition } from "../shared/settings.js";

/**
 * The provider Settings and profile form (FSPEC-045), a port of the fspec
 * TUI's rust/fspec-tui/src/views/provider_settings/profile_form.rs,
 * profile_form_context.rs and profile_form_parse.rs: the same fields in the
 * same order, placeholders, defaults, parsing and messages. Pure.
 */

export type TextKey =
  | "name"
  | "baseUrl"
  | "apiKey"
  | "contextWindow"
  | "maxOutputTokens"
  | "compactionThreshold"
  | "autoContinue"
  | "maxImages"
  | "loopWindow"
  | "loopRepeat"
  | "loopRetries";
export type ToggleKey = "streaming" | "preserveThinking" | "loopDetection";
export type FieldGroup = "Connection" | "Limits" | "Behaviour" | "Loop detection";

export interface FormField {
  key: TextKey | ToggleKey;
  label: string;
  placeholder: string;
  group: FieldGroup;
  toggle: boolean;
}

/** PROFILE_FORM_FIELDS with placeholder_for, plus the profile's Name line. */
export const FORM_FIELDS: readonly FormField[] = [
  { key: "name", label: "Name", placeholder: "(profile name)", group: "Connection", toggle: false },
  { key: "baseUrl", label: "Base URL", placeholder: "http://localhost:8888", group: "Connection", toggle: false },
  { key: "apiKey", label: "API Key", placeholder: "", group: "Connection", toggle: false },
  { key: "contextWindow", label: "Context Window", placeholder: "Automatic (model-specific)", group: "Limits", toggle: false },
  { key: "maxOutputTokens", label: "Max Output Tokens", placeholder: "Automatic (model-specific)", group: "Limits", toggle: false },
  { key: "compactionThreshold", label: "Compaction Threshold", placeholder: "80% or 200000", group: "Limits", toggle: false },
  { key: "streaming", label: "Streaming", placeholder: "", group: "Behaviour", toggle: true },
  { key: "autoContinue", label: "Auto-Continue", placeholder: "0 (off) or n (budget)", group: "Behaviour", toggle: false },
  { key: "preserveThinking", label: "Preserve Thinking", placeholder: "", group: "Behaviour", toggle: true },
  { key: "maxImages", label: "Max Images", placeholder: "4 (default), 0 = no vision", group: "Behaviour", toggle: false },
  { key: "loopDetection", label: "Loop Detection", placeholder: "", group: "Loop detection", toggle: true },
  { key: "loopWindow", label: "Loop Window", placeholder: "160 (default)", group: "Loop detection", toggle: false },
  { key: "loopRepeat", label: "Loop Repeat", placeholder: "10 (default)", group: "Loop detection", toggle: false },
  { key: "loopRetries", label: "Loop Retries", placeholder: "10 (default), 0 = never retry", group: "Loop detection", toggle: false },
];

export const DEFAULT_PROFILE_BASE_URL = "http://localhost:8888";

type NumberKey = Exclude<TextKey, "name" | "baseUrl" | "apiKey">;

export interface FormState {
  kind: "settings" | "profile";
  providerId: string;
  /** The stored profile's name; null for settings and new profiles. */
  originalName: string | null;
  name: string;
  baseUrl: string;
  /** A newly typed key; empty keeps the stored one. */
  apiKey: string;
  apiKeySet: boolean;
  /** Settings and non-openai profiles inherit the provider's authentication. */
  inheritedAuth: boolean;
  text: Record<NumberKey, string>;
  toggles: Record<ToggleKey, boolean>;
  /**
   * ProfileFormContext: what is sent for each toggle on inherited forms —
   * the stored value until the user changes it.
   */
  sent: Record<ToggleKey, boolean | null>;
}

export type BuildResult =
  | { ok: true; name: string; definition: Definition; apiKey: string | null }
  | { ok: false; error: string };

function num(value: number | null): string {
  return value === null ? "" : String(value);
}

/** render_threshold. */
function threshold(type: string | null, value: number | null): string {
  if (value === null) return "";
  if (type === "percentage") return `${value}%`;
  if (type === "tokens") return String(value);
  return "";
}

function thinkingDefault(providerId: string): boolean {
  return providerId === "anthropic" || providerId === "gemini";
}

function emptyText(): Record<NumberKey, string> {
  return {
    contextWindow: "",
    maxOutputTokens: "",
    compactionThreshold: "",
    autoContinue: "",
    maxImages: "",
    loopWindow: "",
    loopRepeat: "",
    loopRetries: "",
  };
}

/** from_definition: every effective value, defaults filled in. */
function fromDefinition(base: Omit<FormState, "text" | "toggles" | "sent" | "baseUrl" | "apiKeySet">, def: StoredDefinition): FormState {
  return {
    ...base,
    baseUrl: def.baseUrl,
    apiKeySet: def.apiKeySet,
    text: {
      contextWindow: num(def.contextWindow),
      maxOutputTokens: num(def.maxOutputTokens),
      compactionThreshold: threshold(def.compactionThresholdType, def.compactionThresholdValue),
      autoContinue: num(def.autoContinue),
      maxImages: String(def.maxImages ?? 4),
      loopWindow: String(def.loopDetectionWindow ?? 160),
      loopRepeat: String(def.loopDetectionMaxRepeats ?? 10),
      loopRetries: String(def.loopDetectionMaxRetries ?? 10),
    },
    toggles: {
      streaming: def.streaming ?? true,
      preserveThinking: def.preserveThinking ?? false,
      loopDetection: def.loopDetectionEnabled ?? true,
    },
    sent: { streaming: def.streaming, preserveThinking: def.preserveThinking, loopDetection: def.loopDetectionEnabled },
  };
}

/** apply_optional_defaults: optional numbers stay empty unless stored. */
function applyOptionalDefaults(form: FormState, def: StoredDefinition): FormState {
  return {
    ...form,
    text: {
      ...form.text,
      maxImages: num(def.maxImages),
      loopWindow: num(def.loopDetectionWindow),
      loopRepeat: num(def.loopDetectionMaxRepeats),
      loopRetries: num(def.loopDetectionMaxRetries),
    },
    toggles: { ...form.toggles, preserveThinking: def.preserveThinking ?? thinkingDefault(form.providerId) },
  };
}

const EMPTY_DEFINITION: StoredDefinition = {
  baseUrl: "",
  apiKeySet: false,
  contextWindow: null,
  maxOutputTokens: null,
  compactionThresholdType: null,
  compactionThresholdValue: null,
  streaming: null,
  autoContinue: null,
  preserveThinking: null,
  maxImages: null,
  loopDetectionEnabled: null,
  loopDetectionWindow: null,
  loopDetectionMaxRepeats: null,
  loopDetectionMaxRetries: null,
};

/** ProfileForm::from_settings: a provider's Settings sheet. */
export function settingsForm(providerId: string, def: StoredDefinition | null): FormState {
  const base = { kind: "settings" as const, providerId, originalName: null, name: "", apiKey: "", inheritedAuth: true };
  const stored = def ?? EMPTY_DEFINITION;
  return applyOptionalDefaults(fromDefinition(base, stored), stored);
}

/**
 * A profile sheet: ProfileForm::new_for_provider for a new profile,
 * from_provider_definition (or from_definition for openai) for a stored one.
 */
export function profileForm(providerId: string, name: string | null, def: StoredDefinition | null): FormState {
  const inheritedAuth = providerId !== "openai";
  if (def === null) {
    return {
      kind: "profile",
      providerId,
      originalName: null,
      name: "",
      baseUrl: inheritedAuth ? "" : DEFAULT_PROFILE_BASE_URL,
      apiKey: "",
      apiKeySet: false,
      inheritedAuth,
      text: emptyText(),
      toggles: { streaming: true, preserveThinking: inheritedAuth && thinkingDefault(providerId), loopDetection: true },
      sent: { streaming: null, preserveThinking: null, loopDetection: null },
    };
  }
  const base = { kind: "profile" as const, providerId, originalName: name, name: name ?? "", apiKey: "", inheritedAuth };
  const form = fromDefinition(base, def);
  return inheritedAuth ? applyOptionalDefaults(form, def) : form;
}

/** The fields a sheet shows: Settings starts at Context Window (first_field = 2). */
export function visibleFields(form: FormState): FormField[] {
  return form.kind === "settings" ? FORM_FIELDS.filter((field) => field.group !== "Connection") : [...FORM_FIELDS];
}

export function setText(form: FormState, key: TextKey, value: string): FormState {
  if (key === "name" || key === "baseUrl" || key === "apiKey") return { ...form, [key]: value };
  return { ...form, text: { ...form.text, [key]: value } };
}

/** Changing a toggle also decides what is sent for it (profile_form_streaming.rs). */
export function setToggle(form: FormState, key: ToggleKey, value: boolean): FormState {
  return { ...form, toggles: { ...form.toggles, [key]: value }, sent: { ...form.sent, [key]: value } };
}

class FormError extends Error {}

function whole(raw: string, message: string): number | null {
  const text = raw.trim();
  if (text === "") return null;
  if (!/^\d+$/.test(text)) throw new FormError(message);
  return Number(text);
}

/** parse_token_limit. */
function tokenLimit(raw: string, label: string): number | null {
  const message = `${label} must be a positive whole number, or empty for Automatic`;
  const value = whole(raw, message);
  if (value === 0) throw new FormError(message);
  return value;
}

/** parse_compaction_trigger + profile_compaction_trigger: anything out of range is dropped. */
function compaction(raw: string): { type: string | null; value: number | null } {
  const text = raw.trim();
  const percent = /^(\d+)\s*%$/.exec(text);
  if (percent) {
    const n = Number(percent[1]);
    return n >= 1 && n <= 100 ? { type: "percentage", value: n } : { type: null, value: null };
  }
  if (/^\d+$/.test(text) && Number(text) >= 1000) return { type: "tokens", value: Number(text) };
  return { type: null, value: null };
}

/** build_definition. */
export function buildDefinition(form: FormState): BuildResult {
  if (form.kind === "profile" && form.name.trim() === "") return { ok: false, error: "Enter a profile name" };
  if (!form.inheritedAuth && (form.baseUrl.trim() === "" || (form.apiKey === "" && !form.apiKeySet))) {
    return { ok: false, error: "Enter the Base URL and API key" };
  }
  try {
    const t = form.text;
    const contextWindow = tokenLimit(t.contextWindow, "Context Window");
    const maxOutputTokens = tokenLimit(t.maxOutputTokens, "Max Output Tokens");
    const autoContinue = whole(t.autoContinue, "Auto-Continue must be 0 (off) or a positive integer budget (e.g. 300)");
    const maxImages = whole(t.maxImages, "Max Images must be a whole number (0 = no vision, 4 = default)");
    const loopDetectionWindow = whole(t.loopWindow, "Loop Window must be a whole number of words (160 = default)");
    const loopDetectionMaxRepeats = whole(t.loopRepeat, "Loop Repeat must be a whole number (10 = default)");
    const loopDetectionMaxRetries = whole(
      t.loopRetries,
      "Loop Retries must be a whole number (0 = never retry, 10 = default)",
    );
    const threshold = compaction(t.compactionThreshold);
    // Inherited forms send a toggle only once it was changed; openai profiles always send it.
    const toggle = (key: ToggleKey) => (form.inheritedAuth ? form.sent[key] : form.toggles[key]);
    return {
      ok: true,
      name: form.name.trim(),
      apiKey: form.apiKey === "" ? null : form.apiKey,
      definition: {
        baseUrl: form.baseUrl.trim(),
        contextWindow,
        maxOutputTokens,
        compactionThresholdType: threshold.type,
        compactionThresholdValue: threshold.value,
        streaming: toggle("streaming"),
        autoContinue,
        preserveThinking: toggle("preserveThinking"),
        maxImages,
        loopDetectionEnabled: toggle("loopDetection"),
        loopDetectionWindow,
        loopDetectionMaxRepeats,
        loopDetectionMaxRetries,
      },
    };
  } catch (error) {
    if (error instanceof FormError) return { ok: false, error: error.message };
    throw error;
  }
}

export function deletePrompt(profile: string, providerName: string): string {
  return `Delete the ${profile} profile of ${providerName}?`;
}
