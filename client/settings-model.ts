import type { OAuthStep, SettingsListOutput, SettingsModel, SettingsProvider, TestProviderOutput } from "../shared/settings.js";

/**
 * The fspec TUI's provider tree (rust/fspec-tui/src/views/provider_settings):
 * nav_item.rs build_nav_items for the row order, projection.rs for the OAuth
 * methods and labels, row_render.rs for the icons. Pure, so it is testable.
 */

export type OAuthMethod = "browser" | "code" | "device";

/** One child row of an expanded provider, in the TUI's order. */
export type TreeRow =
  | { kind: "oauthStatus"; label: string }
  | { kind: "oauthLogin"; method: OAuthMethod; label: string }
  | { kind: "apiKey"; label: string }
  | { kind: "settings"; label: string }
  | { kind: "profile"; name: string; baseUrl: string; label: string }
  | { kind: "customModel"; providerId: string; profile: string; model: SettingsModel; label: string }
  | { kind: "addCustomModel"; providerId: string; profile: string; label: string }
  | { kind: "addProfile"; label: string };

export interface TreeProvider {
  id: string;
  displayName: string;
  /** The header's status segments, e.g. "✓ sk-••••abcd [env] (2 profiles)". */
  status: string;
  configured: boolean;
  canTest: boolean;
  canRefresh: boolean;
  provider: SettingsProvider;
  rows: TreeRow[];
}

/** What a tapped row opens. */
export type Sheet =
  | { kind: "apiKey"; providerId: string }
  | { kind: "settings"; providerId: string }
  | { kind: "profile"; providerId: string; profile: string | null }
  | { kind: "customModel"; providerId: string; profile: string; model: SettingsModel | null }
  | { kind: "oauthLogin"; providerId: string; method: OAuthMethod }
  | { kind: "oauthStatus"; providerId: string };

export type ScreenState =
  | { kind: "loading" }
  | { kind: "unavailable"; reason: string; retry: true }
  | {
      kind: "ready";
      workspace: string;
      tree: TreeProvider[];
      defaultModel: { value: string; options: Array<{ label: string; value: string }> };
    };

export const ENDPOINT_ERROR = "Enter an http:// or https:// URL";

const LOGIN_LABELS: Record<OAuthMethod, string> = {
  browser: "Sign in with browser",
  code: "Sign in with code",
  device: "Sign in with device code",
};

/** projection.rs oauth_login_methods. */
function oauthMethods(providerId: string): OAuthMethod[] {
  switch (providerId) {
    case "anthropic":
      return ["browser", "code"];
    case "codex":
      return ["browser", "device"];
    case "github-copilot":
      return ["device"];
    default:
      return ["browser"];
  }
}

/** projection.rs oauth_label. */
export function oauthLabel(providerId: string): string {
  switch (providerId) {
    case "anthropic":
      return "Claude";
    case "codex":
      return "ChatGPT";
    case "github-copilot":
      return "GitHub Copilot";
    default:
      return "OAuth";
  }
}

function keySegments(row: SettingsProvider): string {
  const key = row.maskedKey ?? "configured";
  return row.source === null ? `✓ ${key}` : `✓ ${key} [${row.source}]`;
}

function headerStatus(row: SettingsProvider, profileCount: number): string {
  let status: string;
  if (row.configured === null) status = "(no credential row in fspec)";
  else if (!row.configured) status = "(not configured)";
  else if (row.credentialType === "oauth") status = `✓ OAuth [${oauthLabel(row.id)}]`;
  else if (row.credentialType === "custom") status = "✓ custom endpoint";
  else status = keySegments(row);
  if (row.listing === "unlisted") status += " · not listed by fspec";
  if (profileCount > 0) status += ` (${profileCount} ${profileCount === 1 ? "profile" : "profiles"})`;
  return status;
}

/** fspec keeps custom models in openai profiles only (profile_sections.rs). */
export const CUSTOM_MODEL_PROVIDER = "openai";

/** One profile of a provider and the profile section list_providers reports for it, if any. */
interface ProfileSection {
  /** The base provider custom-model writes name (ProviderInfo.provider_id). */
  providerId: string;
  models: readonly SettingsModel[];
}

function childRows(
  row: SettingsProvider,
  profiles: ReadonlyArray<{ name: string; baseUrl: string }>,
  sections: ReadonlyMap<string, ProfileSection>,
): TreeRow[] {
  const rows: TreeRow[] = [];
  if (row.credentialType === "oauth") {
    if (row.configured) rows.push({ kind: "oauthStatus", label: `✓ Logged in [${oauthLabel(row.id)}]` });
    for (const method of oauthMethods(row.id)) {
      rows.push({ kind: "oauthLogin", method, label: `🔑 ${LOGIN_LABELS[method]}` });
    }
  }
  // nav_item.rs: no API key row for openai, whose keys live in profiles or the environment.
  if (row.credentialType === "api_key" && row.id !== "openai") {
    rows.push({ kind: "apiKey", label: row.configured ? `🔑 API key ${keySegments(row)}` : "🔑 API key (not set)" });
  }
  rows.push({ kind: "settings", label: "⚙ Settings" });
  for (const profile of profiles) {
    const target = profile.baseUrl === "" ? "(inherits auth)" : profile.baseUrl;
    rows.push({ kind: "profile", name: profile.name, baseUrl: profile.baseUrl, label: `📁 ${profile.name} → ${target}` });
    if (row.providerId !== CUSTOM_MODEL_PROVIDER) continue;
    // FSPEC-047: the profile's custom models, then a row to add one. A profile
    // with no section of its own belongs to this provider row's base provider.
    const section = sections.get(profile.name);
    const providerId = section?.providerId ?? row.providerId;
    for (const model of section?.models ?? []) {
      if (model.isCustom === true) {
        rows.push({ kind: "customModel", providerId, profile: profile.name, model, label: `◆ ${model.displayName}` });
      }
    }
    rows.push({ kind: "addCustomModel", providerId, profile: profile.name, label: `+ Add model to ${profile.name}` });
  }
  rows.push({ kind: "addProfile", label: "+ Add profile" });
  return rows;
}

/**
 * Folds each profile section (a row with a profileName) under the provider
 * row its providerId names (ProviderInfo.provider_id, FSPEC-056), orders
 * configured providers first (otherwise the daemon's order) and builds each
 * provider's header and child rows. A section whose provider has no row of
 * its own stays a provider row.
 */
export function buildTree(rows: readonly SettingsProvider[]): TreeProvider[] {
  const ids = new Set(rows.filter((row) => row.profileName === null).map((row) => row.id));
  /** base provider -> profile name -> its section. */
  const folded = new Map<string, Map<string, ProfileSection>>();
  const providers: SettingsProvider[] = [];
  for (const row of rows) {
    if (row.profileName !== null && ids.has(row.providerId)) {
      const names = folded.get(row.providerId) ?? new Map<string, ProfileSection>();
      names.set(row.profileName, { providerId: row.providerId, models: row.models });
      folded.set(row.providerId, names);
    } else {
      providers.push(row);
    }
  }
  const tree = providers.map((row): TreeProvider => {
    const profiles = [...row.profiles];
    const sections = folded.get(row.id) ?? new Map<string, ProfileSection>();
    // A profile the daemon lists as a provider but not in the settings still shows.
    for (const name of sections.keys()) {
      if (!profiles.some((profile) => profile.name === name)) profiles.push({ name, baseUrl: "" });
    }
    return {
      id: row.id,
      displayName: row.displayName,
      status: headerStatus(row, profiles.length),
      configured: row.configured === true,
      canTest: row.configured === true,
      canRefresh: row.configured === true,
      provider: row,
      rows: childRows(row, profiles, sections),
    };
  });
  // Array#sort is stable, so each group keeps the daemon's order.
  return tree.sort((a, b) => Number(b.configured) - Number(a.configured));
}

export function sheetFor(providerId: string, row: TreeRow): Sheet {
  switch (row.kind) {
    case "oauthStatus":
      return { kind: "oauthStatus", providerId };
    case "oauthLogin":
      return { kind: "oauthLogin", providerId, method: row.method };
    case "apiKey":
      return { kind: "apiKey", providerId };
    case "settings":
      return { kind: "settings", providerId };
    case "profile":
      return { kind: "profile", providerId, profile: row.name };
    case "customModel":
      return { kind: "customModel", providerId: row.providerId, profile: row.profile, model: row.model };
    case "addCustomModel":
      return { kind: "customModel", providerId: row.providerId, profile: row.profile, model: null };
    case "addProfile":
      return { kind: "profile", providerId, profile: null };
  }
}

/** Expands a collapsed provider or collapses an expanded one. */
export function toggleExpanded(expanded: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(expanded);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** The form-side check for an endpoint URL; null when it is acceptable. */
export function validateEndpoint(text: string): string | null {
  try {
    const url = new URL(text.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? null : ENDPOINT_ERROR;
  } catch {
    return ENDPOINT_ERROR;
  }
}

export function removePrompt(row: SettingsProvider): string {
  return `Remove the ${row.displayName} key from fspec?`;
}

/** The test-result decoration on a provider header (row_render.rs RPC-158). */
export function testBadge(output: TestProviderOutput): string {
  if ("state" in output) return `✗ ${output.reason}`;
  if (!output.ok) return `✗ ${output.error}`;
  return output.success ? `✓ ${output.latencyMs} ms` : `✗ ${output.error ?? "connection failed"}`;
}

/**
 * The Default model row (FSPEC-046): every model of a provider fspec lists as reachable (FSPEC-069), as provider/model,
 * selecting fspec's current default, or "Not set" first when fspec has none.
 */
export function defaultModelChoice(list: Extract<SettingsListOutput, { state: "ready" }>): {
  value: string;
  options: Array<{ label: string; value: string }>;
} {
  const options = list.providers
    .filter((provider) => provider.listing === "reachable")
    .flatMap((provider) =>
      provider.models.map((model) => {
        const id = `${provider.id}/${model.id}`;
        return { label: `${model.displayName} · ${id}`, value: id };
      }),
    );
  const current = list.defaultModel;
  if (current === null) return { value: "", options: [{ label: "Not set", value: "" }, ...options] };
  // A default fspec no longer lists still shows as the current value.
  const known = options.some((option) => option.value === current);
  return { value: current, options: known ? options : [{ label: current, value: current }, ...options] };
}

export function screenState(list: SettingsListOutput | null): ScreenState {
  if (list === null) return { kind: "loading" };
  if (list.state === "unavailable") return { kind: "unavailable", reason: list.reason, retry: true };
  return { kind: "ready", workspace: list.workspace, tree: buildTree(list.providers), defaultModel: defaultModelChoice(list) };
}

/** What a sign-in sheet says for its step (FSPEC-044). */
export function oauthIntro(step: OAuthStep): string {
  switch (step.kind) {
    case "browser":
      return "A browser opens on the computer running fspec. Finish signing in there.";
    case "code":
      return "Open the sign-in page, sign in, then paste the code it shows.";
    case "device":
      return `Open ${step.verificationUrl} and enter the code ${step.userCode}.`;
  }
}

export function logoutPrompt(providerId: string): string {
  return `Log out of ${oauthLabel(providerId)} in fspec?`;
}
