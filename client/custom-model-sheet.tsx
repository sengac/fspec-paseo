import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsInput, SettingsRow, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text, View } from "react-native";
import type { SaveCustomModelInput, SettingsModel } from "../shared/settings.js";
import { StripButton } from "./board-details.js";
import {
  buildCustomModel,
  type CustomModelForm,
  customModelFormFor,
  deleteCustomModelPrompt,
  FACADES,
  newCustomModelForm,
} from "./custom-model-form.js";

type Theme = PluginSurfaceProps["theme"];
type Outcome = { ok: true } | { ok: false; error: string };
type TextField = "id" | "displayName" | "contextWindow" | "maxOutputTokens" | "compactionTrigger";

const TEXT_FIELDS: ReadonlyArray<{ key: TextField; label: string; placeholder: string }> = [
  { key: "id", label: "Model ID", placeholder: "e.g., meta-llama/Meta-Llama-3.1-405B" },
  { key: "displayName", label: "Display Name", placeholder: "e.g., Llama 3.1 405B" },
  { key: "contextWindow", label: "Context Window", placeholder: "128000" },
  { key: "maxOutputTokens", label: "Max Output Tokens", placeholder: "16384" },
  { key: "compactionTrigger", label: "Compaction Trigger", placeholder: "80% or 200000" },
];

export interface CustomModelSheetProps {
  theme: Theme;
  profile: string;
  /** The listed model being edited; null adds one. */
  model: SettingsModel | null;
  save(input: Omit<SaveCustomModelInput, "providerId" | "profile">): Promise<Outcome>;
  remove(id: string): Promise<Outcome>;
  onDone(): void;
}

/**
 * A profile's custom model (FSPEC-047): the fspec TUI's model selector form
 * as Paseo settings rows. Behaviour lives in custom-model-form.ts.
 */
export function CustomModelSheet(props: CustomModelSheetProps) {
  const { theme } = props;
  const c = theme.colors;
  const [form, setForm] = useState<CustomModelForm>(() =>
    props.model === null ? newCustomModelForm() : customModelFormFor(props.model),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function save() {
    const built = buildCustomModel(form);
    if (!built.ok) return setError(built.error);
    setBusy(true);
    const outcome = await props.save({ originalId: built.originalId, definition: built.definition });
    setBusy(false);
    if (outcome.ok) props.onDone();
    else setError(outcome.error);
  }

  async function remove(id: string) {
    setBusy(true);
    const outcome = await props.remove(id);
    setBusy(false);
    setConfirming(false);
    if (outcome.ok) props.onDone();
    else setError(outcome.error);
  }

  const name = props.model === null ? "" : props.model.displayName;
  return (
    <View style={{ gap: 12 }}>
      {props.model !== null ? (
        <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>
          fspec doesn't report a saved model's Facade, Max Output Tokens or Compaction Trigger: set them again, or they are cleared.
        </Text>
      ) : null}
      <SettingsCard>
        {TEXT_FIELDS.map((field) => (
          <SettingsInput
            key={field.key}
            label={field.label}
            placeholder={field.placeholder}
            initialValue={form[field.key]}
            onChangeText={(text) => setForm((current) => ({ ...current, [field.key]: text }))}
          />
        ))}
        <SettingsSelect
          label="Facade"
          value={form.facade ?? ""}
          options={[{ label: "Default (openai)", value: "" }, ...FACADES.map((facade) => ({ label: facade, value: facade }))]}
          onValueChange={(facade) => setForm((current) => ({ ...current, facade: facade === "" ? null : facade }))}
        />
        <SettingsSwitch
          label="Reasoning"
          value={form.reasoning}
          onValueChange={(reasoning) => setForm((current) => ({ ...current, reasoning }))}
        />
        <SettingsSwitch label="Vision" value={form.vision} onValueChange={(vision) => setForm((current) => ({ ...current, vision }))} />
      </SettingsCard>
      {error !== null ? (
        <SettingsCard>
          <SettingsRow label="Not saved" error={error} />
        </SettingsCard>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
        {props.model !== null ? (
          confirming ? (
            <>
              <Text style={{ color: c.foreground, alignSelf: "center" }}>{deleteCustomModelPrompt(name, props.profile)}</Text>
              <StripButton theme={theme} label="Delete" onPress={() => void remove(props.model!.id)} />
              <StripButton theme={theme} label="Keep" onPress={() => setConfirming(false)} />
            </>
          ) : (
            <StripButton theme={theme} label="Delete model" onPress={() => setConfirming(true)} />
          )
        ) : null}
        <StripButton theme={theme} label="Cancel" onPress={props.onDone} />
        <StripButton theme={theme} label={busy ? "Saving…" : "Save"} onPress={() => !busy && void save()} />
      </View>
    </View>
  );
}
