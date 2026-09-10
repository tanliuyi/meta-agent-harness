import { defaultConfig, type Config, type Prompts } from "acp-kernel";
import type { CompressReasoningConfig } from "./reasoning-drop.ts";
import type { DegenerationGuardConfig } from "./degeneration.ts";
import type { ThrottleRetryConfig } from "./throttle-retry.ts";

export interface CompressSettings {
  maxContextLimit?: number | string;
  emergencyThresholdPercent?: number | string;
  nudgeGrowthTokens?: number;
  minPressureBenefitTokens?: number;
  reasoning?: CompressReasoningConfig;
}

export interface ProviderCompress extends CompressSettings {
  models?: Record<string, CompressSettings>;
}

export interface CompressConfig extends CompressSettings {
  providers?: Record<string, ProviderCompress>;
}

export interface RepetitionGuardConfig {
  enabled?: boolean;
  warn?: number;
  abort?: number;
}

export interface AdapterConfig {
  enabled?: boolean;
  modelContextLimit?: number;
  protectedTools?: string[];
  preserveRecentMessages?: number;
  autoUpdate?: boolean;
  childExtensionPath?: string;
  debug?: boolean;
  toolBashDefaultTimeout?: number;
  toolOutputMaxBytes?: number;
  compress?: CompressConfig;
  throttleRetry?: boolean | ThrottleRetryConfig;
  outputHeadroomMaxPct?: number | string;
  repetitionGuard?: boolean | RepetitionGuardConfig;
  degenerationGuard?: boolean | DegenerationGuardConfig;
  prompts?: Partial<Prompts>;
  acknowledgePromptsRisk?: boolean;
  coreOverrides?: Partial<Config>;
}

export const DEFAULT_TOOL_BASH_TIMEOUT = 60;
export const DEFAULT_TOOL_OUTPUT_MAX_BYTES = 200_000;
export const REPETITION_GUARD_DEFAULTS = { warn: 3, abort: 5 } as const;

export function resolveRepetitionGuard(adapter: AdapterConfig): { enabled: boolean; warn: number; abort: number } {
  const guard = adapter.repetitionGuard;
  if (guard === false) return { enabled: false, ...REPETITION_GUARD_DEFAULTS };
  if (typeof guard === "object" && guard !== null) {
    const warn = positiveInt(guard.warn, REPETITION_GUARD_DEFAULTS.warn);
    const abort = Math.max(positiveInt(guard.abort, REPETITION_GUARD_DEFAULTS.abort), warn + 1);
    return { enabled: guard.enabled !== false, warn, abort };
  }
  return { enabled: true, ...REPETITION_GUARD_DEFAULTS };
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

export function mergeCompress(
  global?: CompressSettings,
  provider?: CompressSettings,
  model?: CompressSettings,
): CompressSettings {
  return {
    maxContextLimit: model?.maxContextLimit ?? provider?.maxContextLimit ?? global?.maxContextLimit,
    emergencyThresholdPercent: model?.emergencyThresholdPercent ?? provider?.emergencyThresholdPercent ?? global?.emergencyThresholdPercent,
    nudgeGrowthTokens: model?.nudgeGrowthTokens ?? provider?.nudgeGrowthTokens ?? global?.nudgeGrowthTokens,
    minPressureBenefitTokens: model?.minPressureBenefitTokens ?? provider?.minPressureBenefitTokens ?? global?.minPressureBenefitTokens,
    reasoning: {
      enabled: model?.reasoning?.enabled ?? provider?.reasoning?.enabled ?? global?.reasoning?.enabled,
      drop: model?.reasoning?.drop ?? provider?.reasoning?.drop ?? global?.reasoning?.drop,
      threshold: model?.reasoning?.threshold ?? provider?.reasoning?.threshold ?? global?.reasoning?.threshold,
    },
  };
}

export function resolveCompress(
  compress: CompressConfig | undefined,
  provider: string | undefined,
  modelId: string | undefined,
): CompressSettings {
  if (!compress) return {};
  const providerConfig = provider ? compress.providers?.[provider] : undefined;
  const modelConfig = providerConfig && modelId ? providerConfig.models?.[modelId] : undefined;
  return mergeCompress(compress, providerConfig, modelConfig);
}

export function resolveConfig(
  adapter: AdapterConfig,
  liveContextLimit: number,
  provider?: string,
  modelId?: string,
): Config {
  const envLimit = process.env.ACP_MODEL_CONTEXT_LIMIT;
  const envLimitNum = envLimit ? Number(envLimit) : NaN;
  const fallbackLimit = 150_000;
  const limit =
    !Number.isNaN(envLimitNum) && envLimitNum > 0
      ? envLimitNum
      : adapter.modelContextLimit && adapter.modelContextLimit > 0
        ? adapter.modelContextLimit
        : liveContextLimit > 0
          ? liveContextLimit
          : fallbackLimit;

  const config = defaultConfig(limit, {
    protectedTools: adapter.protectedTools ?? [],
    preserveRecentMessages: adapter.preserveRecentMessages ?? 5,
    ...adapter.coreOverrides,
  });
  const compression = resolveCompress(adapter.compress, provider, modelId);
  if (compression.maxContextLimit !== undefined) config.nudge.maxContextLimitPct = parsePercent(compression.maxContextLimit);
  if (compression.emergencyThresholdPercent !== undefined) {
    const pct = parsePercent(compression.emergencyThresholdPercent);
    config.nudge.emergencyThresholdPct = pct;
    config.truncate.threshold = pct;
  }
  if (compression.nudgeGrowthTokens !== undefined) {
    config.nudge.growthFloor = compression.nudgeGrowthTokens;
    config.nudge.growthCap = compression.nudgeGrowthTokens;
  }
  if (compression.minPressureBenefitTokens !== undefined) config.nudge.minPressureBenefitTokens = compression.minPressureBenefitTokens;
  return config;
}

export function parsePercent(value: number | string): number {
  if (typeof value === "number") return value;
  const text = value.trim();
  if (text.endsWith("%")) return Number(text.slice(0, -1)) / 100;
  return Number(text);
}
