import type { SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { logWarn } from "./log.ts";

type AgentMessage = SessionMessageEntry["message"];

export interface CompressReasoningConfig {
  enabled?: boolean;
  drop?: boolean;
  threshold?: number;
}

export const DEFAULT_COMPRESS_REASONING: Required<CompressReasoningConfig> = {
  enabled: true,
  drop: true,
  threshold: 2048,
};

export function resolveReasoningDrop(cfg?: CompressReasoningConfig): Required<CompressReasoningConfig> {
  let threshold = DEFAULT_COMPRESS_REASONING.threshold;
  if (cfg?.threshold !== undefined) {
    const t = cfg.threshold;
    if (typeof t === "number" && Number.isFinite(t) && t >= 0) threshold = Math.floor(t);
    else logWarn("config", { event: "compress-reasoning-invalid", field: "threshold", value: t, fallback: threshold });
  }
  return { enabled: cfg?.enabled !== false, drop: cfg?.drop !== false, threshold };
}

function isThinking(part: unknown): part is { type: "thinking"; thinking: string } {
  const p = part as { type?: string; thinking?: unknown };
  return p?.type === "thinking" && typeof p.thinking === "string";
}

function hasCompressCall(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((p) => {
    const b = p as { type?: string; name?: string };
    return b?.type === "toolCall" && b.name === "compress";
  });
}

function compressCallIds(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((p) => {
      const b = p as { type?: string; name?: string };
      return b?.type === "toolCall" && b.name === "compress";
    })
    .map((p) => (p as { id?: unknown }).id)
    .filter((id): id is string => typeof id === "string");
}

function resultIndexByCallId(messages: AgentMessage[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as { role?: string; toolCallId?: unknown };
    if (msg?.role !== "toolResult" || typeof msg.toolCallId !== "string") continue;
    if (!map.has(msg.toolCallId)) map.set(msg.toolCallId, i);
  }
  return map;
}

function reasoningLength(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  return content.reduce((n, p) => (isThinking(p) ? n + p.thinking.length : n), 0);
}

export function countThinkingChars(messages: AgentMessage[]): number {
  return messages.reduce((n, m) => n + reasoningLength((m as { content?: unknown }).content), 0);
}

export function dropCompressReasoning(messages: AgentMessage[], cfg?: CompressReasoningConfig): AgentMessage[] {
  const { enabled, drop, threshold } = resolveReasoningDrop(cfg);
  if (!enabled || !drop || messages.length === 0) return messages;
  try {
    const last = messages.length - 1;
    const resultAt = resultIndexByCallId(messages);
    let changed = false;
    const out = messages.slice();
    for (let i = 0; i <= last; i++) {
      const msg = messages[i] as { role?: string; content?: unknown };
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
      if (!hasCompressCall(msg.content)) continue;
      const ids = compressCallIds(msg.content);
      const closed = ids.length > 0 && ids.every((id) => {
        const resultIndex = resultAt.get(id);
        return resultIndex !== undefined && resultIndex > i && resultIndex < last;
      });
      if (!closed || reasoningLength(msg.content) <= threshold) continue;
      out[i] = { ...(msg as object), content: msg.content.filter((p) => !isThinking(p)) } as AgentMessage;
      changed = true;
    }
    return changed ? out : messages;
  } catch {
    return messages;
  }
}
