import type { PluginClientContext, PluginSurfaceProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import type { ComponentType } from "react";
import { boardAvailableRpc } from "../shared/board.js";
import { type WorkspaceEvent, syncBoardButtons } from "./board-buttons.js";

export const BOARD_PANEL_ID = "fspec-board";

/** A small Kanban glyph; `currentColor` follows the surface's icon color. */
const boardIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="4" width="18" height="16" rx="2" />
  <path d="M9 4v16M15 4v16M5.5 8h2M11.5 8h2M11.5 11h2M17.5 8h2" />
</svg>`;

/**
 * The board's client contributions (FSPEC-035): the workspace panel, a
 * Command Center item and /board, both opening the panel. The panel
 * component is passed in so this stays free of React Native imports.
 */
export function registerBoard(
  client: Pick<PluginClientContext, "addWorkspacePanel" | "addCommandCenterItem" | "addSlashCommand">,
  Panel: ComponentType<PluginWorkspacePanelProps>,
): () => void {
  const cleanups = [
    client.addWorkspacePanel({
      id: BOARD_PANEL_ID,
      title: "fspec board",
      icon: { svg: boardIcon },
      locations: ["workspace"],
      Component: Panel,
    }),
    client.addCommandCenterItem({
      id: "open-fspec-board",
      title: "Open fspec board",
      icon: { svg: boardIcon },
      keywords: ["fspec", "kanban", "board", "work units"],
      context: "workspace",
      onSelect({ openPanel }) {
        openPanel(BOARD_PANEL_ID);
      },
    }),
    client.addSlashCommand({
      name: "board",
      description: "Open the fspec board",
      argumentHint: "",
      context: "workspace",
      onSubmit({ openPanel }) {
        openPanel(BOARD_PANEL_ID);
      },
    }),
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

export const SETTINGS_SCREEN_ID = "fspec-providers";

/** A key on a provider card; `currentColor` follows the surface's icon color. */
const providersIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="7.5" cy="15.5" r="4.5" />
  <path d="m10.7 12.3 8.8-8.8M16 7l3 3M14 9l2 2" />
</svg>`;

/**
 * The provider settings contributions (FSPEC-043): the screen under
 * Settings → Plugins, a Command Center item and /fspec-providers.
 */
export function registerSettings(
  client: Pick<PluginClientContext, "addSettingsScreen" | "addCommandCenterItem" | "addSlashCommand">,
  Screen: ComponentType<PluginSurfaceProps>,
): () => void {
  const cleanups = [
    client.addSettingsScreen({
      id: SETTINGS_SCREEN_ID,
      title: "fspec providers",
      icon: { svg: providersIcon },
      Component: Screen,
    }),
    client.addCommandCenterItem({
      id: "open-fspec-providers",
      title: "fspec providers",
      icon: { svg: providersIcon },
      keywords: ["fspec", "providers", "models", "api key", "credentials"],
      context: "global",
      onSelect({ openSettings }) {
        openSettings(SETTINGS_SCREEN_ID);
      },
    }),
    client.addSlashCommand({
      name: "fspec-providers",
      description: "Manage fspec's model providers",
      argumentHint: "",
      context: "workspace",
      onSubmit({ openSettings }) {
        openSettings(SETTINGS_SCREEN_ID);
      },
    }),
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

/**
 * Phones list no plugin panels in their tab menu, so each workspace the fspec
 * daemon serves also gets an 'fspec board' header button (FSPEC-040).
 */
export function registerBoardButtons(
  client: Pick<PluginClientContext, "paseo" | "rpc" | "addHeaderButton" | "openPanel">,
): () => void {
  return syncBoardButtons(
    {
      watchWorkspaces(onEvent: (event: WorkspaceEvent) => void) {
        let released = false;
        let release: (() => Promise<void>) | null = null;
        void client.paseo.workspaces
          .list({ subscribe: {} })
          .then(({ subscription }) => {
            release = () => subscription.release();
            if (released) return release();
            subscription.subscribe({
              snapshot: ({ entries }) => onEvent({ kind: "snapshot", entries }),
              update: (message) => {
                if (message.type !== "workspace_update") return;
                const update = message.payload;
                if (update.kind === "remove") onEvent({ kind: "remove", id: update.id });
                else onEvent({ kind: "upsert", workspace: update.workspace });
              },
            });
            return undefined;
          })
          .catch((error: unknown) => {
            if (!released) console.warn("[fspec board] workspace observation failed", error);
          });
        return () => {
          released = true;
          void release?.().catch((error: unknown) => console.error("[fspec board] releasing the workspace observation failed", error));
        };
      },
      available: (cwd) => client.rpc(boardAvailableRpc, { cwd }),
      addHeaderButton: (contribution) => client.addHeaderButton(contribution),
      openPanel: (workspaceId) => client.openPanel(BOARD_PANEL_ID, { workspaceId }),
    },
    { svg: boardIcon },
  );
}
