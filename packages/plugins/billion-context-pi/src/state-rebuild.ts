import { parseCompressArgs, type CompressionCore, type CompressionState } from "acp-kernel";
import { estimateTokensFast } from "acp-kernel";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { logWarn } from "./log.ts";
import { entriesToCoreMessages } from "./messages.ts";
import { sanitizeSummary } from "./summary-sanitize.ts";

interface CompressCall {
  entryIndex: number;
  toolCallId: string;
  ranges: Array<{ startRef: string; endRef: string; summary: string; topic?: string; summaryMaxChars?: number }>;
}

type ApplyInput = Parameters<CompressionCore["applyCompression"]>[0];

export interface RebuildReport {
  blocks: number;
  callsApplied: number;
  callsSkipped: number;
  errors: string[];
}

export interface RebuildResult {
  state: CompressionState;
  report: RebuildReport;
}

function toolCallsOf(message: unknown): Array<{ name?: string; id?: string; arguments?: unknown }> {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return [];
  const calls: Array<{ name?: string; id?: string; arguments?: unknown }> = [];
  for (const block of content) {
    const b = block as { type?: string; name?: string; id?: string; arguments?: unknown };
    if (b.type === "toolCall" && b.name && b.id) calls.push({ name: b.name, id: b.id, arguments: b.arguments });
  }
  return calls;
}

function entryMessage(entry: SessionEntry): { role?: string; toolName?: string; toolCallId?: string; isError?: boolean } | undefined {
  if (entry.type !== "message") return undefined;
  return (entry as { message?: { role?: string; toolName?: string; toolCallId?: string; isError?: boolean } }).message;
}

export function hasCompressHistory(entries: SessionEntry[]): boolean {
  for (const entry of entries) {
    const message = entryMessage(entry);
    if (!message || message.role !== "toolResult" || message.toolName !== "compress" || !message.toolCallId) continue;
    if (message.isError !== true) return true;
  }
  return false;
}

function parseCompressCall(toolCallId: string, arguments_: unknown, entryIndex: number): CompressCall | null {
  const parsed = parseCompressArgs(arguments_, { callId: toolCallId });
  if (parsed.ranges.length === 0) return null;
  return {
    entryIndex,
    toolCallId,
    ranges: parsed.ranges.map((range) => ({
      startRef: range.startRef,
      endRef: range.endRef,
      summary: sanitizeSummary(range.summary).text,
      topic: range.topic,
      summaryMaxChars: range.summaryMaxChars,
    })),
  };
}

export function rebuildStateFromLog(input: {
  entries: SessionEntry[];
  state: CompressionState;
  config: ApplyInput["config"];
  core: CompressionCore;
}): RebuildResult {
  const { entries, core } = input;
  const succeeded = new Set<string>();
  for (const entry of entries) {
    const message = entryMessage(entry);
    if (!message || message.role !== "toolResult" || message.toolName !== "compress" || !message.toolCallId) continue;
    if (message.isError !== true) succeeded.add(message.toolCallId);
  }

  const calls: CompressCall[] = [];
  entries.forEach((entry, entryIndex) => {
    const message = entryMessage(entry);
    if (!message || message.role !== "assistant") return;
    for (const call of toolCallsOf(message)) {
      if (call.name !== "compress" || !call.id || !succeeded.has(call.id)) continue;
      const parsed = parseCompressCall(call.id, call.arguments, entryIndex);
      if (parsed) calls.push(parsed);
      else logWarn("state-rebuild", { event: "unparseable-compress-call", toolCallId: call.id });
    }
  });
  if (calls.length === 0) return { state: input.state, report: { blocks: input.state.blocks.length, callsApplied: 0, callsSkipped: 0, errors: [] } };

  let state = input.state;
  const report: RebuildReport = { blocks: 0, callsApplied: 0, callsSkipped: 0, errors: [] };
  for (const call of calls) {
    let applied: ReturnType<CompressionCore["applyCompression"]>;
    try {
      const messages = entriesToCoreMessages(entries.slice(0, call.entryIndex + 1)) as ApplyInput["messages"];
      const tokenCount = messages.reduce((sum, message) => sum + estimateTokensFast(String((message as { text?: unknown }).text ?? "")), 0);
      const turn = core.processTurn({ messages, state, config: input.config, tokenCount });
      state = turn.state;
      applied = core.applyCompression({
        ranges: call.ranges.map((range) => ({ ...range, compressCallId: call.toolCallId })),
        messages: turn.messages as ApplyInput["messages"],
        state,
        config: input.config,
      });
    } catch (e) {
      report.callsSkipped += 1;
      report.errors.push(`throw: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const result = applied.result as { blocksCreated?: number; errors?: string[] };
    if ((result.errors?.length ?? 0) > 0 || (result.blocksCreated ?? 0) === 0) {
      report.callsSkipped += 1;
      for (const error of result.errors ?? []) report.errors.push(error);
      continue;
    }
    state = applied.state;
    report.callsApplied += 1;
  }
  report.blocks = state.blocks.length;
  return { state, report };
}
