/**
 * Feature: spec/features/fspec-provider-registration.feature
 *
 * Maps the daemon's `list_providers` (idx 28) catalog onto Paseo's model
 * picker. Pure: no daemon access, so the mapping is testable on its own.
 */
import type {
  ProviderCatalog,
  ProviderModel,
  ProviderThinkingOption,
} from "@getpaseo/plugin/server/provider";
import { DEFAULT_MODE, FSPEC_MODES } from "./bot.js";
import type { ProviderInfo, ThinkingLevel } from "./wire.js";

/**
 * ThinkingLevel is global on the wire (Off=0, Low=1, Medium=2, High=3), so the
 * catalog publishes it once at catalog level and never per model.
 */
export const THINKING_OPTIONS: readonly ProviderThinkingOption[] = [
  { id: "off", label: "Off" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

export const DEFAULT_THINKING_OPTION: ThinkingLevel = "off";

/** Joins a provider key and model entry id into a Paseo catalog model id. */
export function catalogModelId(providerKey: string, modelId: string): string {
  return `${providerKey}/${modelId}`;
}

/**
 * Splits a `provider/model` catalog id back into its daemon parts. The first
 * slash separates them; model ids may themselves contain slashes.
 */
export function parseCatalogModelId(id: string): { providerId: string; modelId: string } {
  const slash = id.indexOf("/");
  if (slash <= 0 || slash === id.length - 1) {
    throw new Error(`invalid fspec model id "${id}" — expected "provider/model"`);
  }
  return { providerId: id.slice(0, slash), modelId: id.slice(slash + 1) };
}

export function isThinkingLevel(value: string): value is ThinkingLevel {
  return THINKING_OPTIONS.some((option) => option.id === value);
}

/**
 * Unreachable providers are excluded. The default is fspec's own default
 * model (get_default_model, FSPEC-046) when the catalog lists it; otherwise
 * the catalog carries no defaultModel and marks no model default — a model
 * nobody chose is never the default (FSPEC-061).
 */
export function buildCatalog(providers: readonly ProviderInfo[], fspecDefault: string | null = null): ProviderCatalog {
  const ids: string[] = [];
  for (const provider of providers) {
    if (provider.isUnreachable) continue;
    for (const entry of provider.models) ids.push(catalogModelId(provider.key, entry.id));
  }
  const defaultModel = fspecDefault !== null && ids.includes(fspecDefault) ? fspecDefault : undefined;
  const models: ProviderModel[] = [];
  for (const provider of providers) {
    if (provider.isUnreachable) continue;
    for (const entry of provider.models) {
      const id = catalogModelId(provider.key, entry.id);
      models.push({
        id,
        label: entry.displayName,
        contextWindowMaxTokens: entry.contextWindow,
        ...(id === defaultModel ? { isDefault: true } : {}),
      });
    }
  }
  return {
    models,
    modes: FSPEC_MODES,
    defaultMode: DEFAULT_MODE,
    thinkingOptions: THINKING_OPTIONS,
    ...(defaultModel !== undefined ? { defaultModel } : {}),
    defaultThinkingOption: DEFAULT_THINKING_OPTION,
  };
}
