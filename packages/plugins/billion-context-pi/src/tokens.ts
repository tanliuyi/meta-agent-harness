import { defaultCountTokens, type CompressionCore, type CompressionState, type Config, type CoreMessage } from "acp-kernel";
import type { SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { countImageBlocks } from "./messages.ts";

type AgentMessage = SessionMessageEntry["message"];

export function collectCoveredMessageIds(state: { blocks: { active: boolean; effectiveMessageIds: string[] }[] }): Set<string> {
  const ids = new Set<string>();
  for (const block of state.blocks) {
    if (!block.active) continue;
    for (const id of block.effectiveMessageIds) ids.add(id);
  }
  return ids;
}

export const IMAGE_TOKEN_COST = 1600;

export function modelSupportsImages(model: unknown): boolean {
  const input = (model as { input?: string[] } | null | undefined)?.input;
  return Array.isArray(input) && input.includes("image");
}

export function collectImageTokens(entries: { id: string; type?: string; message?: AgentMessage }[], visionCapable: boolean): Map<string, number> {
  const out = new Map<string, number>();
  if (!visionCapable) return out;
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const count = countImageBlocks((entry.message as { content?: unknown } | undefined)?.content);
    if (count > 0) out.set(entry.id, count * IMAGE_TOKEN_COST);
  }
  return out;
}

export function estimateTokens(messages: CoreMessage[], coveredIds?: Set<string>, imageTokensById?: Map<string, number>): number {
  let tokens = 0;
  for (const message of messages) {
    if (message.toolName === "compress") continue;
    if (coveredIds?.has(message.id)) continue;
    tokens += defaultCountTokens(message.text ?? "");
    tokens += message.thinkingTokens ?? 0;
    tokens += imageTokensById?.get(message.id) ?? 0;
  }
  return tokens;
}

export function sentViewTokenCount(
  core: CompressionCore,
  messages: CoreMessage[],
  state: CompressionState,
  config: Config,
  prelim: number,
  imageTokensById?: Map<string, number>,
  systemPromptTokens = 0,
): { viewTokens: number; drifted: boolean } {
  const cap = config.modelContextLimit > 0 ? Math.max(0, Math.floor(config.truncate.threshold * config.modelContextLimit) - 1) : Number.MAX_SAFE_INTEGER;
  const probe = core.processTurn({ messages, state: structuredClone(state), config, tokenCount: Math.min(prelim, cap) });
  const viewTokens = estimateTokens(probe.messages, collectCoveredMessageIds(probe.state), imageTokensById) + systemPromptTokens;
  return { viewTokens, drifted: Math.abs(viewTokens - prelim) > Math.max(1000, 0.1 * prelim) };
}

export function adjustedTokenCount(
  core: CompressionCore,
  messages: CoreMessage[],
  state: CompressionState,
  config: Config,
  prelim: number,
  imageTokensById?: Map<string, number>,
  systemPromptTokens = 0,
): number {
  if (!state.blocks.some((block) => block.active && block.effectiveMessageIds.length > 0)) return prelim;
  const view = sentViewTokenCount(core, messages, state, config, prelim, imageTokensById, systemPromptTokens);
  return view.drifted ? view.viewTokens : prelim;
}

export function lastUserMessageId(entries: { id: string; message?: { role?: string } }[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.message?.role === "user") return entry.id;
  }
  return undefined;
}
