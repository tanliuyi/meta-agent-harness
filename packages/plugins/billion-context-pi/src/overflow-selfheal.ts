import { parsePercent } from "./config.ts";

export const OVERFLOW_MARKER =
  /prompt is too long|prompt_too_long|prompt_is_too_long|prompt too long; exceeded (?:max )?context length|request_too_large|exceeds the context window|exceeds the (maximum |model['’]s )?limit|maximum context length|maximum context size|max context length|context length exceeded|context[_ ]length[_ ]exceeded|exceeded model token limit|input token count.*exceeds|reduce the length of the messages|token limit exceeded|input is too long for requested model|maximum prompt length is|exceeds the maximum allowed input length|is longer than the model['’]?s context length|exceeds the available context size|greater than the context length|context window exceeds limit|too large for model with \d+ maximum context length|but the configured context size is|model_context_window_exceeded|range of input length should be/i;

export interface OverflowInfo {
  isOverflow: boolean;
  window?: number;
  message: string;
}

export function inspectOverflowMessage(haystack: string | undefined | null): OverflowInfo {
  const body = (haystack ?? "").trim();
  if (!body || !OVERFLOW_MARKER.test(body)) return { isOverflow: false, message: body };
  return { isOverflow: true, window: parseOverflowWindow(body), message: body };
}

function parseOverflowWindow(text: string): number | undefined {
  let m = />\s*(\d[\d,]*)\s*(?:tokens?)?\s*maximum/i.exec(text);
  if (m) return toTokenNumber(m[1]);
  m = /maximum context length is (\d[\d,]*)/i.exec(text);
  if (m) return toTokenNumber(m[1]);
  m = /maximum context size (?:is|of) (\d[\d,]*)/i.exec(text);
  if (m) return toTokenNumber(m[1]);
  m = /(?:maximum|limit) of (\d[\d,]*)\s*(?:input\s+)?tokens/i.exec(text);
  if (m) return toTokenNumber(m[1]);
  return undefined;
}

function toTokenNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 1000 ? n : undefined;
}

export const DEFAULT_OUTPUT_HEADROOM_MAX_PCT = 0.25;

export function resolveOutputHeadroomCap(value: number | string | undefined): number {
  return value === undefined ? DEFAULT_OUTPUT_HEADROOM_MAX_PCT : parsePercent(value);
}

export function reserveOutputHeadroom(window: number, maxOutput: number, capPct: number = 1): number {
  if (!Number.isFinite(window) || window <= 0 || !Number.isFinite(maxOutput) || maxOutput <= 0 || maxOutput >= window) return window;
  const cap = Number.isFinite(capPct) ? Math.max(0, Math.min(capPct, 1)) : 1;
  const reserved = Math.min(maxOutput, cap * window);
  return reserved > 0 ? window - reserved : window;
}

export function shouldReserveOutputHeadroom(api: string | undefined): boolean {
  return api !== "anthropic-messages";
}

export function applyOutputHeadroom<T extends { modelContextLimit: number }>(
  config: T,
  model: { maxTokens?: number; api?: string } | undefined,
  capPct: number = 1,
): T {
  if (shouldReserveOutputHeadroom(model?.api)) {
    const reserved = reserveOutputHeadroom(config.modelContextLimit, model?.maxTokens ?? 0, capPct);
    if (reserved !== config.modelContextLimit) return { ...config, modelContextLimit: reserved };
  }
  return config;
}

export class OverflowEpisode {
  private learned = new Map<string, number>();
  learnedWindowFor(modelId: string): number | null {
    return this.learned.get(modelId) ?? null;
  }
  setLearnedWindow(modelId: string, window: number): void {
    this.learned.set(modelId, window);
  }
  armed = false;
  reset(): void {
    this.learned.clear();
    this.armed = false;
  }
}
