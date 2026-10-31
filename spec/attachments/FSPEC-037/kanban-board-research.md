# Research: fspec Kanban board as a native Paseo workspace panel

Scope decision (user, 2026-10-30): **parity with what the fspec board offers today, nothing more.**
No status (column) changes, no card create/edit, no epics/coverage/foundation views —
the fspec TUI board does none of these either. No fspec daemon changes are required.

Sources verified at: fspec `9fa9a798` (2026-10-30), Paseo `0feaf0d98` (tag `v0.14.0-beta.2`),
fspec-paseo `d5de7c3`. Paths: `fspec:` = `~/projects/fspec/rust/`, `paseo:` = `~/projects/paseo/`.

---

## 1. What the fspec board offers (the parity target)

### 1.1 CLI `fspec board` (`fspec:fspec-core/src/commands/board.rs:57-163`)
- Seven columns in fixed order: `backlog, specifying, testing, implementing, validating, done, blocked`.
- Within a column, order = the `states[<column>]` array order in `spec/work-units.json`.
- Each row: `ID  title  [points]` (points only when `estimate` is set); `--limit` (default 25) per column, then `… N more`.
- Footer summary: `"N points in progress, M points completed"` — estimates in `done` are completed, all other columns count as in progress.

### 1.2 TUI board (`fspec:fspec-tui/src`) — the richer reference
- **Data source is RPC only** — never reads files. Bootstrap calls `list_work_units()` (`app/bootstrap.rs:29-31`), then
  every `Envelope::WorkUnitsUpdate` snapshot replaces the board (`app/bootstrap.rs:140-158`,
  `transport/websocket/subscriptions.rs:5-13`). `BoardStore::replace_work_units` (`store/board.rs:86-146`) groups by
  `status` and keeps the cursor on the same card id across snapshots. Column order `store/board.rs:20-28`.
- **Card label** (`views/board/viewport.rs:144-159`): `ID [pts]`; prefix `🟢` when a session is focused on that work unit;
  the card with the most recent `lastStateChangeAt` is wrapped `⏩…⏩`.
- **Details strip** for the selected card (`views/board/details_strip.rs:276-285`): title, description, attachments,
  `Epic | Estimate | Status`.
- **Interactions** (`views/board.rs:155-268`, `views/board/keys.rs:40-127`):
  | Input | Effect |
  |---|---|
  | arrows / j k / Home End / PgUp PgDn / mouse | select card (local state) |
  | `[` / `]` | reorder within column → `move_work_unit_up` / `move_work_unit_down` RPC (`app/dispatch.rs:162-183`) |
  | Enter | chooser: **Open in agent** / **Show full details** |
  | Show full details | `get_work_unit_details` (`app/dispatch_board_card.rs:35-64`); sections Overview, Description, Planning (userStory, rules, examples, questions, assumptions, architectureNotes), Relationships, History, Accounting, Timestamps, Attachments (`components/board_card/document.rs:52-79`) |
  | Open in agent | switch to the existing session focused on that card, else open create-session with the card as context (`app/dispatch_work_unit_entry.rs:6-29`) |
  | `/` | search |
  | `a` | attachments |
- Header shows checkpoint counts (`checkpoint_counts`, idx 8). Other TUI keys (`f c d m p u`, `.`, Shift+→) are
  app-level navigation, not board features.
- **The TUI has no status (column) change.** Confirmed by grep.

---

## 2. fspec daemon RPC surface we use (all exist today)

Bincode variant index = declaration order across `rpc/src/service_declaration/{workspace,providers_sessions,supervision_credentials}.rs`
(verified by counting `async fn` in order):

| idx | Method | Returns | Use |
|---|---|---|---|
| 0 | `list_work_units()` | `Vec<WorkUnitInfo>` | initial / fallback snapshot (already in `server/wire.ts`) |
| 18 | `move_work_unit_up(id)` | `Result<(), String>` | `[` reorder. Errors in `done` column |
| 19 | `move_work_unit_down(id)` | `Result<(), String>` | `]` reorder |
| 56/57 | `get/set_work_unit_focus` | `Result<WorkUnitFocus, String>` | already in wire.ts (FSPEC-025) — open-in-agent focus |
| 123 | `get_work_unit_details(id)` | `Result<String, String>` | **new at fspec HEAD; missing from our wire.ts** — JSON `{"id","workspace","workUnit": <raw record>}` read fresh from disk (`rpc/src/work_unit_details.rs:21-72`) |
| 8 | `checkpoint_counts()` | — | optional header parity |

### Push frames (full surface, path `/`)
- `Envelope::WorkUnitsUpdate(Vec<WorkUnitInfo>)` = 3: sent at connect and on every debounced (100 ms) change to
  `work-units.json` (`rpc-server/src/server.rs:172-194, 340-368`; watcher `core/src/work_units.rs:213-326`).
  Full snapshot, not a delta, ordered by `states[col]` across the seven columns; units missing from every state array
  are appended sorted by id (`read_snapshot`, `:156-191`).
- `Envelope::SessionSnapshot(Vec<SessionInfo>)` = 8 (each has `work_unit_focus`) and
  `Envelope::SessionEvent(FocusChanged{session_id, focus})` = 7 → which session is on which card (🟢).
- Reorder writes go through `work-units.json` under `work-units.json.lock`, so they echo back as a `WorkUnitsUpdate` to
  every client — no optimistic local reorder needed.

### WorkUnitInfo (bincode field order matters; `rpc-types/src/lib.rs:55-79`)
`id, title, work_type, status, description?, estimate?: i32, epic?, attachments: Vec<String>, last_state_change_at?`
— already decoded by `server/wire.ts:99-108, 698-722`.

### fspec-paseo today
- `server/daemon.ts` shares one socket per daemon (FSPEC-014) and exposes `onEnvelope(listener)` (`daemon.ts:482`);
  `handshake.workUnitsUpdate` is tracked but **nothing consumes the work-units push**.
- FSPEC-025 rule 0 explicitly kept the board out of the conversation timeline ("The board stays in fspec") — a
  dedicated panel is the right home.
- FSPEC-015 refuses sessions whose cwd is outside the daemon's workspace — the board must apply the same guard.

---

## 3. Paseo plugin UI (verified against installed `@getpaseo/plugin@0.14.0-beta.2`)

- **Entries by filename**: `index.client.tsx` (app) + `index.server.ts` (daemon). Code must live in `client/`, `server/`,
  `shared/` (`paseo:public-docs/plugins/reference.md:129-153`). Manifest has no entry field.
- **Real React Native**, not a webview: daemon esbuilds `index.client.tsx` (`packages/server/src/server/plugins/compiler-build.ts:351-383`;
  externals react, react-native, react/jsx-runtime, zod, @tanstack/react-query, SDK); every app (Electron, web, iOS,
  Android) fetches the bundle over its daemon connection (`getPluginCatalog`), caches it by SHA-256, and `eval`s it
  (`packages/app/src/plugins/evaluate.ts:509-538`). Only RN primitives (`View, Text, Pressable, ScrollView, FlatList,
  TextInput`) and `@getpaseo/plugin/client/ui` (`Icon, Modal, useToast, Markdown, Loading, …`). No native modules,
  no DOM, no `react-native-svg`. Colours from `theme.colors`.
- **Workspace panel**: `addWorkspacePanel({ id, title, icon, locations?: ("workspace"|"explorer")[], Component })`
  (`packages/plugin/src/client/contracts.ts:107-112`). Props `{ workspaceId, params, revision, tab, theme, host,
  layout: { compact, platform }, navigation? }` (`:24-51, :122-127`).
- **Workspace path**: `useWorkspace(workspaceId, w => w.directory)` (`packages/plugin/src/contracts.ts:22-36`).
- **Per-tab state**: `useTabState(tab, schema, default)` (≥ 0.13.0).
- **Entry points**: Command Center item (`context: "workspace"`, `openPanel(id)`), slash command (`context: "workspace"`).
- **Plugin RPC**: `defineRpc({ name, input, output })` in `shared/`; server `server.handle(contract, handler)`;
  client `useRpc(contract)` / `ctx.rpc`. Zod-validated both sides. Example: `paseo:plugin-examples/local-plugin`.
- **No server→UI push.** Only request/response (`packages/protocol/src/messages.ts:1476-1601`).
  **Timeouts**: client default 60 s (`packages/client/src/daemon-client.ts:1113`), daemon→plugin-process request
  timeout **30 s** (`packages/server/src/server/plugins/runtime.ts:41`). → **long-poll must hold ≤ ~20 s.**
- **Open in agent from UI**: `usePaseo().workspaces.ref(workspaceId).agents.create({ config: { provider: "fspec/<model>" }, prompt })`
  then `navigation?.openAgent({ agentId })`; `navigation` may be undefined on old hosts.

### Mobile
- All contribution points render on iOS/Android/web/Electron. On compact layouts a workspace panel is a workspace tab
  (launcher `packages/app/src/workspace-tabs/launcher/index.tsx:200-218`, header tab switcher
  `.../compact-workspace-header/tab-switcher.tsx:119` — falls back to the raw panel id, so use a readable id).
- `Modal`/popovers become bottom sheets on compact layouts. `layout.compact` from `useIsCompactFormFactor()`
  (`packages/app/src/plugins/workspace-panels/panel.tsx:65-69`). `useWindowDimensions` available.
- Remote phones reach plugin RPC over the same daemon WS (direct or relay). On reconnect mounted panels keep their
  query caches; observations resume — a long-poll re-issue naturally resyncs.

---

## 4. Design

```
fspec daemon ──WS push: WorkUnitsUpdate, SessionSnapshot, SessionEvent.focusChanged──▶ plugin server (server/board.ts)
                                                                                       BoardStore: units + revision + focus map
Paseo app (desktop + mobile) ◀── plugin RPC long-poll fspec.board.watch({ cwd, sinceRevision }) ──┘
                                 fspec.board.details / fspec.board.move
```

- **Board store (server)**: subscribe to the shared daemon socket; on each `workUnitsUpdate` replace units and bump
  `revision`; maintain `sessionId → workUnitId` from snapshot + focusChanged (bump revision on change).
  `watch` resolves immediately when `sinceRevision !== revision`, else waits up to ~20 s, then returns current state.
  Workspace guard: cwd must be inside the daemon workspace (reuse FSPEC-015).
- **Panel (client)**: desktop/wide — horizontal columns, each a vertical list; mobile/compact — column picker with counts
  + single vertical list; details as a side pane (wide) or `Modal` bottom sheet (compact). Card: `ID [pts]`, title, 🟢,
  ⏩ latest. Footer/summary points line. Search filter (TUI `/`).
- **Details**: `get_work_unit_details` (idx 123) → render the TUI document sections.
- **Actions**: move up/down (idx 18/19, disabled in `done`); open in agent (existing focused Paseo agent, else create an
  fspec agent with `setWorkUnitFocus`).

### Repo changes needed
- `package.json` `files` + `index.client.tsx`, `client/`, `shared/`; devDeps `react`, `react-native`, `@types/react`,
  `@tanstack/react-query`; `tsconfig.json` `jsx: "react-jsx"`, include `**/*.tsx`.
- `paseo-plugin.json` `requirements.paseo` → `>=0.13.0`.
- `server/wire.ts`: add `moveWorkUnitUp` 18, `moveWorkUnitDown` 19, `getWorkUnitDetails` 123
  (and update `docs/fspec-wire-protocol.md` — written against `626eee1e`, indices 0–122).
