import type { ExtensionCommandContext, RegisteredCommand } from "@earendil-works/pi-coding-agent";
import type { AcpRuntime } from "./runtime.ts";
import { defaultCountTokens, parseBlockIdArg, collectBlockContent, formatRanges, viableRanges } from "acp-kernel";
import { buildAcpSystemPrompt } from "./system-prompt.ts";
import { collectCoveredMessageIds, estimateTokens, collectImageTokens, modelSupportsImages, adjustedTokenCount } from "./tokens.ts";
import { usageAnchorPredatesCompression } from "./floor-stale.ts";
import { applyOutputHeadroom, resolveOutputHeadroomCap } from "./overflow-selfheal.ts";

declare const CURRENT_VERSION: string;
type CommandOptions = Omit<RegisteredCommand, "name" | "sourceInfo">;

export function makeCommands(runtime: AcpRuntime): Array<{ name: string; options: CommandOptions }> {
  return [
    {
      name: "acp",
      options: {
        description: "Show ACP context usage, token breakdown, and compression status.",
        handler: async (_args, ctx) => ctx.ui.notify(await statusReport(runtime, ctx)),
      },
    },
    {
      name: "acp-status",
      options: {
        description: "Detailed ACP status (block tiers, token breakdown).",
        handler: async (_args, ctx) => ctx.ui.notify(await statusReport(runtime, ctx)),
      },
    },
    {
      name: "acp-decompress",
      options: {
        description: "Restore a compressed block's content (shown here, block stays folded). Usage: /acp-decompress b3",
        handler: async (args, ctx) => {
          const blockId = parseBlockIdArg(args);
          if (!blockId) {
            ctx.ui.notify('Usage: /acp-decompress <blockId> (e.g. "b3")');
            return;
          }
          const { state, coreMessages } = await runtime.stateFor(ctx);
          const block = state.blocks.find((candidate) => candidate.blockId === blockId);
          if (!block) {
            ctx.ui.notify(`Block ${blockId} not found.`);
            return;
          }
          const { text, count } = collectBlockContent(state, block, coreMessages, { full: false });
          if (count === 0) {
            ctx.ui.notify(`Block ${blockId} has no restorable message content.`);
            return;
          }
          ctx.ui.notify(`Block ${blockId} (${count} items):\n\n${text}`);
        },
      },
    },
    {
      name: "acp-search",
      options: {
        description: "Search compressed block summaries. Usage: /acp-search auth token",
        handler: async (args, ctx) => {
          const query = args.trim();
          if (!query) {
            ctx.ui.notify("Usage: /acp-search <query>");
            return;
          }
          const { state } = await runtime.stateFor(ctx);
          const hits = runtime.core.search(query, state);
          if (hits.length === 0) {
            ctx.ui.notify("No matching blocks.");
            return;
          }
          ctx.ui.notify(hits.map((block) => `[${block.blockId}] (t${block.tier}) ${block.topic ?? ""}`.trim()).join("\n"));
        },
      },
    },
  ];
}

function fmtTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}

function bar(value: number, total: number, width = 20): string {
  if (total <= 0) return "";
  const filled = Math.max(0, Math.min(width, Math.round((value / total) * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

async function statusReport(runtime: AcpRuntime, ctx: ExtensionCommandContext): Promise<string> {
  const { state, coreMessages, entries } = await runtime.stateFor(ctx);
  const config = applyOutputHeadroom(runtime.configFor(ctx), ctx.model, resolveOutputHeadroomCap(runtime.adapter.outputHeadroomMaxPct));
  const realUsage = ctx.getContextUsage?.();
  const systemPromptText = ctx.getSystemPrompt?.() ?? buildAcpSystemPrompt(runtime.prompts);
  const systemPromptTokens = defaultCountTokens(systemPromptText);
  const imageTokens = collectImageTokens(entries, modelSupportsImages(ctx.model));
  const sentTokens = estimateTokens(coreMessages, collectCoveredMessageIds(state), imageTokens) + systemPromptTokens;
  const viewSentTokens = adjustedTokenCount(runtime.core, coreMessages, state, config, sentTokens, imageTokens, systemPromptTokens);
  const anchorStale = usageAnchorPredatesCompression(entries);
  const tokenCount = anchorStale ? viewSentTokens : Math.max(viewSentTokens, realUsage?.tokens ?? 0);
  const turn = runtime.core.processTurn({ messages: coreMessages, state, config, tokenCount });
  const nudge = turn.nudge;
  const breakdown = nudge?.contextBreakdown;
  const limit = config.modelContextLimit;
  const classified = breakdown ? breakdown.system + breakdown.tool + breakdown.summaries + breakdown.code + breakdown.text : 0;
  const framework = breakdown ? Math.max(0, tokenCount - classified - systemPromptTokens) : 0;
  const activeBlocks = state.blocks.filter((block) => block.active);
  const lines: string[] = [];
  const versionStr = typeof CURRENT_VERSION !== "undefined" && CURRENT_VERSION ? `billion-context-pi@${CURRENT_VERSION}` : "";
  lines.push("╭─────────────────────────────────────────────╮", "│           ACP Context Analysis              │", "╰─────────────────────────────────────────────╯");
  if (versionStr) lines.push(versionStr);
  lines.push("", `Context: ${limit > 0 ? Math.round((tokenCount / limit) * 100) : 0}% (${fmtTokens(tokenCount)} / ${fmtTokens(limit)})`);
  const growth = breakdown?.growth;
  if (breakdown && tokenCount > 0 && growth !== null && growth !== undefined && growth > 0) lines.push(`Growth: +${fmtTokens(growth)} since last nudge`);
  if (breakdown && tokenCount > 0) {
    lines.push("", "Token Breakdown:");
    const categories: Array<{ label: string; value: number }> = [
      { label: "Tool", value: breakdown.tool },
      { label: "SysPrompt", value: systemPromptTokens },
      { label: "Framework", value: framework },
      { label: "Text", value: breakdown.text },
      { label: "Code", value: breakdown.code },
      { label: "Summaries", value: breakdown.summaries },
    ];
    for (const category of categories) {
      if (category.value <= 0) continue;
      const percentage = Math.round((category.value / tokenCount) * 100);
      lines.push(`  ${category.label.padEnd(10)} ${bar(category.value, tokenCount)} ${String(percentage).padStart(3)}%  ${fmtTokens(category.value)}`);
    }
  }
  if (realUsage?.tokens && realUsage.tokens > 0) {
    lines.push(`Provider usage: ${fmtTokens(realUsage.tokens)}${realUsage.percent != null ? ` (${Math.round(realUsage.percent)}%)` : ""}`);
  }
  if (nudge) {
    const tierInfo = nudge.tier ? ` [T${nudge.tier} distillation]` : "";
    lines.push("", nudge.shouldInject ? `Nudge: ACTIVE${tierInfo} — ${nudge.reason}` : `Nudge: idle — ${nudge.reason}`);
  }
  const ranges = viableRanges(nudge?.compressibleRanges ?? []);
  const protectedRanges = nudge?.protectedRanges ?? [];
  if (ranges.length > 0 || protectedRanges.length > 0) lines.push("", formatRanges(ranges, protectedRanges));
  if (activeBlocks.length > 0) {
    lines.push("", `Blocks: ${activeBlocks.length} active / ${state.blocks.length} total (${fmtTokens(state.stats.tokensCompressed)} tokens compressed)`);
    for (const block of activeBlocks) {
      const topic = block.topic ? `: ${block.topic}` : "";
      const summaryTokens = defaultCountTokens(block.summary || "");
      const originalTokens = block.compressedTokens > 0 ? block.compressedTokens : summaryTokens;
      lines.push(`  [${block.blockId}] T${block.tier} ${fmtTokens(originalTokens)}\u2192${fmtTokens(summaryTokens)}${topic}`);
    }
  } else if (state.blocks.length > 0) {
    lines.push("", `Blocks: 0 active / ${state.blocks.length} total (${fmtTokens(state.stats.tokensCompressed)} tokens compressed)`);
  } else {
    lines.push("", "Blocks: none (nothing compressed yet)");
  }
  lines.push("", "Tag visibility: tags injected to LLM only (deep copy), not persisted in session, not shown in terminal.");
  return lines.join("\n");
}
