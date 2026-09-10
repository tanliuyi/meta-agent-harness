import { promises as fs } from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import type { Prompts } from "acp-kernel";
import type { AdapterConfig, CompressConfig, RepetitionGuardConfig } from "./config.ts";
import type { DegenerationGuardConfig } from "./degeneration.ts";
import type { ThrottleRetryConfig } from "./throttle-retry.ts";
import { debug, logWarn } from "./log.ts";

export interface UserAcpConfig {
  enabled?: boolean;
  debug?: boolean;
  autoUpdate?: boolean;
  modelContextLimit?: number;
  toolBashDefaultTimeout?: number;
  toolOutputMaxBytes?: number;
  compress?: CompressConfig;
  outputHeadroomMaxPct?: number | string;
  throttleRetry?: boolean | ThrottleRetryConfig;
  repetitionGuard?: boolean | RepetitionGuardConfig;
  degenerationGuard?: boolean | DegenerationGuardConfig;
  prompts?: Partial<Prompts>;
  acknowledgePromptsRisk?: boolean;
}

export async function loadUserConfig(cwd: string): Promise<UserAcpConfig> {
  const merged: UserAcpConfig = {};
  for (const base of [path.join(homedir(), CONFIG_DIR_NAME), path.join(cwd, CONFIG_DIR_NAME)]) {
    const file = path.join(base, "acp.json");
    try {
      const raw = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        Object.assign(merged, pickKnown(parsed));
        debug.event("config-loaded", { file });
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") logWarn("config", { event: "load-failed", file, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return merged;
}

const KNOWN = new Set([
  "enabled",
  "debug",
  "autoUpdate",
  "modelContextLimit",
  "toolBashDefaultTimeout",
  "toolOutputMaxBytes",
  "compress",
  "outputHeadroomMaxPct",
  "throttleRetry",
  "repetitionGuard",
  "degenerationGuard",
  "prompts",
  "acknowledgePromptsRisk",
]);

function pickKnown(parsed: Record<string, unknown>): UserAcpConfig {
  const out: UserAcpConfig = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (KNOWN.has(key)) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

export type UserAcpConfigKey = keyof UserAcpConfig;

export function applyUserConfig(
  adapter: AdapterConfig,
  user: UserAcpConfig,
  protectedKeys: ReadonlySet<UserAcpConfigKey> = new Set(),
): AdapterConfig {
  const next: AdapterConfig = {
    ...adapter,
    ...user,
    debug: protectedKeys.has("debug") ? adapter.debug : user.debug ?? adapter.debug,
    modelContextLimit: protectedKeys.has("modelContextLimit") ? adapter.modelContextLimit : user.modelContextLimit ?? adapter.modelContextLimit,
    toolBashDefaultTimeout: protectedKeys.has("toolBashDefaultTimeout") ? adapter.toolBashDefaultTimeout : user.toolBashDefaultTimeout ?? adapter.toolBashDefaultTimeout,
    toolOutputMaxBytes: protectedKeys.has("toolOutputMaxBytes") ? adapter.toolOutputMaxBytes : user.toolOutputMaxBytes ?? adapter.toolOutputMaxBytes,
    autoUpdate: adapter.autoUpdate === false ? false : user.autoUpdate ?? adapter.autoUpdate,
    coreOverrides: adapter.coreOverrides,
    protectedTools: adapter.protectedTools,
    preserveRecentMessages: adapter.preserveRecentMessages,
  };
  for (const key of ["enabled", "compress", "outputHeadroomMaxPct", "throttleRetry", "repetitionGuard", "degenerationGuard", "prompts", "acknowledgePromptsRisk"] as const) {
    if (protectedKeys.has(key)) (next as Record<string, unknown>)[key] = adapter[key];
  }
  return next;
}
