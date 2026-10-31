# Paseo Provider Plugin — Implementation Contract

Verified 2026-10-29 against the `paseo` repository at v0.14.0-beta.2.

| Concern | File |
| --- | --- |
| Provider protocol types + Zod schemas | `packages/plugin/src/server/provider.ts` (published as `@getpaseo/plugin/server/provider`) |
| ACP shim | `packages/plugin/src/server/acp.ts` (`@getpaseo/plugin/server/acp`) |
| Process helpers | `packages/plugin/src/server/process.ts` (`@getpaseo/plugin/server`) |
| Server entry context | `packages/plugin/src/server/contracts.ts` |
| Plugin manifest schema | `packages/server/src/server/plugins/manifest.ts` |
| Host-side bridge (behaviour you can rely on) | `packages/server/src/server/agent/plugin-provider.ts`, `plugin-session-history.ts`, `timeline-projection.ts` |
| Docs | `public-docs/plugins/providers.md`, `public-docs/plugins/reference.md`, `public-docs/plugins/publishing.md`, `docs/plugins.md`, `docs/providers.md`, `public-docs/sdk/providers.md`, `public-docs/sdk/provider-options.md` |
| Examples | `plugin-examples/provider-direct/`, `plugin-examples/provider-acp-transformer/` |
| Real plugins | `plugins/muse-provider/`, `plugins/hoplite-provider/`, `plugins/antigravity-provider/` |

There is **no `definePlugin` / `defineProvider` helper**. A provider plugin is: a `paseo-plugin.json`
manifest + an `index.server.ts` default-exported contribution function that calls
`server.registerProvider(registration)`, where `registration` is a plain object satisfying
`ProviderRegistration`.

---

## 1. Packaging

### 1.1 The manifest is the plugin declaration — `paseo-plugin.json`

The manifest file name is fixed (`packages/server/src/server/plugins/manifest.ts`):

```ts
const MANIFEST_FILENAME = "paseo-plugin.json";
const PluginManifestSchema = z.object({
  id: PluginIdSchema,
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  icon: PluginAssetPathSchema.refine(
    (value) => /\.png$/i.test(value),
    "Expected a relative path to a PNG",
  ).optional(),
  media: z.array(z.union([PluginAssetPathSchema, z.url({ protocol: /^https$/ })])).optional(),
  // A misspelled requirement must not silently disable compatibility checks.
  requirements: PluginRequirementsSchema.strict().optional(),
  build: z.array(PluginBuildCommandSchema).min(1).optional(),
});
```

`PluginIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/)` (`packages/protocol/src/plugin-config.ts`).
`requirements` is `.strict()` — an unknown key is a hard error. An omitted `requirements.paseo`
means `<0.8.0` and is rejected by current Paseo.

Verbatim manifests from the repo:

```json
{ "id": "muse-provider", "requirements": { "paseo": ">=0.11.0" } }
```

```json
{ "id": "hoplite-provider", "requirements": { "paseo": ">=0.11.0" } }
```

```json
{
  "id": "provider-direct-example",
  "requirements": {
    "paseo": ">=0.8.0"
  }
}
```

**The manifest does not declare "this is a provider plugin."** Nothing in `paseo-plugin.json` names
providers. A plugin *is* a provider plugin because `index.server.ts` calls
`server.registerProvider()`. The manifest `icon` field is a **PNG for the plugin listing**; the
**provider icon is a separate SVG** declared on the registration (§2.2).

### 1.2 `package.json`

There is **no `main`/`exports`/`module` field for a plugin** — the daemon compiles the entry files
itself (`index.server.ts` / `index.client.tsx`), so `package.json` is only a dev typecheck/test
harness. ESM source is required.

Verbatim, the single workspace manifest that every `plugins/<id>/` is typechecked and tested through
(`plugins/package.json`):

```json
{
  "name": "@getpaseo/builtin-plugins",
  "version": "0.14.0-beta.2",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsgo -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@getpaseo/plugin": "*",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^20.9.0",
    "vitest": "^4.1.6"
  }
}
```

Individual built-ins (`plugins/muse-provider`, `plugins/hoplite-provider`,
`plugins/antigravity-provider`) have **no `package.json` at all** — they are covered by that one
workspace manifest.

For a **standalone** plugin, the canonical shape is what `paseo plugin init` writes
(`packages/cli/src/commands/plugin/scaffold.ts`), verbatim:

```json
{
  "name": "<plugin-id>",
  "private": true,
  "version": "0.0.0",
  "files": [
    "paseo-plugin.json",
    "OVERVIEW.md",
    "OVERVIEW.*.md",
    "index.client.ts",
    "index.client.tsx",
    "index.server.ts",
    "index.server.tsx",
    "client/",
    "server/",
    "shared/"
  ],
  "scripts": { "typecheck": "tsc --noEmit" },
  "devDependencies": {
    "@getpaseo/plugin": "<current CLI version>",
    "@tanstack/react-query": "^5.90.11",
    "@types/react": "~19.2.0",
    "react": "19.1.0",
    "react-native": "0.81.5",
    "typescript": "^5.9.3",
    "zod": "^4.4.3"
  }
}
```

Rules that follow from `public-docs/plugins/publishing.md`:

- `@getpaseo/plugin` and other host modules are **`devDependencies`** — Paseo supplies the runtime
  instances. Only genuinely third-party runtime libraries go in `dependencies` (then you need a
  lockfile / `npm-shrinkwrap.json`).
- `files` must include `paseo-plugin.json`, every runtime entry, and every imported local directory
  (`server/`, `shared/`, plus `icon.svg` / `assets/` if used). Files outside the package do not
  reach users.
- To publish: `npm pkg set name=@acme/paseo-<x> version=1.0.0`, `npm pkg delete private`, set
  `repository` (required for registry listing ownership), `npm publish --access public`, then
  `paseo plugin install npm:@acme/paseo-<x>@1.0.0`.
- Git distribution needs no npm: `paseo plugin add git:owner/repo[:sub/dir]`. Use manifest
  `build: [["npm","ci","--omit=dev","--ignore-scripts"]]` only when runtime deps must be installed.
- Local dev: `paseo plugin install /abs/path/to/plugin` (directory source), then
  `paseo plugin reload <id>` after edits.

### 1.3 Where plugins live

Both are supported and share the same contract:

- **In-repo built-in** (`plugins/<id>/`): no `package.json`, no `node_modules`; loaded in process and
  always active regardless of `pluginsEnabled`. You must add the ID to `builtinPlugins` in
  `packages/server/src/server/plugins/builtin/index.ts` — "Unlisted directories do not load."
  Built-ins "can import only host modules (`@getpaseo/plugin/*`, `zod`) and Node built-ins."
- **Standalone repo / npm package / directory or Git source**: the normal path for a new provider.
  Runs in a daemon subprocess; `pluginsEnabled` must be `true`.

### 1.4 tsconfig / build

Built-in workspace (`plugins/tsconfig.json`, verbatim):

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "lib": ["ES2023", "DOM"],
    "types": ["node", "vitest/globals"],
    "incremental": false,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", "**/*.test.ts"]
}
```

Standalone plugin scaffold tsconfig (from `scaffold.ts`, verbatim):

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "types": ["react"],
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
```

**No build step.** "Paseo compiles TypeScript, so an ordinary plugin needs no separate publication
build." `noEmit: true` everywhere; `npm run typecheck` is the only build-adjacent command.

Gotcha: built-in plugins use `NodeNext` resolution, so their sources use **`.js` import
specifiers** (`import { createHopliteProvider } from "./server/provider.js";`). Standalone plugins
with `moduleResolution: "Bundler"` may omit extensions (`plugin-examples/provider-direct` does:
`from "./server/provider"`). Match the surrounding tree.

---

## 2. Registration API

### 2.1 Server entry

```ts
// index.server.ts
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createProvider } from "./server/provider";

export default function contribute(server: PluginServerContext) {
  server.registerProvider(createProvider());
  return () => {};
}
```

The contribution signature is fixed (`packages/plugin/src/server/contracts.ts`):

```ts
export type PluginServerContribution = (server: PluginServerContext) => PluginCleanup;

export interface PluginServerContext extends PluginLifecycleRegistration {
  registerSettings<Schema extends ZodType>(
    definition: import("../settings.js").SettingsDefinition<Schema>,
  ): PluginSettings<Schema>;
  handle<InputSchema extends ZodType, OutputSchema extends ZodType>(
    contract: PluginRpcContract<InputSchema, OutputSchema>,
    handler: (
      input: ZodOutput<InputSchema>,
      context: PluginHandlerContext,
    ) => ZodInput<OutputSchema> | Promise<ZodInput<OutputSchema>>,
  ): void;
  registerProvider(provider: ProviderRegistration): void;
  registerUsageSource(source: UsageSourceRegistration): void;
}
```

You **must return a cleanup function** (may be async; Paseo awaits it when stopping the plugin).
Real plugins narrow the context to only what they use (`plugins/muse-provider/index.server.ts`):

```ts
export default function contribute(
  server: Pick<PluginServerContext, "registerProvider" | "registerUsageSource">,
) {
  const usage = new Usage();
  server.registerUsageSource(usage.registration());
  server.registerProvider(createMuseProvider(usage));
  return () => {};
}
```

### 2.2 The provider descriptor — verbatim

```ts
export interface ProviderRegistration {
  /** Activate only while agents.providers contains this provider ID, independently of enabled. */
  requiresConfiguration?: boolean;
  /** Equal keys share discovery within this provider. Include effective configuration and execution environment. */
  getCatalogCacheKey?(options: ProviderCatalogOptions): Promise<string | undefined>;
  /** Default executable and arguments; the daemon resolves overrides before status/connect. */
  command?: readonly [string, ...string[]];
  status?(request: ProviderStatusRequest): Promise<ProviderStatus>;
  id: string;
  label: string;
  description?: string;
  /** Plugin-directory-relative path to a self-contained SVG file. */
  icon?: string;
  connect(request: ProviderConnectRequest): Promise<ProviderConnection>;
}
```

```ts
export const PROVIDER_PROTOCOL_VERSION = 1 as const;

export interface ProviderConnectRequest {
  launch?: ProviderLaunch;
  versions: readonly number[];
  capabilities: readonly string[];
}
```

Field notes:

- `id` — the **provider ID** users type in `config: { provider: "<id>/<model>" }`. It is *not* the
  plugin ID (`muse-provider` registers provider `muse`). Configurable provider IDs must match
  `/^[a-z][a-z0-9-]*$/`; dots and underscores are legal for registration but unusable under
  `agents.providers.<id>`.
- `label` — required display name. `description` — optional, shown in provider pickers.
- `icon` — a **file path relative to the plugin directory**, e.g. `"icon.svg"`. Never inline SVG,
  never a URL. The daemon reads and validates the file at plugin start against the shared SVG rules
  (`findSvgIconProblem`, `packages/plugin/src/icons.ts`): one `<svg>` ≤64 KiB, no
  `<script>`/`<style>`/`<foreignObject>`, no event-handler attributes, no `javascript:` URLs,
  `href`/`xlink:href` only same-document fragments. The repo's own icon test additionally asserts
  `viewBox="0 0 24 24"`, `fill="currentColor"`, and no literal colors
  (`plugins/antigravity-provider/server/provider.test.ts`):

```ts
it("publishes a monochrome, theme-aware provider icon", async () => {
  const icon = await readFile(new URL("../icon.svg", import.meta.url), "utf8");
  expect(icon).toContain('viewBox="0 0 24 24"');
  expect(icon).toContain('fill="currentColor"');
  expect(icon).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(|url\(/i);
  expect(icon).not.toMatch(/<(?:style|mask|defs|linearGradient|radialGradient)\b|\bid=/i);
  expect([...icon.matchAll(/\b(?:fill|stroke)="([^"]+)"/g)].map((match) => match[1])).toEqual([
    "currentColor",
  ]);
});
```

- `command` — declare it whenever the provider launches an executable. The daemon applies
  `agents.providers.<id>.command` and `env`, resolves the binary against the effective PATH, strips
  parent-session and daemon-control environment variables, and hands you the result as `launch`.
- `requiresConfiguration: true` — the provider participates only while its ID exists under
  `agents.providers` (Hoplite uses this for catalog opt-in).
- `getCatalogCacheKey` — optional, §3.3.

### 2.3 Capability negotiation

```ts
export const PROVIDER_CAPABILITIES = [
  "prompt.message",
  "prompt.command",
  "prompt.image",
  "prompt.output_schema",
  "prompt.steer",
  "session.can_stop_runtime",
  "session.archive",
  "session.configure",
  "session.list",
  "session.persistence",
  "session.revert.both",
  "session.revert.conversation",
  "session.revert.files",
  "session.subsession",
  "session.unarchive",
  "permission",
  "permission.tool_policy",
  "timeline.plugin",
] as const;

export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

export function negotiateProviderCapabilities(
  offered: readonly string[],
  supported: readonly string[],
): readonly ProviderCapability[];

export function isProviderCapability(capability: string): capability is ProviderCapability;
export function requiredProviderCapabilities(input: ProviderInput): readonly ProviderCapability[];
export function requireProviderCapabilities(
  capabilities: readonly string[],
  input: ProviderInput,
): void;
```

Every real plugin keeps a local `const capabilities = [...] as const` listing what it implements,
intersects it with `request.capabilities` in `connect()`, publishes the result on
`ProviderConnection.capabilities` **and** on each `session.opened.capabilities`, and calls
`requireProviderCapabilities(negotiated, input)` at the top of `send()`
(`plugins/muse-provider/server/provider.ts`):

```ts
async connect(request) {
  if (!request.versions.includes(1))
    throw new MuseError("protocol", "Provider protocol version 1 is required");
  usage.remember(requireLaunch(request.launch));
  return connect(
    requireLaunch(request.launch),
    negotiateProviderCapabilities(request.capabilities, capabilities),
    usage,
  );
}
```

Advertise only what you implement. If steering is unsupported, omit `prompt.steer` — Paseo replaces
the active turn instead.

### 2.4 ACP shortcut

If the agent already speaks ACP over stdio, do not reimplement the machinery:

```ts
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { runAcpProvider } from "@getpaseo/plugin/server/acp";

export default function contribute(server: PluginServerContext) {
  server.registerProvider(
    runAcpProvider({
      id: "vendor-agent",
      label: "Vendor agent",
      icon: "icon.svg",
      command: ["vendor-agent", "acp"],
    }),
  );
  return () => {};
}
```

Verbatim shim signature and transformer hooks (`packages/plugin/src/server/acp.ts`):

```ts
interface RunAcpProviderBaseOptions {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  acpOptions?: AcpOptions;
  transformers?: readonly AcpTransformer[];
}

export type RunAcpProviderOptions = RunAcpProviderBaseOptions &
  (
    | { command: readonly [string, ...string[]]; connector?: never }
    | { connector: AcpConnector; command?: never }
  );

export interface AcpOptions {
  protocol?: "auto" | "v1";
  startupTimeoutMs?: number;
  /** Global discovery initializes ACP but returns an empty catalog without opening a session. */
  workspaceOnlyCatalog?: boolean;
  waitForInitialCommands?: boolean;
  initialCommandsTimeoutMs?: number;
}

export type AcpConfigChange =
  | { target: "model"; value: string | null }
  | { target: "mode"; value: string | null }
  | { target: "thinking"; value: string | null }
  | { target: "setting"; id: string; value: JsonValue };

export type AcpVendorUpdate =
  | { type: "commands"; commands: readonly ProviderCommand[] }
  | { type: "config"; config: ProviderConfigState }
  | { type: "timeline"; item: ProviderTimelineItem }
  | { type: "notice"; notice: ProviderNotice };

export interface AcpTransformer {
  discover?(
    catalog: ProviderCatalog,
    context: AcpDiscoveryContext,
  ): Promise<ProviderCatalog> | ProviderCatalog;
  configure?(change: AcpConfigChange, context: AcpConfigureContext): Promise<"handled" | "pass">;
  notification?(
    notification: { method: string; params: JsonValue },
    context: AcpContext,
  ): AcpVendorUpdate | readonly AcpVendorUpdate[] | null;
  toolCall?(toolCall: AcpToolCallSnapshot, context: AcpContext): AcpToolCallSnapshot;
}

export function runAcpProvider(options: RunAcpProviderOptions): ProviderRegistration;
```

Hoplite is the real example (`plugins/hoplite-provider/server/provider.ts`, verbatim):

```ts
import { runAcpProvider } from "@getpaseo/plugin/server/acp";
import type { ProviderRegistration } from "@getpaseo/plugin/server/provider";
import { runPhaseTransformer } from "./run-phase.js";

export function createHopliteProvider(): ProviderRegistration {
  return {
    requiresConfiguration: true,
    ...runAcpProvider({
      id: "hoplite",
      label: "Hoplite",
      description: "Hoplite's coding agent through the local `hoplite acp` bridge",
      icon: "icon.svg",
      command: ["hoplite", "acp"],
      acpOptions: { workspaceOnlyCatalog: true },
      transformers: [runPhaseTransformer],
    }),
  };
}
```

Use transformers only for vendor differences ACP cannot describe; validate vendor payloads with Zod
and return the input unchanged (or `null`) for anything malformed or unrelated.

### 2.5 Launch and availability

```ts
export type ProviderCatalogOptions =
  | { scope: "global"; force?: boolean; launch?: ProviderLaunch }
  | { scope: "workspace"; cwd: string; force?: boolean; launch?: ProviderLaunch };

export const ProviderLaunchSchema = z
  .object({
    /** Resolved executable path. */
    command: z.string().min(1),
    args: z.array(z.string()),
    /** Complete daemon-owned environment, including overrides and parent-session stripping. */
    env: z.record(z.string(), z.string()),
  })
  .strip();

export type ProviderLaunch = z.infer<typeof ProviderLaunchSchema>;

export interface ProviderStatusRequest {
  launch?: ProviderLaunch;
}

export const ProviderStatusSchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(true), diagnostic: z.string().optional() }).strip(),
  z.object({ available: z.literal(false), diagnostic: z.string().min(1) }).strip(),
]);

export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;
```

- Declare `command` → the daemon checks executable availability **before** calling `status()`, and
  passes the resolved `launch` to `status()` and `connect()`. Pass `launch.env` explicitly to your
  process helpers; they do not apply daemon environment policy. Never merge the plugin process's own
  environment back in.
- A command-backed provider without `status()` is available when its executable resolves. Providers
  with neither `command` nor `status` keep connection-based availability.
- `status()` must return a **user-actionable** diagnostic (e.g. `"Run \`muse login\` or set META_API_KEY"`).
  `plugins/muse-provider/server/provider.ts` probes `--version`, enforces a version floor, performs
  one authenticated round-trip, and always closes the probe host in `finally`.

Process helpers — required instead of raw `node:child_process` (oxlint enforces this for
`plugins/*-provider/server/**/*.ts`):

```ts
// packages/plugin/src/server/index.ts
export { spawnProcess, execCommand, terminateProcess } from "./process.js";
```

```ts
import { spawnProcess, execCommand } from "@getpaseo/plugin/server";

const child = spawnProcess(launch.command, [...launch.args, "serve"], {
  env: launch.env,
  cwd,
  stdio: "pipe",
});
const { stdout } = await execCommand(launch.command, [...launch.args, "--version"], {
  env: launch.env,
  timeout: 5000,
});
```

End stdin for graceful shutdown; use `terminateProcess(child)` for a forced stop (it kills the
process tree on Windows, including the CLI behind a `.cmd` launcher). Bound your final wait for
closed streams.

---

## 3. The provider interface

A provider is **one connection object with three methods**; everything else is data.

```ts
export interface ProviderConnection {
  readonly version: number;
  readonly capabilities: readonly string[];
  send(input: ProviderInput): Promise<void>;
  onEvent(listener: (event: ProviderEvent) => void): () => void;
  close(): Promise<void>;
}
```

`version` is `1` (`PROVIDER_PROTOCOL_VERSION = 1`). Reject other versions in `connect()`:
`if (!request.versions.includes(1)) throw …`.

- `send(input)` **resolves after acceptance only**. Results are events, never return values. Real
  plugins validate admission synchronously (unknown session, duplicate session, missing capability →
  `throw`), then dispatch asynchronously:

```ts
async send(input) {
  if (closed) throw new MuseError("closed", "Muse connection is closed");
  requireProviderCapabilities(negotiated, input);
  queueMicrotask(() => {
    if (!closed) void dispatch(input).catch((error: unknown) => failed(input, error));
  });
}
```

- `onEvent(listener)` returns an unsubscribe function. Guard emission after teardown:
  `function emit(event) { if (closed) return; for (const listener of listeners) listener(event); }`.
- `close()` stops every session and releases processes, subscriptions, and pending work. Must be
  idempotent (`if (closed) return;`).

### 3.1 Inputs — verbatim

```ts
export type ProviderInput =
  | { type: "catalog"; requestId: string; cwd?: string }
  | { type: "sessions"; requestId: string; query?: string; cwd?: string; limit?: number }
  | {
      type: "session.open";
      requestId: string;
      sessionId: string;
      config: ProviderSessionConfig;
      persistence?: ProviderPersistence;
      history: "replay" | "skip";
    }
  | { type: "session.prompt"; sessionId: string; prompt: ProviderPrompt }
  | { type: "session.interrupt"; requestId: string; sessionId: string }
  | {
      type: "session.permission";
      sessionId: string;
      permissionId: string;
      response: ProviderPermissionResponse;
    }
  | {
      type: "session.configure";
      requestId: string;
      sessionId: string;
      changes: ProviderConfigChanges;
    }
  | {
      type: "session.revert";
      requestId: string;
      sessionId: string;
      token: JsonValue;
      scope: "conversation" | "files" | "both";
    }
  | { type: "session.archive"; requestId: string; persistence: ProviderPersistence }
  | { type: "session.unarchive"; requestId: string; persistence: ProviderPersistence }
  | { type: "session.can_stop_runtime"; requestId: string; sessionId: string }
  | { type: "session.close"; requestId: string; sessionId: string };
```

`session.prompt` and `session.permission` carry **no `requestId`** — their outcome is an event
(`session.prompt_result`, `session.permission_resolved`). Every other input has a `requestId` you
must answer exactly once with `request.completed`, `request.failed`, or the typed reply event
(`catalog`, `sessions`, `session.can_stop_runtime`). `session.open` is answered by `session.opened`
+ `session.ready` (or `request.failed`). `session.can_stop_runtime` must **never** be answered with
`request.completed`.

The host validates every event against `ProviderEventSchema` and every input against
`ProviderInputSchema`; an event that fails parsing is a hard failure, not a warning.

### 3.2 Availability / status

Optional `status(request)` on the registration (§2.5). There is no availability method on the
connection.

### 3.3 Model catalog (`type: "catalog"`)

Paseo requests the catalog **before** creating a session. Reply with one `catalog` event carrying
`requestId`.

```ts
export interface ProviderThinkingOption {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  metadata?: Readonly<Record<string, JsonValue>>;
}

export interface ProviderModel {
  id: string;
  aliases?: string[];
  isSelectable?: boolean;
  label: string;
  description?: string;
  isDefault?: boolean;
  metadata?: Readonly<Record<string, JsonValue>>;
  contextWindowMaxTokens?: number;
  thinkingOptions?: ProviderThinkingOption[];
  defaultThinkingOptionId?: string;
}

export interface ProviderMode {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  colorTier?: string;
  isUnattended?: boolean;
}

export interface ProviderCatalog {
  models: readonly ProviderModel[];
  modes: readonly ProviderMode[];
  thinkingOptions?: readonly ProviderThinkingOption[];
  defaultModel?: string;
  defaultMode?: string;
  defaultThinkingOption?: string;
}
```

```ts
if (input.type === "catalog") {
  emit({
    type: "catalog",
    requestId: input.requestId,
    catalog: {
      models: [
        { id: "agent-large", label: "Agent Large" },
        { id: "agent-small", label: "Agent Small" },
      ],
      modes: [
        { id: "build", label: "Build" },
        { id: "plan", label: "Plan" },
      ],
      thinkingOptions: [
        { id: "standard", label: "Standard" },
        { id: "extended", label: "Extended" },
      ],
      defaultModel: "agent-large",
      defaultMode: "build",
      defaultThinkingOption: "standard",
    },
  });
}
```

- Return `[]` for a category the agent does not expose. Thinking levels may be global
  (`thinkingOptions` + `defaultThinkingOption`) or **per model** (`ProviderModel.thinkingOptions` +
  `defaultThinkingOptionId`) — Muse does the latter:
  `{ id: "meta/muse-spark-1.3", defaultThinkingOptionId: "high", thinkingOptions: [{id:"minimal"},…] }`.
- `ProviderMode.isUnattended: true` marks a mode that never prompts (used for unattended/Hub
  execution). `colorTier`/`icon` are UI hints.
- The catalog describes choices available **before** a session exists; session-specific controls come
  later through `session.config` (§6).
- Cache discovery and honour the host's refresh deadline: "Providers that make multiple catalog
  requests must not apply this deadline separately to each request." Name active operations and
  finish subprocess cleanup before rejecting.

Optional cache-key hook (the daemon calls it before discovery):

```ts
async getCatalogCacheKey({ launch }) {
  if (!launch) return undefined;
  const env = Object.entries(launch.env).sort(([left], [right]) => left.localeCompare(right));
  return createHash("sha256")
    .update(JSON.stringify([launch.command, launch.args, env]))
    .digest("hex");
}
```

Equal keys must mean identical availability, models and modes, including effective configuration and
execution environment. `force` does not change identity. Omitting the method keeps per-target
(`global` vs `workspace/cwd`) caching. Never put secrets in the key itself — hash them.

### 3.4 Session listing (`type: "sessions"`, capability `session.list`)

```ts
export interface ProviderSessionSummary {
  persistence: ProviderPersistence;
  cwd: string;
  title?: string;
  description?: string;
  updatedAt?: string;
}
```

Reply `{ type: "sessions", requestId, sessions }`. Rows only — the import flow then calls
`session.open` with that `persistence`; never re-list during import.

### 3.5 Session open (`type: "session.open"`)

```ts
export interface ProviderSessionConfig {
  cwd: string;
  env: Readonly<Record<string, string>>;
  systemPrompt?: string;
  mcpServers: Readonly<Record<string, ProviderMcpServerConfig>>;
  toolPolicy?: ProviderToolPolicy;
  model?: string;
  mode?: string;
  thinkingOption?: string;
  settings: Readonly<Record<string, JsonValue>>;
  providerOptions?: Readonly<Record<string, unknown>>;
  title?: string;
  persist: boolean;
}

export type ProviderMcpServerConfig =
  | {
      type: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      alwaysLoad?: boolean;
    }
  | {
      type: "http" | "sse";
      url: string;
      headers?: Record<string, string>;
      alwaysLoad?: boolean;
    };

export interface ProviderToolPolicy {
  preapproved: Array<{ kind: "mcp"; server: string; tool: string }>;
}

export interface ProviderPersistence {
  version: number;
  data: JsonValue;
}
```

Required event sequence for a successful open (Muse/`provider-direct` both do this):

```ts
emit({
  type: "session.opened",
  requestId: input.requestId,
  sessionId: input.sessionId,
  capabilities: negotiated,          // the session's own capability list
  restoration: "core",               // or "parent" for a provider-owned child
  persistence,                       // opaque; omit when config.persist is false
  title: input.config.title,
  cwd: input.config.cwd,
});
emit({ type: "session.config", sessionId: input.sessionId, config: committedState });
emit({ type: "session.commands", sessionId: input.sessionId, commands });   // optional
// history replay items here when input.history === "replay"
emit({ type: "session.ready", requestId: input.requestId, sessionId: input.sessionId });
```

- `persistence` present on the input ⇒ resume the identified native session; absent ⇒ create a new
  one (and mint your own handle). `ProviderPersistence` is opaque to Paseo; version it yourself.
- `history: "replay"` ⇒ publish existing `timeline.item` snapshots **before** `session.ready`;
  `history: "skip"` ⇒ open without replaying.
- Paseo refreshes an agent by **closing the provider session and opening it again** with current
  config + persistence. Re-read credentials, env, global config and MCP servers during
  `session.open`; there is no separate reload input.
- `session.config` must carry the **committed** values the native agent selected after normalization,
  not a copy of the request.
- A provider-owned child session is another `session.opened` with `parentSessionId` (and optionally
  `toolCallId`) and `restoration: "parent"`; recreate it while restoring the parent.
- `toolPolicy` requires capability `permission.tool_policy`; a provider that cannot pre-approve one
  exact injected MCP server + tool identity must fail closed for unattended execution.

### 3.6 Prompt / send (`type: "session.prompt"`)

All user input arrives through this one input — messages, slash commands, and steering.

```ts
export interface ProviderPrompt {
  clientMessageId: string;
  delivery: "auto" | "steer";
  input:
    | { type: "message"; content: ProviderContent[] }
    | { type: "command"; name: string; arguments: string };
  outputSchema?: JsonValue;
  clearPendingPermissions?: boolean;
}

export type ProviderContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | ProviderForgeChangeRequestAttachment   // type: "forge_change_request"
  | ProviderForgeIssueAttachment           // type: "forge_issue"
  | ProviderGitHubPrAttachment             // type: "github_pr"
  | ProviderGitHubIssueAttachment          // type: "github_issue"
  | ProviderTextAttachment                 // type: "text", mimeType: "text/plain"
  | ProviderReviewAttachment               // type: "review", mimeType: "application/paseo-review"
  | {
      type: "uploaded_file";
      id: string;
      fileName: string;
      mimeType: string;
      size: number;
      path: string;
    };
```

Required response — exactly one `session.prompt_result` per `clientMessageId`:

```ts
export type ProviderEvent =
  // …
  | {
      type: "session.prompt_result";
      sessionId: string;
      clientMessageId: string;
      result:
        | { type: "turn"; turnId: string }
        | { type: "steer"; turnId: string }
        | { type: "completed" }
        | { type: "failed"; error: ProviderError };
    }
```

- `{ type: "turn", turnId }` — you started (or will start) a turn; you now owe `session.turn`
  `started` then a terminal for that `turnId`.
- `{ type: "steer", turnId }` — the input joined the active turn (capability `prompt.steer`).
- `{ type: "completed" }` — the input was handled as a side effect with **no turn** (e.g. a command
  like `/compact`). Do not emit `session.turn` for it.
- `{ type: "failed", error }` — the input was rejected; no turn is started.

`delivery: "auto"` lets you start a turn or complete without one; `delivery: "steer"` must join the
active turn or fail. `outputSchema` requires capability `prompt.output_schema`.
`clearPendingPermissions` makes permission release part of the delivery contract: queue the steer
first, deny permissions blocking its delivery, and stop once the steer is read.

Minimal correct prompt handler (`plugin-examples/provider-direct/server/provider.ts`):

```ts
session.turn += 1;
const turnId = `turn-${session.turn}`;
session.activeTurnId = turnId;
const text = input.prompt.input.content
  .filter((part) => part.type === "text")
  .map((part) => part.text)
  .join("\n");
state.emit({
  type: "timeline.item",
  sessionId: input.sessionId,
  item: {
    type: "user_message",
    id: `user-${session.turn}`,
    text,
    clientMessageId: input.prompt.clientMessageId,
  },
});
state.emit({
  type: "session.prompt_result",
  sessionId: input.sessionId,
  clientMessageId: input.prompt.clientMessageId,
  result: { type: "turn", turnId },
});
state.emit({ type: "session.turn", sessionId: input.sessionId, turnId, state: "started" });
state.emit({
  type: "timeline.item",
  sessionId: input.sessionId,
  item: { type: "assistant_message", id: `assistant-${session.turn}`, text: `Echo: ${text}` },
});
state.emit({ type: "session.turn", sessionId: input.sessionId, turnId, state: "completed" });
session.activeTurnId = null;
```

Publish the `user_message` echo with the **same `clientMessageId`** so Paseo replaces its optimistic
message instead of duplicating it.

Publish `session.commands` to add structured commands to the composer:

```ts
export interface ProviderCommand {
  name: string;
  description: string;
  argumentHint?: string;
}
```

```ts
emit({
  type: "session.commands",
  sessionId: input.sessionId,
  commands: [{ name: "reset", description: "Reset the example provider state" }],
});
```

### 3.7 Interrupt / stop (`type: "session.interrupt"`)

No capability gate. Answer with `request.completed` once the stop is accepted; the turn's terminal
`canceled` event is the authoritative settlement.

```ts
case "session.interrupt":
  state.emit({ type: "request.completed", requestId: input.requestId });
  return;
```

Muse waits for the native cancelled terminal before resolving, with its own deadline
(`server/session.ts`): it issues `turn/interrupt` and awaits the matching `turn/completed`, and on
timeout emits `session.runtime_failed` and closes the host — "Reopen the session before sending
another prompt." If your provider's cancel is session-scoped, scope the settlement the same way and
gate new runs on it (fail closed). A rejected `interrupt()` is turned into a refused cancel by
`AgentManager`.

### 3.8 Close / release (`type: "session.close"`)

```ts
case "session.close":
  await session.close();
  sessions.delete(input.sessionId);
  usage.detach(input.sessionId);
  emit({ type: "session.closed", sessionId: input.sessionId });
  break;
// then, because the input has a requestId:
if ("requestId" in input) emit({ type: "request.completed", requestId: input.requestId });
```

`session.closed` with an `error` is translated as a failure; without one it is a clean teardown.
`connection.close()` must tear down every session and process.

### 3.9 Permissions (`type: "session.permission"`, capability `permission`)

```ts
export interface ProviderPermissionRequest {
  id: string;
  name: string;
  kind: "tool" | "plan" | "question" | "mode" | "other";
  title?: string;
  description?: string;
  input?: Readonly<Record<string, JsonValue>>;
  detail?: ProviderToolCallDetail;
  suggestions?: Array<Record<string, JsonValue>>;
  actions?: ProviderPermissionAction[];
  metadata?: Readonly<Record<string, JsonValue>>;
}

export interface ProviderPermissionAction {
  id: string;
  label: string;
  behavior: "allow" | "deny";
  variant?: "primary" | "secondary" | "danger";
  intent?: "implement" | "implement_resume" | "dismiss";
}

export type ProviderPermissionResponse =
  | {
      behavior: "allow";
      selectedActionId?: string;
      updatedInput?: Record<string, JsonValue>;
      updatedPermissions?: Array<Record<string, JsonValue>>;
    }
  | {
      behavior: "deny";
      selectedActionId?: string;
      message?: string;
      interrupt?: boolean;
    };
```

Emit `{ type: "session.permission", sessionId, request }` when the native agent asks, and
`{ type: "session.permission_resolved", sessionId, permissionId }` when it settles by any route
(user answer, timeout, native resolution). `permissionId` is your own stable id; the response's
`selectedActionId` must match one of the published `actions[].id`.

### 3.10 Idle-runtime veto (`type: "session.can_stop_runtime"`)

Opt in by advertising `session.can_stop_runtime` on the connection **and** on the session's
`session.opened.capabilities`. Answer only with:

```ts
emit({
  type: "session.can_stop_runtime",
  requestId: input.requestId,
  sessionId: input.sessionId,
  canStop: await session.canStopRuntime(),
});
```

Return `true` only when releasing the runtime loses no background shells, monitors, native children,
queued reports, or pending autonomous replies. The query must not mutate the session. A rejected
query, invalid response, or timeout keeps the runtime alive. Never answer with `request.completed`.

### 3.11 Configure (`type: "session.configure"`, capability `session.configure`)

```ts
export interface ProviderConfigChanges {
  model?: string | null;
  mode?: string | null;
  thinkingOption?: string | null;
  settings?: Readonly<Record<string, JsonValue>>;
}
```

Apply the change, publish the committed `session.config`, **then** `request.completed`. `null` means
"clear the selection". A provider may stage a change until the next turn — say so with a
`session.notice`.

### 3.12 Errors

```ts
export interface ProviderError {
  message: string;
  code?: string;
  diagnostic?: string;
}
```

Map a failed input to the right channel (`plugins/muse-provider/server/provider.ts`):

```ts
function failed(input: ProviderInput, failure: unknown): void {
  const error = actionableError(failure, launch);
  if (input.type === "session.prompt")
    emit({
      type: "session.prompt_result",
      sessionId: input.sessionId,
      clientMessageId: input.prompt.clientMessageId,
      result: { type: "failed", error },
    });
  else if ("requestId" in input)
    emit({ type: "request.failed", requestId: input.requestId, error });
  else if ("sessionId" in input)
    emit({ type: "session.runtime_failed", sessionId: input.sessionId, error });
}
```

`session.runtime_failed` is the channel for a dead native runtime (process exit, protocol failure);
the host turns it into a `turn_failed` for the active turn.

---

## 4. Timeline items

### 4.1 Publishing

One event carries one **complete snapshot** of one item:

```ts
export type ProviderEvent =
  // …
  | { type: "timeline.item"; sessionId: string; item: ProviderTimelineItem; timestamp?: string };
```

`timestamp` is an optional ISO string used for the row's recorded time; omit it and the host uses
its own clock.

### 4.2 Item kinds — verbatim

```ts
interface ProviderTimelineIdentity {
  id: string;
  revertToken?: JsonValue;
}

type ProviderToolCallItem = ProviderTimelineIdentity & {
  type: "tool_call";
  callId: string;
  name: string;
  detail: ProviderToolCallDetail;
  metadata?: Readonly<Record<string, JsonValue>>;
} & (
    | { status: "running" | "completed" | "canceled"; error: null }
    | { status: "failed"; error: JsonValue }
  );

export type ProviderTimelineItem =
  | (ProviderTimelineIdentity & {
      type: "user_message";
      text: string;
      messageId?: string;
      clientMessageId?: string;
    })
  | (ProviderTimelineIdentity & { type: "assistant_message"; text: string; messageId?: string })
  | (ProviderTimelineIdentity & { type: "reasoning"; text: string })
  | ProviderToolCallItem
  | (ProviderTimelineIdentity & {
      type: "todo";
      items: Array<{
        text: string;
        completed: boolean;
        id?: string;
        status?: "pending" | "in_progress" | "completed";
        activeForm?: string;
      }>;
    })
  | (ProviderTimelineIdentity & { type: "error"; message: string })
  | (ProviderTimelineIdentity & {
      type: "notification";
      level: "info" | "warning" | "error";
      message: string;
    })
  | (ProviderTimelineIdentity & {
      type: "compaction";
      status: "loading" | "completed";
      trigger?: "auto" | "manual";
      preTokens?: number;
    })
  | (ProviderTimelineIdentity & {
      type: "plugin";
      pluginId: string;
      kind: string;
      version: number;
      data: JsonValue;
    });
```

There is no separate "progress" kind: progress is a `tool_call` in `status: "running"` whose
`detail` you keep updating, or a `compaction` row with `status: "loading"`. A provider-level toast
is `session.notice`, not a timeline item (the host renders a notice as a `notification` row).

`ProviderToolCallDetail` is the rich rendering contract — the host has first-class UI for each
variant, so map your native tools onto it instead of dumping text:

```ts
export type ProviderToolCallDetail =
  | { type: "shell"; command: string; cwd?: string; output?: string; exitCode?: number | null }
  | { type: "read"; filePath: string; content?: string; offset?: number; limit?: number }
  | {
      type: "edit";
      filePath: string;
      oldString?: string;
      newString?: string;
      unifiedDiff?: string;
    }
  | { type: "write"; filePath: string; content?: string }
  | {
      type: "search";
      query: string;
      toolName?: "search" | "grep" | "glob" | "web_search";
      content?: string;
      filePaths?: string[];
      webResults?: Array<{ title: string; url: string }>;
      annotations?: string[];
      numFiles?: number;
      numMatches?: number;
      durationMs?: number;
      durationSeconds?: number;
      truncated?: boolean;
      mode?: "content" | "files_with_matches" | "count";
    }
  | {
      type: "fetch";
      url: string;
      prompt?: string;
      result?: string;
      code?: number;
      codeText?: string;
      bytes?: number;
      durationMs?: number;
    }
  | { type: "worktree_setup"; worktreePath: string; branchName: string; log: string; commands: Array<{ index: number; command: string; cwd: string; log: string; status: "running" | "completed" | "failed"; exitCode: number | null; durationMs?: number; }>; truncated?: boolean }
  | {
      type: "sub_agent";
      subAgentType?: string;
      description?: string;
      childSessionId?: string;
      log: string;
      actions?: Array<{ index: number; toolName: string; summary?: string }>;
    }
  | {
      type: "plain_text";
      label?: string;
      text?: string;
      icon?:
        | "wrench"
        | "square_terminal"
        | "eye"
        | "pencil"
        | "search"
        | "bot"
        | "sparkles"
        | "brain"
        | "mic_vocal";
    }
  | { type: "plan"; text: string }
  | { type: "unknown"; input: JsonValue; output: JsonValue };
```

Always keep an `unknown` fallback for future native kinds — Muse does exactly that
(`server/timeline.ts`): `{ type: "tool_call", …, detail: { type: "plain_text", label: item.kind, text: item.fallbackText } }`.

### 4.3 The "complete updatable item" contract

**Publish complete snapshots, never deltas. Reuse the same `id` to update an item in place.** "Paseo
derives the live delta and keeps the normal timeline."

The host keeps the last snapshot per item id and computes the suffix itself
(`packages/server/src/server/agent/plugin-provider.ts`, verbatim):

```ts
function mapTimelineItem(
  item: ProviderTimelineItem,
  snapshots: Map<string, TimelineTextSnapshot>,
  revertTokens?: Map<string, ProviderTimelineItem["revertToken"]>,
): AgentTimelineItem | null {
  const previous = snapshots.get(item.id);
  if (isTextSnapshotItem(item)) {
    snapshots.set(item.id, { type: item.type, text: item.text });
  }
  const { id, revertToken: _revertToken, ...withoutIdentity } = item;
  rememberRevertToken(item, revertTokens);

  if (item.type === "assistant_message" || item.type === "reasoning") {
    const previousText = previous?.type === item.type ? previous.text : "";
    const suffix = item.text.startsWith(previousText)
      ? item.text.slice(previousText.length)
      : item.text;
    const text = Buffer.from(suffix, "utf16le").toString("utf16le");
    if (text.length === 0) return null;
    return item.type === "assistant_message"
      ? { type: "assistant_message", text, messageId: item.messageId ?? id }
      : { type: "reasoning", text };
  }
  if (item.type === "user_message") {
    if (previous?.type === "user_message" && previous.text === item.text) return null;
    return {
      type: "user_message",
      text: item.text,
      messageId: item.messageId ?? id,
      clientMessageId: item.clientMessageId,
    };
  }
  if (item.type === "plugin") { /* …replaces by id… */ }
  return withoutIdentity as AgentTimelineItem;
}
```

Consequences you must design for:

- **Streaming text**: each `assistant_message` / `reasoning` snapshot for one id must be a
  **monotonic extension** of the previous one (prefix-preserving). If it is not, the host falls back
  to publishing the whole new text as a suffix — visible duplication. A snapshot equal to the previous
  one emits nothing.
- **Completion overwrites deltas**: send the final full text under the same id; the host merges the
  row (`assistant_merge`, `reasoning_merge`, `tool_lifecycle`, `identity` projection kinds in
  `packages/server/src/server/agent/timeline-projection.ts`).
- **Tool calls**: keep `id` and `callId` stable and re-emit the whole item with a new `status` /
  `detail`. The projection collapses the lifecycle into one row. `status: "failed"` requires a
  non-null `error`; the other three statuses require `error: null`.
- **Todo lists**: one id per list view; re-emit the whole `items` array on every change
  (Muse: `id: \`todo:${todo.viewCursor}\``).
- **Transient rows must be terminalized before the turn's terminal event.** "A terminal turn must
  never leave the client showing an operation as still loading." Close every running tool, pending
  compaction, and in-flight item before you emit `session.turn` `completed`/`failed`/`canceled`.
- History replay uses the same path: the host stores a projected timeline, not every delta
  (`plugin-session-history.ts`: "Replay canonical items, rather than retaining every streamed delta
  or tool state."). So replaying a full snapshot stream is always safe.

Idiomatic implementation (Muse `server/timeline.ts`): keep a `Map<string, WireItem>` keyed by the
native item id, drop stale revisions, and re-emit the mapped item on every native
`item/started | item/updated | item/completed | item/delta`:

```ts
async fold(item: WireItem): Promise<boolean> {
  if (item.kind === "reminderChild") return false;
  const previous = this.items.get(item.itemId);
  if (previous && previous.revision >= item.revision) return false;
  // …fetch any patch payload…
  this.items.set(item.itemId, item);
  this.emit({ type: "timeline.item", sessionId: this.id, item: timelineItem(item, …), timestamp: item.recordedAt });
  return true;
}
delta(delta: z.infer<typeof deltaSchema>): void {
  const previous = this.items.get(delta.itemId);
  if (!previous || previous.status !== "inProgress") return;
  const item = appendDelta(previous, delta);
  if (!item) return;
  this.items.set(item.itemId, item);
  this.emit({ type: "timeline.item", sessionId: this.id, item: timelineItem(item) });
}
```

Note the direction: the **provider** accumulates native deltas into a complete snapshot; the host
then re-derives the delta. Never forward a raw partial chunk as its own item.

### 4.4 Item id conventions

- `id` is your own stable identity, unique **per session**, and must be reused for updates. It is
  never rewritten by Paseo; it becomes the row's provider message id (`messageId ?? id`) for
  messages.
- Prefer the **native upstream id** when one exists (Muse uses `item.itemId` directly). That makes
  replay, resume, and gap backfill idempotent.
- When you mint ids, namespace them so they cannot collide with native ids or with other turns.
  Observed conventions in the repo:
  - `plugins/antigravity-provider`: `` id: `${turn.id}:${step.step_index}` `` (turn-scoped),
    `` id: `${this.options.id}:full-access` `` for a one-shot notice row,
    `` id: `${turn.id}:denied` ``.
  - `plugins/hoplite-provider`: `` id: `hoplite-run-phase:${runId}` `` — a feature prefix plus the
    upstream entity id, used as both `id` and `callId`.
  - `plugin-examples/provider-direct`: `user-${n}` / `assistant-${n}` / `provider-result-${n}`.
  - `plugins/muse-provider`: `todo:${viewCursor}`.
- `callId` on a `tool_call` should equal the native tool-call id when one exists, otherwise the
  item id (Muse: `callId: item.callId ?? id`).
- `clientMessageId` goes **only** on the echo of a foreground prompt — copy
  `prompt.clientMessageId` onto that `user_message`. Provider history and externally initiated user
  rows must not carry it.
- `revertToken` (optional, any item) is the rewind token; the host remembers it under `id` and, for
  messages, under `messageId ?? id`.
- `type: "plugin"` items additionally need `pluginId` = **the installed plugin ID** (the manifest
  `id`, not the provider id), a `kind` string, and a positive integer `version`. Requires the
  `timeline.plugin` capability.

### 4.5 Custom item renderers

Register the renderer in `index.client.tsx`; the same renderer serves provider-emitted, transformed,
and daemon-appended rows, and a renderer does not require a provider.

```tsx
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { z } from "zod";
import { ReviewVerdict } from "./client/review-verdict";

const reviewVerdictSchema = z.object({
  verdict: z.enum(["ship", "hold"]),
  summary: z.string(),
});

export default function contribute(client: PluginClientContext) {
  client.addTimelineRenderer({
    kind: "review-verdict",
    version: 1,
    schema: reviewVerdictSchema,
    Component: ReviewVerdict,
  });
  return () => {};
}
```

Keep the `kind` and schema in `shared/` so server and client share one definition
(`plugin-examples/provider-direct/shared/provider-result.ts`):

```ts
import { z } from "zod";

export const providerResultKind = "provider-result";

export const providerResultSchema = z.object({
  label: z.string(),
  detail: z.string(),
});
```

The component receives `PluginTimelineItemProps<TData>` (`item`, `theme`) and must render on desktop
and mobile-width layouts with `theme.colors.*`. A row with no installed renderer shows an unavailable
placeholder.

---

## 5. Turn lifecycle

### 5.1 Terminal turn event — verbatim

```ts
export type ProviderEvent =
  // …
  | {
      type: "session.turn";
      sessionId: string;
      turnId: string;
      state: "started" | "completed" | "failed" | "canceled";
      error?: ProviderError;
    }
  | { type: "session.usage"; sessionId: string; turnId?: string; usage: ProviderUsage }
  | { type: "session.config"; sessionId: string; config: ProviderConfigState }
  | { type: "session.commands"; sessionId: string; commands: ProviderCommand[] }
  | { type: "session.permission"; sessionId: string; request: ProviderPermissionRequest }
  | { type: "session.permission_resolved"; sessionId: string; permissionId: string }
  | { type: "session.notice"; sessionId: string; notice: ProviderNotice }
  | { type: "timeline.item"; sessionId: string; item: ProviderTimelineItem; timestamp?: string };
```

```ts
export interface ProviderNotice {
  id: string;
  severity: "info" | "warning" | "error";
  title: string;
  description?: string;
  dismissed?: boolean;
}
```

### 5.2 Exactly-once rules

1. **One `session.prompt_result` per `clientMessageId`** — always, including for steers and rejected
   inputs.
2. **Every `session.turn` with `state: "started"` needs exactly one terminal**
   (`completed` | `failed` | `canceled`) for the same `turnId`. "Every started turn needs one
   terminal `completed`, `failed`, or `canceled` event."
3. A turn you never started (autonomous/native-initiated work) may be observed without a prompt
   result; but if you emit `started`, you owe the terminal. Muse guards this with an explicit
   `Map<string, "active" | "completed">` and ignores duplicate or unknown terminals.
4. Terminalize every transient timeline row **before** the terminal turn event.
5. `session.turn` is the only turn signal. Do not signal completion through a timeline item.
6. Ordering inside a turn: `prompt_result` → `turn started` → user echo + assistant/reasoning/tool
   rows → `session.usage` → `session.persistence` (optional) → terminal `turn`.

Host mapping (`plugin-provider.ts`): `started → turn_started`, `completed → turn_completed`,
`canceled → turn_canceled` (reason = `error.message ?? "Canceled by provider"`), `failed →
turn_failed` (`error`, `code`, `diagnostic`). The host tracks `currentTurnId` from `started` and
stamps it onto timeline/permission events, so **do not interleave turns**.

### 5.3 Usage / token reporting

```ts
export interface ProviderUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
  contextWindowMaxTokens?: number;
  contextWindowUsedTokens?: number;
}
```

Emit `session.usage` whenever the native runtime reports it; include `turnId` when the numbers belong
to a turn (context-window rows are usually session-scoped and omit it). The host forwards it as
`usage_updated`.

Two real patterns:

- Antigravity accumulates per-step usage and re-emits the **cumulative turn total** with `turnId`
  once per completed step, deduplicating steps it has already counted
  (`turn.usageSteps: Set<number>`).
- Muse maps two distinct native feeds: `session/tokenUsage` →
  `{ inputTokens, outputTokens, cachedInputTokens }` (no `turnId`), and `session/contextUsage` →
  `{ contextWindowUsedTokens, contextWindowMaxTokens }`.

Set `ProviderModel.contextWindowMaxTokens` in the catalog so the app can render context pressure
before any usage event arrives.

### 5.4 Error reporting

- Per-input failure → `request.failed` (inputs with a `requestId`) or
  `session.prompt_result { result: { type: "failed", error } }` (prompts).
- Per-turn failure → `session.turn { state: "failed", error }`; cancellation →
  `session.turn { state: "canceled", error? }` (`error.message` becomes the human reason).
- Dead runtime → `session.runtime_failed { sessionId, error }` (the host turns it into a
  `turn_failed` for the active turn). `session.closed { error }` is treated the same way.
- Non-fatal, user-facing warnings → `session.notice` (e.g. Antigravity emits one full-access warning
  per open, none on respawn).
- `ProviderError.code` and `.diagnostic` survive to the client; use `code` for machine-readable
  classes (`"TURN_ACTIVE"`, `"authRequired"`) and `diagnostic` for remediation text.

---

## 6. Session config: model selection and thinking level

### 6.1 At creation

The selected catalog values arrive on `session.open` in `ProviderSessionConfig`:
`model`, `mode`, `thinkingOption`, plus `settings` (your composer controls) and `providerOptions`
(opaque, provider-owned). Create the native session with them, then publish what was actually
selected:

```ts
emit({
  type: "session.config",
  sessionId: input.sessionId,
  config: {
    model: nativeSession.model,
    mode: nativeSession.mode,
    thinkingOption: nativeSession.thinking,
    models,
    modes,
    thinkingOptions,
    settings: [],
  },
});
```

```ts
export interface ProviderConfigState {
  model?: string;
  mode?: string;
  thinkingOption?: string;
  models: readonly ProviderModel[];
  modes: readonly ProviderMode[];
  thinkingOptions: readonly ProviderThinkingOption[];
  settings: readonly ProviderSetting[];
}

export type ProviderSetting =
  | {
      type: "toggle";
      id: string;
      label: string;
      description?: string;
      value: boolean;
    }
  | {
      type: "select";
      id: string;
      label: string;
      description?: string;
      value: string | null;
      options: ReadonlyArray<{ label: string; value: string }>;
    };
```

`session.config` is the single source of truth for the composer: the host turns it into
`mode_changed`, `model_changed`, and `thinking_option_changed` stream events. Publish it after
`session.opened` and after every change. It "contains the committed values. Publish what the native
agent selected after normalization, not a copy of the request."

### 6.2 Changing model / thinking mid-session

Only implement `session.configure` (capability `session.configure`) when users may change settings
after opening. Apply, publish `session.config`, then `request.completed`. The provider may change
which controls exist at runtime, including after a model change.

Muse's approach (`server/session.ts`) is the reference for a provider with no per-field API:

```ts
async configure(changes: ProviderConfigChanges): Promise<void> {
  if (changes.model !== undefined) {
    if (!changes.model) throw new MuseError("invalidModel", "Choose a Muse model");
    await this.host.command("session/setModel", { /* … */ }, ackSchema);
    this.config = { ...this.config, model: changes.model };
  }
  // Muse receives configured thinking effort on each turn/start, rather than a session mutation.
  if (changes.thinkingOption !== undefined) {
    const thinkingOption =
      changes.thinkingOption === null ? undefined : effortSchema.parse(changes.thinkingOption);
    this.config = { ...this.config, thinkingOption };
  }
  if (changes.mode !== undefined) {
    const mode = approvalModeSchema.parse(changes.mode ?? "onRequest");
    await this.host.command("session/setApprovalMode", { /* … */ }, ackSchema);
    this.config = { ...this.config, mode };
  }
  this.publishConfig();
  this.publishPersistence();
}
```

If a change only takes effect on the next turn (Antigravity does this), apply it lazily and publish
a `session.notice` explaining the deferral — never silently pretend it applied.

Thinking level may be applied per turn rather than as a session mutation (Muse sends
`reasoningEffort` on every `turn/start`). Persist the effective model/thinking in your
`ProviderPersistence` so a resume restores the same conversation with the same settings:

```ts
private persistence(): ProviderPersistence {
  return {
    version: 1,
    data: {
      sessionId: this.live().nativeId,
      ...(this.config.model ? { model: this.config.model } : {}),
      ...(this.config.thinkingOption ? { thinkingOption: this.config.thinkingOption } : {}),
    },
  };
}
```

### 6.3 `settings` vs `providerOptions`

- `settings` are **user-facing** toggle/select controls Paseo renders in the composer; changes come
  back through `session.configure`.
- `providerOptions` is **opaque JSON** supplied at session creation for configuration Paseo does not
  render. The daemon deep-merges `agents.providers.<id>.options` with the agent's `config.options`
  (objects merge recursively; arrays, scalars and `null` replace) and hands you the result. Validate
  and apply it inside the provider — core does not know your shape, and strict unknown-key rejection
  with a message naming the bad key is the expected behaviour.
- A provider-specific token budget belongs in one of those two places; it is not a prompt field.
- Host tools arrive as MCP servers in `config.mcpServers` (the daemon injects its own server unless
  you can register tools natively). Per-session `config.env` overlays `launch.env`.

---

## 7. Testing

Framework: **Vitest** (`vitest ^4.1.6`), run from the workspace root
(`npx vitest run plugins/<id>`) or via `npm run test --workspace=@getpaseo/builtin-plugins`. CI runs
that workspace test job. There is **no mock of the Paseo host** — the test *is* the host seam: you
drive the real `ProviderConnection` with real `ProviderInput` objects and assert on the real
`ProviderEvent` stream, validating every event with the published `ProviderEventSchema`.

### 7.1 Harness shape (muse-provider, `test/provider.test.ts`)

```ts
import {
  PROVIDER_CAPABILITIES,
  ProviderEventSchema,
  type ProviderConnection,
  type ProviderEvent,
  type ProviderRegistration,
  type ProviderLaunch,
  type ProviderInput,
} from "@getpaseo/plugin/server/provider";
import contribute from "../index.server.js";

const connections: ProviderConnection[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(connections.splice(0).map((connection) => connection.close()));
});

function registration(
  registerUsageSource = (_source: UsageSourceRegistration) => {},
): ProviderRegistration {
  let provider: ProviderRegistration | undefined;
  const server = {
    registerUsageSource,
    registerProvider(value: ProviderRegistration) {
      provider = value;
    },
  };
  contribute(server);
  if (!provider) throw new Error("Provider was not registered");
  return provider;
}
```

The "mock" of the vendor is a **fake CLI subprocess** driven by recorded fixtures, injected through
the daemon-shaped `launch`:

```ts
const launch: ProviderLaunch = {
  command: process.execPath,
  args: [fileURLToPath(new URL("./fake-muse.mjs", import.meta.url))],
  env: { MUSE_TEST_SCENARIO: scenario, MUSE_TEST_REQUESTS: requests, ...env },
};
const connection = await provider.connect({
  launch,
  versions: [1],
  capabilities: PROVIDER_CAPABILITIES,
});
const events: ProviderEvent[] = [];
connection.onEvent((event) => {
  events.push(ProviderEventSchema.parse(event));
});
async function wait(
  predicate: (event: ProviderEvent) => boolean,
  from = 0,
): Promise<ProviderEvent> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const event = events.slice(from).find(predicate);
    if (event) return event;
    await delay(10);
  }
  throw new Error(`Missing event; received ${JSON.stringify(events)}`);
}
```

Assertions then run on the event stream plus the subprocess's recorded request log
(`recorded()` reads the NDJSON the fake CLI wrote), e.g.:

```ts
test("text and reasoning stream, completion overwrites deltas, user echo retains client identity", async () => {
  const h = await harness();
  expect(await h.open()).toMatchObject({ type: "session.ready" });
  await h.prompt();
  await h.wait((event) => event.type === "session.turn" && event.state === "completed");
  expect(h.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "timeline.item",
        item: expect.objectContaining({ type: "reasoning" }),
      }),
      expect.objectContaining({
        type: "timeline.item",
        item: expect.objectContaining({
          type: "user_message",
          clientMessageId: expect.stringMatching(/^client-/),
        }),
      }),
    ]),
  );
});
```

`plugins/antigravity-provider/server/provider.test.ts` uses the same shape with
`expect.poll(...)` for waiting and adds a `request()` helper that waits for the matching
`requestId` settlement. It also asserts the icon contract (§2.2) and drives argv/env preservation
through the fake binary.

### 7.2 Fixture discipline

`plugins/muse-provider/test/fixtures/*.ndjson` are real captures: each line is
`{ "dir": "out" | "in", "msg": <JSON-RPC message> }`, and `test/fixtures/README.md` records the CLI
version, build, fingerprints, capture date, and what each file proves — "Replay consumers should
treat IDs and cursors as opaque and compare behavior rather than wall-clock values." Generated
variants are explicitly labelled as protocol probes, not real-host captures.

### 7.3 Unit tests for pure mapping logic

Hoplite keeps its transformer pure and tests it directly
(`plugins/hoplite-provider/server/run-phase.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { runPhaseTransformer } from "./run-phase.js";

const context = { sessionId: "session-1" };

// Frames captured from `hoplite acp` 3.0.0.
function runPhase(phase: string | null, label: string | null) {
  return { method: "_hoplite/run_phase", params: { /* … */ } };
}

describe("runPhaseTransformer", () => {
  it("shows a provisioning phase as one running workspace item per run", () => {
    const update = runPhaseTransformer.notification?.(
      runPhase("fetching_repository", "Cloning repository"),
      context,
    );
    expect(update).toEqual({
      type: "timeline",
      item: {
        type: "tool_call",
        id: "hoplite-run-phase:run_eb213b97bd3147afb2927fbc27f87180",
        callId: "hoplite-run-phase:run_eb213b97bd3147afb2927fbc27f87180",
        name: "Hoplite workspace",
        detail: { type: "plain_text", label: "Cloning repository", icon: "wrench" },
        status: "running",
        error: null,
      },
    });
  });
});
```

`plugin-examples/provider-direct/server/provider.test.ts` shows the minimal direct-provider test:
`connect({ versions: [1], capabilities: [...] })`, collect events, `send(...)`, assert with
`expect(events).toContainEqual(...)`, and assert post-close behaviour
(`await expect(connection.send(…)).rejects.toThrow("Provider connection is closed")`).

### 7.4 Manual acceptance (from `public-docs/plugins/providers.md`)

"Test the provider against the real agent, not only mocked frames": install as a directory source;
confirm the SVG, models, modes and settings appear; complete a real prompt; exercise permissions,
steering, cancellation, persistence and replay; render every custom timeline item at desktop and
mobile widths; reload and remove the plugin while a session is active and confirm the session
terminates. CLI: `paseo run --provider <id>`, `paseo models --provider <id>`,
`paseo plugin logs <id>`.

---

## 8. Conventions

### 8.1 File layout used by real provider plugins

```text
plugins/muse-provider/
  paseo-plugin.json          # { "id": "muse-provider", "requirements": { "paseo": ">=0.11.0" } }
  icon.svg                   # provider icon, referenced as icon: "icon.svg"
  index.server.ts            # default-exported contribute(); no logic
  server/
    provider.ts              # ProviderRegistration + connection dispatch
    session.ts               # one native session: open/prompt/configure/interrupt/close
    connection.ts            # the native transport (MSP over `muse serve`)
    catalog.ts  sessions.ts  children.ts  commands.ts  questions.ts
    timeline.ts              # native item -> ProviderTimelineItem mapping + snapshot store
    wire.ts                  # Zod schemas for the native protocol
    msp.d.ts                 # vendored native protocol types
    errors.ts                # typed error class + actionableError()
    usage.ts                 # optional usage source (server.registerUsageSource)
  test/
    fake-muse.mjs            # fake CLI subprocess driven by fixtures
    fixtures/*.ndjson        # real captured protocol frames
    fixtures/README.md       # capture provenance per fixture
  test/provider.test.ts      # end-to-end provider protocol tests
```

`plugins/antigravity-provider/` uses `server/provider.ts` + `server/internal/*` (catalog, process,
prompt, session, timeline, wire, signals) with `server/provider.test.ts` and `test/agy.mjs` +
`test/fixtures/`. `plugins/hoplite-provider/` is the minimum viable ACP adapter: `paseo-plugin.json`,
`icon.svg`, `index.server.ts`, `server/provider.ts`, `server/run-phase.ts`, `server/run-phase.test.ts`.
`plugin-examples/provider-direct/` adds `index.client.tsx`, `client/`, and `shared/` for the timeline
renderer.

Rules:

- `index.server.ts` is registration wiring only. "Runtime code lives behind directory boundaries."
- `server/` = Node, processes, credentials. `client/` = React/React Native. `shared/` = Zod contracts
  and plain values used by both (e.g. the timeline item `kind` + schema). **A code file at the plugin
  root is a compile error**; the compiler rejects cross-directory imports, React in server code, and
  `node:` imports in client code.
- A provider with no custom timeline items can omit `index.client.tsx` entirely (muse, hoplite,
  antigravity do).
- No `index.ts` barrel files that only re-export.
- Keep the native SDK/process/protocol inside the connection; convert to `ProviderEvent` objects
  before publishing.

### 8.2 Lint / format

Repo-wide, applied to plugins too (lefthook pre-commit runs format, lint, and typecheck):

- Formatter `oxfmt` (`.oxfmtrc.json`): 2 spaces, no tabs, `printWidth: 100`, double quotes, trailing
  commas `all`, semicolons, `arrowParens: "always"`, bracket spacing on. `npm run format` /
  `npm run format:check`.
- Linter `oxlint` (`.oxlintrc.json`, plugins: react, react-perf, unicorn, typescript, oxc, import,
  promise) plus a local `paseo/*` rule set. A targeted override exists for provider plugins:

```json
{
  "files": ["plugins/*-provider/server/**/*.ts", "packages/plugin/src/server/acp-internal/**/*.ts"],
  "rules": {
    "no-restricted-imports": ["error", { "paths": [
      { "name": "node:child_process", "importNames": ["spawn","exec","execFile","spawnSync","execSync","execFileSync"],
        "message": "Use the plugin server process helpers so Windows command scripts and argv are handled consistently." },
      { "name": "child_process", "importNames": ["spawn","exec","execFile","spawnSync","execSync","execFileSync"],
        "message": "Use the plugin server process helpers so Windows command scripts and argv are handled consistently." }
    ]}]
  }
}
```

- `knip.json` treats `plugins/**/index.{server,client}.{ts,tsx}` and `plugins/**/*.test.ts` as
  entries, so unused files and unused dependencies are reported for plugins.
- House style (`docs/coding-standards.md`): no `any`, no `as` casts to bypass errors, no
  `@ts-ignore`; if a Zod schema exists the type is `z.infer<typeof schema>`; `interface` over `type`
  where both work; `function` declarations over arrow assignments; discriminated unions over optional
  bags; typed error classes carrying the fields a caller reads; no `try/catch` "just in case"; no
  `console.log`; comments explain why, not what.

### 8.3 Minimal skeleton for a new provider

```text
my-agent-provider/
  paseo-plugin.json          # { "id": "my-agent-provider", "requirements": { "paseo": ">=0.14.0" } }
  icon.svg                   # 24x24, fill="currentColor", no literal colors
  index.server.ts
  server/
    provider.ts              # createMyAgentProvider(): ProviderRegistration
    session.ts               # per-session state machine + event emission
    wire.ts                  # Zod schemas for the native protocol
    errors.ts                # typed error + actionable mapping
  server/provider.test.ts
  test/fake-agent.mjs        # fake CLI replaying test/fixtures/*.ndjson
  package.json               # devDependencies only, files: [paseo-plugin.json, index.server.ts, server/, icon.svg]
  tsconfig.json              # noEmit, strict
```

```ts
// server/provider.ts
import {
  negotiateProviderCapabilities,
  requireProviderCapabilities,
  type ProviderConnection,
  type ProviderEvent,
  type ProviderInput,
  type ProviderRegistration,
} from "@getpaseo/plugin/server/provider";

const capabilities = ["prompt.message", "session.persistence"] as const;

export function createMyAgentProvider(): ProviderRegistration {
  return {
    id: "my-agent",
    label: "My Agent",
    description: "My Agent CLI on your host",
    icon: "icon.svg",
    command: ["my-agent"],
    async status({ launch }) {
      if (!launch) return { available: false, diagnostic: "Install My Agent and ensure `my-agent` is on PATH." };
      return status(launch);
    },
    async connect(request) {
      if (!request.versions.includes(1)) throw new Error("Provider protocol version 1 is required");
      const negotiated = negotiateProviderCapabilities(request.capabilities, capabilities);
      return createConnection(request.launch, negotiated);
    },
  };
}
```

Then the connection: `version: 1`, `capabilities: negotiated`, `send()` that validates and dispatches,
`onEvent()` that registers a listener, `close()` that releases everything.

---

## 9. Gotchas

1. **`send()` is acceptance, not completion.** Everything observable is an event. A `send()` that
   resolves without a matching event leaves the host waiting.
2. **Provider ID ≠ plugin ID.** `muse-provider` registers `muse`. Users configure
   `agents.providers.muse`, not `muse-provider`. Provider IDs used in config must match
   `/^[a-z][a-z0-9-]*$/`.
3. **Two different icons.** Manifest `icon` = PNG (listing). `ProviderRegistration.icon` = SVG file
   path (app provider list). Register the icon with the plugin; do not expect the app's provider icon
   map to know you.
4. **Never spawn with raw `node:child_process`.** Use `spawnProcess` / `execCommand` /
   `terminateProcess`; raw `spawn`/`execFile` reject Windows `.cmd`/`.bat` launchers. Pass
   `launch.env` explicitly — the helpers do not apply daemon environment policy.
5. **Do not merge your own process env into the child.** The daemon already applied user overrides
   and stripped parent-session/daemon-control variables.
6. **Streaming text must be prefix-monotonic per item id.** A non-prefix "update" is published as a
   whole new suffix and looks duplicated. Accumulate native deltas yourself, then publish the full
   snapshot.
7. **Terminalize transient rows before the terminal turn event.** A `tool_call` left in `running`
   when `turn_completed` arrives shows a permanently loading card.
8. **Exactly one `prompt_result` per `clientMessageId`, exactly one terminal per started turn.**
   Duplicate terminals are ignored by well-behaved hosts but indicate a state bug; missing terminals
   hang the session.
9. **Copy `clientMessageId` onto the user echo** or Paseo keeps its optimistic message and you get
   two. Never attach it to provider-history or externally initiated user rows.
10. **`session.open` is the only reload.** Refresh = close + open with current config and
    persistence. Re-read credentials, env, and MCP servers there; cache nothing that must survive a
    config change.
11. **`providerOptions` is yours to validate.** Reject unknown keys with a message naming the key;
    the daemon already deep-merged defaults and per-agent overrides for you.
12. **Catalog discovery is one API.** Do not open scratch sessions just to list models or commands —
    they show up as empty native sessions in provider import/history UIs. Resolve the cache key with
    the actual `{ scope: "global" }` or `{ scope: "workspace", cwd }` target you were given.
13. **Respect the shared refresh deadline.** The manager owns one deadline per provider covering
    availability plus the whole probe; name active operations and close subprocesses before rejecting.
14. **`session.can_stop_runtime` must never be answered with `request.completed`**, and must not
    mutate the session.
15. **`session.prompt` and `session.permission` have no `requestId`** — do not emit
    `request.completed` for them.
16. **`tool_call` status/error pairing is strict**: `failed` requires non-null `error`;
    `running`/`completed`/`canceled` require `error: null`. The Zod schema enforces it.
17. **Mode IDs can be URIs** (ACP providers do this). Never assume they are short strings, and keep
    your catalog and your runtime mode ids identical.
18. **`enabled: false` vs `extends`.** A same-ID config entry without `extends` overrides your
    plugin's enabled/command/env/label/models; an entry **with** `extends` shadows your plugin and
    logs a warning. `requiresConfiguration: true` opts your provider into existing config entries.
19. **Built-ins may import only host modules and Node built-ins** — an npm dependency resolves
    through the repo's `node_modules` in tests but fails in the packaged app.
20. **Editing a built-in plugin requires a daemon restart**; a directory source uses
    `paseo plugin reload <id>` (a failed reload stays failed — Paseo does not restore the old code).
21. **Provider config changes rebuild the registry entry and invalidate the catalog, but running
    sessions keep their current launch until refreshed.**
22. **Session-scoped cancellation needs a stop boundary inside your provider.** If the native cancel
    is session-scoped, its settlement is too: track every cancel you issued, gate daemon-issued runs
    (prompt, command, summarize) on it, keep permission/question responses outside the gate, and fail
    closed if the cancel never succeeded.
23. **Keep the plugin log clean** — plugin stdout/stderr goes to the user-visible plugin log
    (`paseo plugin logs <id>`); never log credentials or tokens.
