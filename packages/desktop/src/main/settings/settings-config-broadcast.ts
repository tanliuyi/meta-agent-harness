import { BrowserWindow } from "electron";
import { CHANNELS } from "../../shared/channels.ts";
import type { SaveSettingsConfigInput, SaveSettingsConfigResult } from "../../shared/settings-config-contracts.ts";
import type { SettingsConfigService } from "./settings-config-service.ts";

/** Both IPC and runtime controls publish only after the validated atomic save succeeds. */
export async function saveSettingsAndBroadcast(
  service: SettingsConfigService,
  input: SaveSettingsConfigInput,
): Promise<SaveSettingsConfigResult> {
  const result = await service.saveConfig(input);
  if (result.status === "saved") {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
      try {
        window.webContents.send(CHANNELS.settingsChanged);
      } catch {
        /* A window may close between the check and send. The committed save remains valid. */
      }
    }
  }
  return result;
}
