import { Type, type Static } from "typebox";
import type { AgentToolResult, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AcpRuntime } from "./runtime.ts";
import { MAX_COMPRESS_ATTEMPTS } from "./runtime.ts";
import { debug, logError, logInfo, logThrow, logWarn } from "./log.ts";
import { estimateTokens, collectCoveredMessageIds, collectImageTokens, modelSupportsImages, lastUserMessageId, adjustedTokenCount } from "./tokens.ts";
import { buildAcpSystemPrompt } from "./system-prompt.ts";
import { countUnicodeEscapes, findUnverifiableUserQuote, sanitizeSummary } from "./summary-sanitize.ts";
import { defaultCountTokens, parseCompressArgs, viableRanges, formatRanges, type CompressionBlock, type CompressionState, type CompressParseDiagnostics, type NudgeDecision } from "acp-kernel";

function formatK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

const RangeSpec = Type.Object({
  startId: Type.String({ description: 'Message ref, e.g. "m00005" (from the acp tag), or a block id "b3".' }),
  endId: Type.String({ description: 'Inclusive end ref. Must be at or after startId.' }),
  summary: Type.String({ description: "Complete technical summary replacing all content in range. Keep only essential details (conclusions, file paths, decisions, exact values, etc.)." }),
  topic: Type.Optional(Type.String({ description: "Short label (3-5 words) for THIS range, e.g. 'Auth System Exploration'. Omit to use top-level topic. When compressing multiple unrelated ranges, give each its own topic for better quality." })),
});

const CompressParams = Type.Object({
  topic: Type.Optional(Type.String({ description: "Fallback topic for entries without their own. Omit when each content entry specifies its own topic." })),
  content: Type.Union([
    Type.Array(RangeSpec),
    Type.String({ description: "JSON-encoded array of ranges accepted for providers that stringify nested tool arguments." }),
  ], { description: "One or more ranges to compress, each with start/end boundaries and a summary." }),
  summaryMaxChars: Type.Optional(Type.Number({ description: "Override max summary length (default max: 20000 chars)." })),
});

type CompressArgs = Static<typeof CompressParams>;
type RangeEntry = Static<typeof RangeSpec>;

export function makeCompressTool(runtime: AcpRuntime): ToolDefinition<typeof CompressParams> {
  return {
    name: "compress",
    label: "Compress",
    description: "Replace older conversation ranges with detailed summaries you write. Single range: compress({ content: [{ startId, endId, summary }] }). Batch: compress({ content: [{ topic, startId, endId, summary }, ...] }).",
    promptSnippet: "compress({ content: [{ startId, endId, summary }] }) or batch multiple ranges",
    promptGuidelines: [
      "Each message has an acp tag with its mNNNNN ref, token size, and type. Compress ranges by their refs.",
      "Batch multiple unrelated ranges in one call — each gets its own topic and summary.",
      "Write dense, self-contained summaries — preserve file paths, signatures, errors, and decisions verbatim.",
      "Never compress content the current step is actively using.",
    ],
    parameters: CompressParams,
    async execute(toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<unknown>> {
      try {
        const result = await handleCompress(params as CompressArgs, runtime, ctx, toolCallId);
        return { details: undefined, content: [{ type: "text", text: result }] };
      } catch (error) {
        logThrow("compress", error, { sid: ctx.sessionManager.getSessionId() });
        throw error;
      }
    },
  };
}

export function normalizeRanges(args: CompressArgs): RangeEntry[] | string {
  const effective = repairContentTail(args);
  const { ranges, diagnostics } = parseCompressArgs(effective);
  if (ranges.length === 0) {
    if (Array.isArray(effective.content) && effective.content.length === 0) return [];
    return describeDiagnostics(diagnostics, effective.content);
  }
  return ranges.map((range) => ({ startId: range.startRef, endId: range.endRef, summary: range.summary, topic: range.topic }));
}

function repairContentTail(args: CompressArgs): CompressArgs {
  if (typeof args.content !== "string") return args;
  const repaired = tailRepair(args.content);
  return repaired === undefined ? args : { ...args, content: repaired };
}

export function tailRepair(value: string): string | undefined {
  const trimmed = value.trimEnd();
  if (!trimmed.endsWith("]")) return undefined;
  const body = trimmed.slice(0, -1).trimEnd();
  if (!body.endsWith('"')) return undefined;
  const candidate = body + "}]";
  try {
    if (Array.isArray(JSON.parse(candidate))) return candidate;
  } catch {
    // Not the missing-brace case.
  }
  return undefined;
}

function describeDiagnostics(diagnostics: CompressParseDiagnostics, content: CompressArgs["content"]): string {
  const shape = typeof content === "string" ? "a JSON-encoded string" : `a ${typeof content}`;
  const base = `Invalid compress content (${diagnostics.kind}): got ${shape}`;
  if (diagnostics.kind === "truncated") return `${base}; the input was truncated and no complete ranges could be recovered. Shorten the summary or split into smaller ranges.`;
  if (diagnostics.invalidItems > 0) return `${base}; ${diagnostics.invalidItems} entr${diagnostics.invalidItems === 1 ? "y was" : "ies were"} dropped as invalid. Each range must have string fields startId, endId, summary.`;
  const parseError = jsonParseError(content);
  if (parseError !== undefined) return `${base}; the JSON failed to parse: ${parseError}. Fix the malformed JSON and retry.`;
  return `${base}. content must be an ARRAY of {startId, endId, summary} objects.`;
}

function jsonParseError(content: CompressArgs["content"]): string | undefined {
  if (typeof content !== "string") return undefined;
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    JSON.parse(trimmed);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function compressPanelBlocks(text: string): number {
  if (!text.trimStart().startsWith("▣ ACP |")) return -1;
  const match = text.match(/, (\d+) blocks?\)/);
  return match ? Number(match[1]) : -1;
}

export function isCompressSuccessText(text: string): boolean {
  return compressPanelBlocks(text) > 0;
}

export function isCompressNoopText(text: string): boolean {
  return compressPanelBlocks(text) === 0;
}

const DEAD_REPEAT_REJECT = 2;

function paddedRef(value: number): string {
  return `m${String(value).padStart(5, "0")}`;
}

function blockHasVisibleAnchor(block: CompressionBlock, visibleIds: Set<string>): boolean {
  if (visibleIds.has(`acp_summary_${block.blockId}`)) return true;
  return block.effectiveMessageIds.some((id) => visibleIds.has(id));
}

function hasActiveOwner(state: CompressionState, ownedIds: string[], visibleIds: Set<string>): boolean {
  const owned = new Set(ownedIds);
  for (const block of state.blocks) {
    if (!block.active) continue;
    const inheritsOwned = block.directBlockIds.some((childId) => {
      const child = state.blocks.find((candidate) => candidate.blockId === childId);
      return child !== undefined && child.effectiveMessageIds.some((id) => owned.has(id));
    });
    if (inheritsOwned && blockHasVisibleAnchor(block, visibleIds)) return true;
  }
  return false;
}

function refIsDead(ref: string, state: CompressionState, visibleIds: Set<string>): boolean {
  const trimmed = ref.trim();
  if (/^b\d+$/i.test(trimmed)) {
    const block = state.blocks.find((candidate) => candidate.blockId.toLowerCase() === trimmed.toLowerCase());
    if (!block) return true;
    if (block.active && blockHasVisibleAnchor(block, visibleIds)) return false;
    return !hasActiveOwner(state, block.effectiveMessageIds, visibleIds);
  }
  const match = trimmed.match(/^m(\d+)$/i);
  if (!match) return true;
  const rawId = state.messageRefs.byRef[trimmed] ?? state.messageRefs.byRef[paddedRef(Number(match[1]))];
  if (!rawId) return true;
  if (visibleIds.has(rawId)) return false;
  return !hasActiveOwner(state, [rawId], visibleIds);
}

function compressibleSnapshotText(nudge: NudgeDecision | undefined): string {
  const ranges = viableRanges(nudge?.compressibleRanges ?? []);
  return ranges.length > 0 ? formatRanges(ranges, []) : "No compressible ranges remain — continue the task without compressing.";
}

function deadRepeatRejectionText(spans: string[], count: number, snapshot: string): string {
  return [
    "▣ ACP | 0 → 0 tokens (~0 reclaimed, 0 blocks)",
    `[ACP] REJECTED — this exact compress call has failed ${count}× (ranges ${spans.join(", ")}). Those refs are stale and cannot succeed. Do not retry it.`,
    "",
    "Current compressible ranges (use these refs exactly as listed):",
    snapshot,
    "",
    "If none fit, call acp_status or continue without compressing.",
  ].join("\n");
}

function cappedRejectionText(snapshot: string): string {
  return [
    "▣ ACP | 0 → 0 tokens (~0 reclaimed, 0 blocks)",
    `[ACP] PAUSED — ${MAX_COMPRESS_ATTEMPTS} compress attempts already failed this turn; further calls are rejected until the next user message.`,
    "",
    "Current compressible ranges (use these refs exactly as listed):",
    snapshot,
    "",
    "Continue the task; compress becomes available again on the next user message.",
  ].join("\n");
}

function tier3OnlyRewrite(newBlocks: CompressionBlock[], allBlocks: CompressionBlock[]): string[] | null {
  if (newBlocks.length === 0) return null;
  const byId = new Map(allBlocks.map((block) => [block.blockId, block]));
  const spans: string[] = [];
  for (const block of newBlocks) {
    const consumed = block.directBlockIds.map((id) => byId.get(id));
    if (block.tier !== 3 || block.directMessageIds.length > 0 || block.directBlockIds.length === 0 || consumed.some((child) => !child || child.tier !== 3)) return null;
    spans.push(`${block.startRef ?? "?"}..${block.endRef ?? "?"}`);
  }
  return spans;
}

function tierReadyHint(state: CompressionState, config: ReturnType<AcpRuntime["configFor"]>): string {
  if (!config.tiers.enabled) return "";
  const active = state.blocks.filter((block) => block.active);
  const first = (blocks: CompressionBlock[]) => blocks[0]?.blockId ?? "";
  const last = (blocks: CompressionBlock[]) => blocks[blocks.length - 1]?.blockId ?? "";
  const tier2 = active.filter((block) => block.tier === 2);
  if (tier2.length >= config.tiers.tier3Trigger) return `Actionable now: condense tier-2 blocks ${first(tier2)}..${last(tier2)} into a tier-3 block.`;
  const tier1 = active.filter((block) => block.tier === 1);
  if (tier1.length >= config.tiers.tier2Trigger) return `Actionable now: distill tier-1 blocks ${first(tier1)}..${last(tier1)} into a tier-2 block.`;
  return "";
}

async function handleCompress(args: CompressArgs, runtime: AcpRuntime, ctx: ExtensionContext, toolCallId?: string): Promise<string> {
  const normalized = normalizeRanges(args);
  if (typeof normalized === "string") throw new Error(normalized);
  if (normalized.length === 0) return "No ranges provided.";

  const { state: initialState, coreMessages, entries } = await runtime.stateFor(ctx);
  const config = runtime.configFor(ctx);
  const systemPromptTokens = defaultCountTokens(buildAcpSystemPrompt(runtime.prompts));
  const imageTokens = collectImageTokens(entries, modelSupportsImages(ctx.model));
  const sentTokens = estimateTokens(coreMessages, collectCoveredMessageIds(initialState), imageTokens) + systemPromptTokens;
  const firstTokenCount = adjustedTokenCount(runtime.core, coreMessages, initialState, config, sentTokens, imageTokens, systemPromptTokens);
  const turn = runtime.core.processTurn({ messages: coreMessages, state: initialState, config, tokenCount: firstTokenCount });
  const state = turn.state;
  const messages = turn.messages;
  const sid = ctx.sessionManager.getSessionId();
  const sanitizedRanges = normalized.map((range) => {
    const span = `${range.startId}..${range.endId}`;
    const sanitized = sanitizeSummary(range.summary);
    if (sanitized.unescaped) debug.event("compress", { sid, event: "summary-unescaped", span, escapes: countUnicodeEscapes(range.summary), beforeLen: range.summary.length, afterLen: sanitized.text.length });
    const unverifiedQuote = findUnverifiableUserQuote(sanitized.text);
    if (unverifiedQuote !== null) logWarn("compress", { sid, event: "summary-unverifiable-quote", span, claim: unverifiedQuote });
    return sanitized.text === range.summary ? range : { ...range, summary: sanitized.text };
  });
  const turnKey = lastUserMessageId(entries) ?? sid;
  const snapshot = compressibleSnapshotText(turn.nudge);
  if (runtime.compressRetryCappedFor(turnKey)) return cappedRejectionText(snapshot);

  const visibleIds = new Set(messages.map((message) => message.id));
  const deadSpans = normalized.filter((range) => refIsDead(range.startId, state, visibleIds) || refIsDead(range.endId, state, visibleIds)).map((range) => `${range.startId}..${range.endId}`);
  const allDead = deadSpans.length === normalized.length;
  const beforeTokens = estimateTokens(messages, collectCoveredMessageIds(state), imageTokens);
  const summaryMaxChars = args.summaryMaxChars;
  const topLevelTopic = args.topic;

  debug.event("compress-in", { sid, ranges: normalized.length, spans: normalized.map((range) => ({ span: `${range.startId}..${range.endId}`, summaryLen: range.summary.length, topic: range.topic ?? topLevelTopic ?? null })), blocksBefore: state.blocks.length, activeBefore: state.blocks.filter((block) => block.active).length, beforeMsgCount: messages.length, beforeTokens });

  const applied = runtime.core.applyCompression({
    ranges: sanitizedRanges.map((range) => ({ startRef: range.startId, endRef: range.endId, summary: range.summary, topic: range.topic ?? topLevelTopic, summaryMaxChars, compressCallId: toolCallId })),
    messages,
    state,
    config,
  });
  const rewriteSpans = applied.result.blocksCreated > 0 ? tier3OnlyRewrite(applied.state.blocks.slice(-applied.result.blocksCreated), applied.state.blocks) : null;
  if (rewriteSpans) {
    await runtime.save(state, ctx);
    const hint = tierReadyHint(state, config);
    throw new Error(`Range ${rewriteSpans.join(", ")} only re-condenses terminal tier-3 block(s); nothing was compressed. ${hint} Use search_context or decompress to retrieve details, or choose a range containing uncompressed messages.`);
  }

  await runtime.save(applied.state, ctx);
  const { blocksCreated, tokensCompressed, errors, warnings } = applied.result;
  if (blocksCreated > 0) runtime.clearDeadCompress(sid);
  else if (allDead) {
    const count = runtime.noteDeadCompress(sid, normalized.map((range) => `${range.startId}..${range.endId}`).join("|"));
    if (count >= DEAD_REPEAT_REJECT) return deadRepeatRejectionText(deadSpans, count, snapshot);
  }

  const postSentTokens = adjustedTokenCount(runtime.core, coreMessages, applied.state, config, estimateTokens(coreMessages, collectCoveredMessageIds(applied.state), imageTokens) + systemPromptTokens, imageTokens, systemPromptTokens);
  const afterTurn = runtime.core.processTurn({ messages: coreMessages, state: applied.state, config, tokenCount: postSentTokens });
  const afterTokens = estimateTokens(afterTurn.messages, collectCoveredMessageIds(applied.state), imageTokens);
  const reclaimed = Math.max(0, beforeTokens - afterTokens);
  const newBlocks = applied.state.blocks.slice(-blocksCreated);

  logInfo("compress", { sid, event: "applied", ranges: normalized.length, blocksCreated, tokensCompressed, beforeTokens, afterTokens, warnings: warnings.length, errors: errors.length, newBlockIds: newBlocks.map((block) => block.blockId) });
  if (errors.length > 0) logError("compress", { sid, event: "errors", count: errors.length, errors: errors.slice(0, 5) });
  if (warnings.length > 0) logWarn("compress", { sid, event: "warnings", count: warnings.length, warnings: warnings.slice(0, 5) });

  const lines = [`▣ ACP | ${formatK(beforeTokens)} → ${formatK(afterTokens)} tokens (~${formatK(reclaimed)} reclaimed, ${blocksCreated} block${blocksCreated > 1 ? "s" : ""})`];
  if (warnings.length > 0) lines.push("⚠️ " + warnings.join("; "));
  if (errors.length > 0) lines.push("Errors: " + errors.join("; "));
  return lines.join("\n");
}
