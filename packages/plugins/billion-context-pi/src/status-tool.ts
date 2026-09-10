import { Type, type Static } from "typebox";
import type { AgentToolResult, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AcpRuntime } from "./runtime.ts";
import { buildStatusReport, defaultCountTokens, formatRanges, viableRanges } from "acp-kernel";
import { estimateTokens, collectCoveredMessageIds, collectImageTokens, modelSupportsImages, adjustedTokenCount } from "./tokens.ts";
import { usageAnchorPredatesCompression } from "./floor-stale.ts";
import { applyOutputHeadroom, resolveOutputHeadroomCap } from "./overflow-selfheal.ts";
import { buildAcpSystemPrompt } from "./system-prompt.ts";
import { logThrow } from "./log.ts";

const StatusParams = Type.Object({
  scope: Type.Optional(Type.Union([Type.Literal("compressed"), Type.Literal("uncompressed")], { description: '"compressed" = drill into blocks; "uncompressed" = show visible messages/ranges. Default: overview.' })),
  view: Type.Optional(Type.Union([Type.Literal("ranges"), Type.Literal("messages")], { description: 'For uncompressed scope: "ranges" (default) or "messages" (per-message listing).' })),
  tool: Type.Optional(Type.String({ description: 'Filter by tool name (e.g. "bash", "read"). Only for uncompressed+messages.' })),
  sort: Type.Optional(Type.Union([Type.Literal("size"), Type.Literal("time"), Type.Literal("tool"), Type.Literal("age")], { description: "Sort order. Default: size." })),
  limit: Type.Optional(Type.Number({ description: "Max items to show (default: 30)." })),
});

type StatusArgs = Static<typeof StatusParams>;

export function makeStatusTool(runtime: AcpRuntime): ToolDefinition<typeof StatusParams> {
  return {
    name: "acp_status",
    label: "ACP Status",
    description: "Context status: overview, compressed blocks, or uncompressed ranges/messages. No args = overview + totals + compressible ranges.",
    promptSnippet: 'acp_status({}) or acp_status({ scope: "uncompressed", view: "messages" })',
    promptGuidelines: [
      "Call with no args for a quick overview of context usage.",
      "Use scope:'uncompressed' to find the largest compressible ranges.",
      "Use scope:'compressed' to inspect existing compression blocks.",
    ],
    parameters: StatusParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<unknown>> {
      try {
        const result = await handleStatus(params as StatusArgs, runtime, ctx);
        return { details: undefined, content: [{ type: "text", text: result }] };
      } catch (error) {
        logThrow("status", error, { sid: ctx.sessionManager.getSessionId() });
        throw error;
      }
    },
  };
}

async function handleStatus(args: StatusArgs, runtime: AcpRuntime, ctx: ExtensionContext): Promise<string> {
  const { state, coreMessages, entries } = await runtime.stateFor(ctx);
  const config = applyOutputHeadroom(runtime.configFor(ctx), ctx.model, resolveOutputHeadroomCap(runtime.adapter.outputHeadroomMaxPct));
  const coveredIds = collectCoveredMessageIds(state);
  const systemPromptTokens = defaultCountTokens(ctx.getSystemPrompt?.() ?? buildAcpSystemPrompt(runtime.prompts));
  const imageTokens = collectImageTokens(entries, modelSupportsImages(ctx.model));
  const sentTokens = estimateTokens(coreMessages, coveredIds, imageTokens) + systemPromptTokens;
  const viewSentTokens = adjustedTokenCount(runtime.core, coreMessages, state, config, sentTokens, imageTokens, systemPromptTokens);
  const providerReal = ctx.getContextUsage?.()?.tokens ?? 0;
  const anchorStale = usageAnchorPredatesCompression(entries);
  const turn = runtime.core.processTurn({ messages: coreMessages, state, config, tokenCount: anchorStale ? viewSentTokens : Math.max(viewSentTokens, providerReal) });
  const base = buildStatusReport(turn.state, turn.messages, defaultCountTokens, {
    scope: args.scope,
    view: args.view,
    tool: args.tool,
    sort: args.sort,
    limit: args.limit,
  });
  if (args.scope) return base;

  const ranges = viableRanges(turn.nudge?.compressibleRanges ?? []);
  const protectedRanges = turn.nudge?.protectedRanges ?? [];
  const extra: string[] = [];
  if (providerReal > 0 && config.modelContextLimit > 0) {
    const fmtK = (value: number): string => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
    extra.push("");
    extra.push(`Estimate: ${fmtK(viewSentTokens)} (${Math.round((viewSentTokens / config.modelContextLimit) * 100)}%)   |   Provider-reported: ${fmtK(providerReal)} (${Math.round((providerReal / config.modelContextLimit) * 100)}%)`);
  }
  if (turn.nudge) {
    extra.push("");
    extra.push(turn.nudge.shouldInject ? `Nudge: ACTIVE — ${turn.nudge.reason}` : `Nudge: idle — ${turn.nudge.reason}`);
  }
  if (ranges.length > 0 || protectedRanges.length > 0) {
    extra.push("");
    extra.push(formatRanges(ranges, protectedRanges));
  }
  return extra.length > 0 ? `${base}\n${extra.join("\n")}` : base;
}
