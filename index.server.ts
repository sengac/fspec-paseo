import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createBoardFeed } from "./server/board.js";
import { createFspecProvider } from "./server/provider.js";
import { createSettingsFeed } from "./server/settings.js";
import { boardAvailableRpc, boardDetailsRpc, moveBoardRpc, watchBoardRpc } from "./shared/board.js";
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
  settingsListRpc,
  testProviderRpc,
} from "./shared/settings.js";

export default function contribute(
  server: Pick<PluginServerContext, "registerProvider" | "handle">,
) {
  server.registerProvider(createFspecProvider());
  const board = createBoardFeed();
  server.handle(watchBoardRpc, (input) => board.watch(input));
  server.handle(boardDetailsRpc, (input) => board.details(input));
  server.handle(moveBoardRpc, (input) => board.move(input));
  server.handle(boardAvailableRpc, (input) => board.available(input));
  const settings = createSettingsFeed();
  server.handle(settingsListRpc, (input) => settings.list(input));
  server.handle(saveCredentialsRpc, (input) => settings.saveCredentials(input));
  server.handle(removeCredentialsRpc, (input) => settings.removeCredentials(input));
  server.handle(testProviderRpc, (input) => settings.test(input));
  server.handle(refreshModelsRpc, (input) => settings.refreshModels(input));
  server.handle(providerSettingsRpc, (input) => settings.providerSettings(input));
  server.handle(saveSettingsRpc, (input) => settings.saveSettings(input));
  server.handle(saveProfileRpc, (input) => settings.saveProfile(input));
  server.handle(deleteProfileRpc, (input) => settings.deleteProfile(input));
  server.handle(setDefaultModelRpc, (input) => settings.setDefaultModel(input));
  server.handle(saveCustomModelRpc, (input) => settings.saveCustomModel(input));
  server.handle(deleteCustomModelRpc, (input) => settings.deleteCustomModel(input));
  server.handle(oauthStartRpc, (input) => settings.oauthStart(input));
  server.handle(oauthCompleteRpc, (input) => settings.oauthComplete(input));
  server.handle(oauthStatusRpc, (input) => settings.oauthStatus(input));
  server.handle(oauthCancelRpc, (input) => settings.oauthCancel(input));
  server.handle(oauthLogoutRpc, (input) => settings.oauthLogout(input));
  return () => {
    void board.close();
    void settings.close();
  };
}
