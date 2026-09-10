import { isCompressSuccessText } from "./compress-tool.ts";
import { extractText } from "./messages.ts";

type UsageLike = {
  totalTokens?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
} | null | undefined;

type AnchorEntry = {
  type: string;
  message?: {
    role?: string;
    stopReason?: string;
    usage?: UsageLike;
    toolName?: string;
    toolCallId?: string;
    isError?: boolean;
    content?: unknown;
  };
};

function validAnchorUsage(usage: UsageLike): boolean {
  if (!usage) return false;
  const total = (usage.totalTokens ?? 0) || (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  return total > 0;
}

export function usageAnchorPredatesCompression(entries: AnchorEntry[]): boolean {
  let lastUsageIdx = -1;
  let lastCompressIdx = -1;
  for (let i = 0; i < entries.length; i++) {
    const message = entries[i]!.message;
    if (!message) continue;
    if (message.role === "assistant" && message.stopReason !== "aborted" && message.stopReason !== "error" && validAnchorUsage(message.usage)) {
      lastUsageIdx = i;
    } else if (
      message.role === "toolResult" &&
      message.toolName === "compress" &&
      message.toolCallId !== undefined &&
      message.isError !== true &&
      isCompressSuccessText(extractText(message.content))
    ) {
      lastCompressIdx = i;
    }
  }
  return lastCompressIdx > lastUsageIdx;
}
