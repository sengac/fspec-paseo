import type { PluginClientContext } from "@getpaseo/plugin/client";
import { BoardPanel } from "./client/board-panel.js";
import { registerBoard, registerBoardButtons, registerSettings } from "./client/register.js";
import { SettingsScreen } from "./client/settings-screen.js";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    registerBoard(client, BoardPanel),
    registerBoardButtons(client),
    registerSettings(client, SettingsScreen),
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
