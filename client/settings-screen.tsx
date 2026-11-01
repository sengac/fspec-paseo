import { type PluginSurfaceProps, usePaseo, useRpc } from "@getpaseo/plugin/client";
import {
  Modal,
  SettingsAction,
  SettingsCard,
  type SettingsInputHandle,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  deleteCustomModelRpc,
  deleteProfileRpc,
  oauthCancelRpc,
  oauthCompleteRpc,
  oauthLogoutRpc,
  oauthStartRpc,
  oauthStatusRpc,
  providerSettingsRpc,
  refreshModelsRpc,
  removeCredentialsRpc,
  saveCredentialsRpc,
  saveCustomModelRpc,
  saveProfileRpc,
  saveSettingsRpc,
  setDefaultModelRpc,
  type SettingsListOutput,
  type SettingsProvider,
  settingsListRpc,
  testProviderRpc,
} from "../shared/settings.js";
import { StripButton } from "./board-details.js";
import { CustomModelSheet } from "./custom-model-sheet.js";
import { OAuthLoginSheet, OAuthStatusSheet } from "./oauth-sheet.js";
import { FormSheet } from "./settings-form-sheet.js";
import { runWrite } from "./settings-actions.js";
import {
  removePrompt,
  screenState,
  type Sheet,
  sheetFor,
  testBadge,
  toggleExpanded,
  type TreeProvider,
  type TreeRow,
} from "./settings-model.js";

type Theme = PluginSurfaceProps["theme"];
type Colors = Theme["colors"];

const KEY_NOTE = "Sent to the fspec daemon and stored on the computer running it. Never shown again.";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The TUI's row tints (row_render.rs), mapped onto the Paseo theme. */
function rowTint(kind: TreeRow["kind"], c: Colors): string {
  switch (kind) {
    case "apiKey":
      return c.statusWarning;
    case "settings":
    case "profile":
    case "oauthLogin":
      return c.accent;
    case "oauthStatus":
    case "addProfile":
    case "addCustomModel":
      return c.statusSuccess;
    case "customModel":
      return c.foreground;
  }
}

/**
 * fspec's providers as a Paseo settings screen (FSPEC-043), laid out like the
 * fspec TUI's provider view: one tree of providers, each expanding to its
 * OAuth, API key, Settings and profile rows; a row opens its sheet. Paseo owns
 * the header, Back, scrolling and the phone layout; decisions live in
 * settings-model.ts and settings-actions.ts.
 */
export function SettingsScreen({ theme }: PluginSurfaceProps) {
  const rpc = {
    list: useRpc(settingsListRpc),
    save: useRpc(saveCredentialsRpc),
    remove: useRpc(removeCredentialsRpc),
    test: useRpc(testProviderRpc),
    refresh: useRpc(refreshModelsRpc),
    providerSettings: useRpc(providerSettingsRpc),
    saveSettings: useRpc(saveSettingsRpc),
    saveProfile: useRpc(saveProfileRpc),
    deleteProfile: useRpc(deleteProfileRpc),
    setDefaultModel: useRpc(setDefaultModelRpc),
    saveCustomModel: useRpc(saveCustomModelRpc),
    deleteCustomModel: useRpc(deleteCustomModelRpc),
    oauthStart: useRpc(oauthStartRpc),
    oauthComplete: useRpc(oauthCompleteRpc),
    oauthStatus: useRpc(oauthStatusRpc),
    oauthCancel: useRpc(oauthCancelRpc),
    oauthLogout: useRpc(oauthLogoutRpc),
  };
  // The host may hand out new rpc functions on render; effects must not restart.
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const paseo = usePaseo();
  const toast = useToast();
  const c = theme.colors;
  const [answer, setAnswer] = useState<SettingsListOutput | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  /** The decoration after a provider's status: a test result or a refresh result. */
  const [badges, setBadges] = useState<Record<string, { text: string; ok: boolean }>>({});
  const [allModels, setAllModels] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setAnswer(await rpcRef.current.list({}));
    } catch (error) {
      setAnswer({ state: "unavailable", reason: message(error) });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const refreshPaseo = useCallback(() => paseo.providers.refresh({ providers: ["fspec"] }), [paseo]);
  const badge = (id: string, text: string, ok: boolean) => setBadges((current) => ({ ...current, [id]: { text, ok } }));

  async function test(providerId: string) {
    badge(providerId, "testing…", true);
    try {
      const text = testBadge(await rpcRef.current.test({ providerId }));
      badge(providerId, text, text.startsWith("✓"));
    } catch (error) {
      badge(providerId, `✗ ${message(error)}`, false);
    }
  }

  async function refresh(providerId: string) {
    const show = (text: string) => (providerId === "" ? setAllModels(text) : badge(providerId, text, !text.startsWith("✗")));
    show("refreshing models…");
    let count = 0;
    const outcome = await runWrite({
      write: async () => {
        const result = await rpcRef.current.refresh({ providerId });
        if ("ok" in result && result.ok) {
          count = result.models.length;
          return { ok: true as const };
        }
        return result;
      },
      reload,
      refreshPaseo,
    });
    show(outcome.ok ? `${count} ${count === 1 ? "model" : "models"}` : `✗ ${outcome.error}`);
  }

  async function chooseDefault(model: string) {
    if (model === "") return;
    const outcome = await runWrite({ write: () => rpcRef.current.setDefaultModel({ model }), reload, refreshPaseo });
    setDefaultError(outcome.ok ? null : outcome.error);
    if (outcome.ok) toast.show(`fspec's default model is now ${model}`, { variant: "success" });
  }

  const state = screenState(answer);
  if (state.kind === "loading") {
    return <Text style={{ color: c.foregroundMuted, padding: 16 }}>Loading fspec providers…</Text>;
  }
  if (state.kind === "unavailable") {
    return (
      <SettingsSection title="fspec">
        <SettingsCard>
          <SettingsRow label="fspec daemon unavailable" error={state.reason} />
          <SettingsAction label="Try again" actionLabel="Retry" onPress={() => void reload()} />
        </SettingsCard>
      </SettingsSection>
    );
  }

  const open = state.tree.find((provider) => provider.id === sheet?.providerId) ?? null;

  return (
    <View>
      <SettingsSection title="Default model" info="The model fspec gives new sessions; Paseo's fspec agents follow it">
        <SettingsCard>
          <SettingsSelect
            label="Default model"
            hint={state.defaultModel.value === "" ? "Not set: choose one so fspec can create sessions" : state.defaultModel.value}
            error={defaultError}
            value={state.defaultModel.value}
            options={state.defaultModel.options}
            onValueChange={(model) => void chooseDefault(model)}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection
        title="Providers"
        info={`The providers of the fspec daemon serving ${state.workspace}`}
        trailing={<StripButton theme={theme} label="Refresh all models" onPress={() => void refresh("")} />}
      >
        <Text style={{ color: c.foregroundMuted, fontSize: 12, marginBottom: 6 }} numberOfLines={1}>
          {allModels === null ? state.workspace : `${state.workspace} · ${allModels}`}
        </Text>
        <SettingsCard>
          {state.tree.map((provider) => (
            <ProviderTree
              key={provider.id}
              colors={c}
              theme={theme}
              provider={provider}
              expanded={expanded.has(provider.id)}
              badge={badges[provider.id] ?? null}
              onToggle={() => setExpanded((current) => toggleExpanded(current, provider.id))}
              onTest={() => void test(provider.id)}
              onRefresh={() => void refresh(provider.id)}
              onOpen={(row) => setSheet(sheetFor(provider.id, row))}
            />
          ))}
        </SettingsCard>
      </SettingsSection>
      <Modal
        title={sheet === null || open === null ? "" : sheetTitle(sheet, open)}
        open={sheet !== null && open !== null}
        onOpenChange={(isOpen) => !isOpen && setSheet(null)}
      >
        <Modal.Content>
          {sheet !== null && open !== null && sheet.kind === "customModel" ? (
            <CustomModelSheet
              key={`${sheet.profile}:${sheet.model?.id ?? "+"}`}
              theme={theme}
              profile={sheet.profile}
              model={sheet.model}
              save={async (input) => {
                const outcome = await runWrite({
                  write: () => rpcRef.current.saveCustomModel({ providerId: open.id, profile: sheet.profile, ...input }),
                  reload,
                  refreshPaseo,
                });
                if (outcome.ok) toast.show(`Saved ${input.definition.id} in ${sheet.profile}`, { variant: "success" });
                return outcome;
              }}
              remove={async (id) => {
                const outcome = await runWrite({
                  write: () => rpcRef.current.deleteCustomModel({ providerId: open.id, profile: sheet.profile, id }),
                  reload,
                  refreshPaseo,
                });
                if (outcome.ok) toast.show(`Deleted ${id} from ${sheet.profile}`, { variant: "success" });
                return outcome;
              }}
              onDone={() => setSheet(null)}
            />
          ) : sheet !== null && open !== null && (sheet.kind === "settings" || sheet.kind === "profile") ? (
            <FormSheet
              key={`${sheet.kind}:${sheet.providerId}:${sheet.kind === "profile" ? (sheet.profile ?? "+") : ""}`}
              kind={sheet.kind}
              providerId={open.id}
              providerName={open.displayName}
              profile={sheet.kind === "profile" ? sheet.profile : null}
              theme={theme}
              load={() => rpcRef.current.providerSettings({ providerId: open.id })}
              saveSettings={async (definition) => {
                const outcome = await runWrite({
                  write: () => rpcRef.current.saveSettings({ providerId: open.id, definition }),
                  reload,
                  refreshPaseo,
                });
                if (outcome.ok) toast.show(`Saved ${open.displayName} settings`, { variant: "success" });
                return outcome;
              }}
              saveProfile={async (input) => {
                const outcome = await runWrite({
                  write: () => rpcRef.current.saveProfile({ providerId: open.id, ...input }),
                  reload,
                  refreshPaseo,
                });
                if (outcome.ok) toast.show(`Saved the ${input.name} profile`, { variant: "success" });
                return outcome;
              }}
              deleteProfile={async (name) => {
                const outcome = await runWrite({
                  write: () => rpcRef.current.deleteProfile({ providerId: open.id, name }),
                  reload,
                  refreshPaseo,
                });
                if (outcome.ok) toast.show(`Deleted the ${name} profile`, { variant: "success" });
                return outcome;
              }}
              onDone={() => setSheet(null)}
            />
          ) : sheet !== null && open !== null && (sheet.kind === "oauthLogin" || sheet.kind === "oauthStatus") ? (
            (() => {
              const oauth = {
                theme,
                providerId: open.id,
                rpcs: {
                  start: (input: Parameters<typeof rpc.oauthStart>[0]) => rpcRef.current.oauthStart(input),
                  complete: (input: Parameters<typeof rpc.oauthComplete>[0]) => rpcRef.current.oauthComplete(input),
                  status: (input: Parameters<typeof rpc.oauthStatus>[0]) => rpcRef.current.oauthStatus(input),
                  cancel: (input: Parameters<typeof rpc.oauthCancel>[0]) => rpcRef.current.oauthCancel(input),
                  logout: (input: Parameters<typeof rpc.oauthLogout>[0]) => rpcRef.current.oauthLogout(input),
                },
                onChanged: async (text: string) => {
                  toast.show(text, { variant: "success" });
                  await runWrite({ write: async () => ({ ok: true as const }), reload, refreshPaseo });
                },
                onDone: () => setSheet(null),
              };
              return sheet.kind === "oauthLogin" ? (
                <OAuthLoginSheet key={`${open.id}:${sheet.method}`} {...oauth} method={sheet.method} />
              ) : (
                <OAuthStatusSheet {...oauth} />
              );
            })()
          ) : sheet !== null && open !== null ? (
            <ApiKeySheet
              provider={open.provider}
              theme={theme}
              onTest={() => void test(open.id)}
              save={async (apiKey) => {
                const outcome = await runWrite({
                  write: () => rpcRef.current.save({ providerId: open.id, credential: { kind: "api_key", apiKey } }),
                  reload,
                  refreshPaseo,
                });
                if (outcome.ok) toast.show(`Saved the ${open.displayName} key`, { variant: "success" });
                return outcome;
              }}
              remove={async () => {
                const outcome = await runWrite({
                  write: () => rpcRef.current.remove({ providerId: open.id }),
                  reload,
                  refreshPaseo,
                });
                if (outcome.ok) {
                  setSheet(null);
                  if (outcome.warning !== undefined) toast.show(outcome.warning, { variant: "warning", durationMs: 8000 });
                  else toast.show(`Removed the ${open.displayName} key`, { variant: "success" });
                }
                return outcome;
              }}
            />
          ) : null}
        </Modal.Content>
      </Modal>
    </View>
  );
}

function sheetTitle(sheet: Sheet, provider: TreeProvider): string {
  switch (sheet.kind) {
    case "apiKey":
      return `${provider.displayName} · API key`;
    case "settings":
      return `${provider.displayName} · Settings`;
    case "profile":
      return sheet.profile === null ? `${provider.displayName} · New profile` : `${provider.displayName} · ${sheet.profile}`;
    case "customModel":
      return sheet.model === null ? `${sheet.profile} · New model` : `${sheet.profile} · ${sheet.model.displayName}`;
    case "oauthLogin":
    case "oauthStatus":
      return `${provider.displayName} · Sign in`;
  }
}

/** One provider of the tree: the header row and, expanded, its actions and child rows. */
function ProviderTree(props: {
  colors: Colors;
  theme: Theme;
  provider: TreeProvider;
  expanded: boolean;
  badge: { text: string; ok: boolean } | null;
  onToggle(): void;
  onTest(): void;
  onRefresh(): void;
  onOpen(row: TreeRow): void;
}) {
  const { colors: c, provider } = props;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: props.expanded }}
        accessibilityLabel={`${provider.displayName}, ${provider.status}`}
        onPress={props.onToggle}
        style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 14 }}
      >
        <Text style={{ color: c.foregroundMuted, width: 12, fontSize: 12 }}>{props.expanded ? "▼" : "▶"}</Text>
        <Text style={{ color: c.foreground, fontWeight: "600", minWidth: 110 }} numberOfLines={1}>
          {provider.displayName}
        </Text>
        <Text
          style={{ color: provider.configured ? c.statusSuccess : c.foregroundMuted, flexShrink: 1, fontSize: 13 }}
          numberOfLines={1}
        >
          {provider.status}
        </Text>
        {props.badge !== null ? (
          <Text
            style={{ color: props.badge.ok ? c.statusSuccess : c.statusDanger, fontSize: 13, marginLeft: "auto" }}
            numberOfLines={1}
          >
            {props.badge.text}
          </Text>
        ) : null}
      </Pressable>
      {props.expanded ? (
        <View style={{ paddingBottom: 8 }}>
          {provider.canTest || provider.canRefresh ? (
            <View style={{ flexDirection: "row", gap: 6, paddingLeft: 34, paddingBottom: 6 }}>
              {provider.canTest ? <StripButton theme={props.theme} label="Test" onPress={props.onTest} /> : null}
              {provider.canRefresh ? <StripButton theme={props.theme} label="Refresh models" onPress={props.onRefresh} /> : null}
            </View>
          ) : null}
          {provider.rows.map((row) => (
            <Pressable
              key={
                row.kind === "profile"
                  ? `profile:${row.name}`
                  : row.kind === "oauthLogin"
                    ? `login:${row.method}`
                    : row.kind === "customModel"
                      ? `model:${row.profile}:${row.model.id}`
                      : row.kind === "addCustomModel"
                        ? `add-model:${row.profile}`
                        : row.kind
              }
              accessibilityRole="button"
              onPress={() => props.onOpen(row)}
              style={({ pressed }) => ({
                paddingVertical: 7,
                paddingLeft: 34,
                paddingRight: 14,
                backgroundColor: pressed ? c.surface2 : "transparent",
              })}
            >
              <Text style={{ color: rowTint(row.kind, c), fontSize: 13 }} numberOfLines={1}>
                {row.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

interface SheetProps {
  provider: SettingsProvider;
  theme: Theme;
  onTest(): void;
  save(apiKey: string): Promise<{ ok: boolean; error?: string }>;
  remove(): Promise<{ ok: boolean; error?: string }>;
}

/** The API key sheet: the masked current key, a secure new-key field, Save, Test and Remove. */
function ApiKeySheet(props: SheetProps) {
  const { provider, theme } = props;
  const key = useRef("");
  const input = useRef<SettingsInputHandle>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function save() {
    if (key.current.trim() === "") return setError("Enter the API key");
    setBusy(true);
    const outcome = await props.save(key.current.trim());
    setBusy(false);
    setError(outcome.ok ? null : (outcome.error ?? "Saving failed"));
    if (outcome.ok) {
      key.current = "";
      input.current?.replaceText("");
    }
  }

  async function remove() {
    setBusy(true);
    const outcome = await props.remove();
    setBusy(false);
    setConfirming(false);
    if (!outcome.ok) setError(outcome.error ?? "Removing failed");
  }

  const current = provider.configured
    ? `${provider.maskedKey ?? "configured"}${provider.source === null ? "" : ` · from ${provider.source}`}`
    : "Not set";

  return (
    <View style={{ gap: 12 }}>
      <SettingsCard>
        <SettingsRow label="Current key" hint={current} />
        <SettingsInput
          ref={input}
          label={provider.configured ? "New key" : "API key"}
          hint={KEY_NOTE}
          error={error}
          secureTextEntry
          placeholder="Paste the key"
          onChangeText={(text) => (key.current = text)}
        />
        <SettingsAction label="Store the key in fspec" actionLabel={busy ? "Saving…" : "Save"} disabled={busy} onPress={() => void save()} />
      </SettingsCard>
      {provider.configured ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <StripButton theme={theme} label="Test connection" onPress={props.onTest} />
          {confirming ? (
            <>
              <Text style={{ color: theme.colors.foreground, alignSelf: "center" }}>{removePrompt(provider)}</Text>
              <StripButton theme={theme} label="Remove" onPress={() => void remove()} />
              <StripButton theme={theme} label="Cancel" onPress={() => setConfirming(false)} />
            </>
          ) : (
            <StripButton theme={theme} label="Remove key" onPress={() => setConfirming(true)} />
          )}
        </View>
      ) : null}
    </View>
  );
}
