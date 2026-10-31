import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsInput, SettingsRow, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { Definition, ProviderSettingsOutput, SaveProfileInput } from "../shared/settings.js";
import { StripButton } from "./board-details.js";
import {
  buildDefinition,
  deletePrompt,
  type FieldGroup,
  type FormField,
  type FormState,
  profileForm,
  setText,
  setToggle,
  settingsForm,
  type TextKey,
  type ToggleKey,
  visibleFields,
} from "./settings-form.js";

type Theme = PluginSurfaceProps["theme"];
type Outcome = { ok: true } | { ok: false; error: string };

export interface FormSheetProps {
  kind: "settings" | "profile";
  providerId: string;
  providerName: string;
  /** The profile being edited; null for Settings and a new profile. */
  profile: string | null;
  theme: Theme;
  load(): Promise<ProviderSettingsOutput>;
  saveSettings(definition: Definition): Promise<Outcome>;
  saveProfile(input: Omit<SaveProfileInput, "providerId">): Promise<Outcome>;
  deleteProfile(name: string): Promise<Outcome>;
  onDone(): void;
}

function value(form: FormState, key: TextKey): string {
  if (key === "name" || key === "baseUrl" || key === "apiKey") return form[key];
  return form.text[key];
}

/**
 * The Settings / profile sheet (FSPEC-045): the fspec TUI's profile form as
 * grouped Paseo settings rows. All behaviour lives in settings-form.ts.
 */
export function FormSheet(props: FormSheetProps) {
  const { theme } = props;
  const c = theme.colors;
  const [form, setForm] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    let live = true;
    props
      .load()
      .then((answer) => {
        if (!live) return;
        if (answer.state !== "ready") return setLoadError(answer.reason);
        if (props.kind === "settings") return setForm(settingsForm(props.providerId, answer.settings));
        const stored = answer.profiles.find((profile) => profile.name === props.profile)?.definition ?? null;
        setForm(profileForm(props.providerId, stored === null ? null : props.profile, stored));
      })
      .catch((failure: unknown) => live && setLoadError(failure instanceof Error ? failure.message : String(failure)));
    return () => {
      live = false;
    };
    // Load once per sheet; the screen re-keys the sheet for another target.
  }, [props.kind, props.providerId, props.profile]);

  if (loadError !== null) return <Text style={{ color: c.statusDanger }}>{loadError}</Text>;
  if (form === null) return <Text style={{ color: c.foregroundMuted }}>Loading…</Text>;

  async function save(current: FormState) {
    const built = buildDefinition(current);
    if (!built.ok) return setError(built.error);
    setBusy(true);
    const outcome =
      current.kind === "settings"
        ? await props.saveSettings(built.definition)
        : await props.saveProfile({
            originalName: current.originalName,
            name: built.name,
            definition: built.definition,
            apiKey: built.apiKey,
          });
    setBusy(false);
    if (outcome.ok) props.onDone();
    else setError(outcome.error);
  }

  async function remove(name: string) {
    setBusy(true);
    const outcome = await props.deleteProfile(name);
    setBusy(false);
    setConfirmingDelete(false);
    if (outcome.ok) props.onDone();
    else setError(outcome.error);
  }

  const fields = visibleFields(form);
  const groups: FieldGroup[] = [...new Set(fields.map((field) => field.group))];

  const fieldRow = (field: FormField) => {
    if (field.toggle) {
      const key = field.key as ToggleKey;
      return (
        <SettingsSwitch
          key={key}
          label={field.label}
          value={form.toggles[key]}
          onValueChange={(next) => setForm((current) => (current === null ? current : setToggle(current, key, next)))}
        />
      );
    }
    const key = field.key as TextKey;
    let hint: string | undefined;
    if (key === "apiKey") {
      hint = form.apiKeySet
        ? "A key is stored. Leave empty to keep it."
        : form.inheritedAuth
          ? "Leave empty to use the provider's key."
          : "Stored by the fspec daemon; never shown again.";
    }
    return (
      <SettingsInput
        key={key}
        label={field.label}
        hint={hint}
        placeholder={field.placeholder}
        initialValue={key === "apiKey" ? "" : value(form, key)}
        secureTextEntry={key === "apiKey"}
        onChangeText={(text) => setForm((current) => (current === null ? current : setText(current, key, text)))}
      />
    );
  };

  return (
    <View style={{ gap: 14 }}>
      {form.kind === "profile" && form.inheritedAuth ? (
        <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>Authentication: inherited unless overridden</Text>
      ) : null}
      {groups.map((group) => (
        <View key={group} style={{ gap: 6 }}>
          <Text style={{ color: c.foreground, fontWeight: "600", fontSize: 13 }}>{group}</Text>
          <SettingsCard>{fields.filter((field) => field.group === group).map(fieldRow)}</SettingsCard>
        </View>
      ))}
      {error !== null ? (
        <SettingsCard>
          <SettingsRow label="Not saved" error={error} />
        </SettingsCard>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
        {form.originalName !== null ? (
          confirmingDelete ? (
            <>
              <Text style={{ color: c.foreground, alignSelf: "center" }}>{deletePrompt(form.originalName, props.providerName)}</Text>
              <StripButton theme={theme} label="Delete" onPress={() => void remove(form.originalName!)} />
              <StripButton theme={theme} label="Keep" onPress={() => setConfirmingDelete(false)} />
            </>
          ) : (
            <StripButton theme={theme} label="Delete profile" onPress={() => setConfirmingDelete(true)} />
          )
        ) : null}
        <StripButton theme={theme} label="Cancel" onPress={props.onDone} />
        <StripButton theme={theme} label={busy ? "Saving…" : "Save"} onPress={() => !busy && void save(form)} />
      </View>
    </View>
  );
}
