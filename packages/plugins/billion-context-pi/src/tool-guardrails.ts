import { createHash } from "node:crypto";
import {
  isToolCallEventType,
  type ExtensionAPI,
  type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { DEFAULT_TOOL_BASH_TIMEOUT, DEFAULT_TOOL_OUTPUT_MAX_BYTES, resolveRepetitionGuard } from "./config.ts";
import { debug, logInfo, logWarn } from "./log.ts";
import type { AcpRuntime } from "./runtime.ts";

type ContentPart = ToolResultEvent["content"][number];

export function isBashToolResult(event: ToolResultEvent): boolean {
  return event.toolName === "bash";
}

export function resolveBashTimeout(input: { timeout?: number }, defaultTimeout: number | undefined): number | undefined {
  if (input.timeout !== undefined) return undefined;
  const timeout = defaultTimeout ?? DEFAULT_TOOL_BASH_TIMEOUT;
  return Number.isFinite(timeout) && timeout > 0 ? timeout : undefined;
}

export function capToolOutput(content: ToolResultEvent["content"], maxBytes: number | undefined, fullPath?: string): ToolResultEvent["content"] | undefined {
  const max = maxBytes ?? DEFAULT_TOOL_OUTPUT_MAX_BYTES;
  if (!Number.isFinite(max) || max <= 0) return undefined;
  const kept: ContentPart[] = [];
  const texts: string[] = [];
  for (const part of content) {
    if (part.type === "text") texts.push((part as { text: string }).text);
    else kept.push(part);
  }
  if (texts.length === 0) return undefined;
  const combined = texts.join("\n");
  const total = Buffer.byteLength(combined, "utf8");
  if (total <= max) return undefined;
  const head = keepHead(combined, max);
  const dropped = total - Buffer.byteLength(head, "utf8");
  kept.push({ type: "text", text: head + buildCapNotice(dropped, max, fullPath) } as ContentPart);
  return kept;
}

const TIMEOUT_RE = /Command timed out after (\d+) seconds/;

export function detectBashTimeout(content: ToolResultEvent["content"]): number | undefined {
  for (const part of content) {
    if (part.type !== "text") continue;
    const match = (part as { text: string }).text.match(TIMEOUT_RE);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function appendTrailingText(content: ToolResultEvent["content"], notice: string): ToolResultEvent["content"] {
  const next = [...content];
  for (let i = next.length - 1; i >= 0; i--) {
    const part = next[i];
    if (part?.type === "text") {
      next[i] = { type: "text", text: `${(part as { text: string }).text}${notice}` } as ContentPart;
      return next;
    }
  }
  next.push({ type: "text", text: notice } as ContentPart);
  return next;
}

export function appendTimeoutNotice(content: ToolResultEvent["content"], secs: number): ToolResultEvent["content"] {
  return appendTrailingText(content, buildTimeoutNotice(secs));
}

function keepHead(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0) {
    const byte = buffer[end];
    if (byte === undefined || (byte & 0xc0) !== 0x80) break;
    end--;
  }
  let head = buffer.subarray(0, end).toString("utf8");
  const newline = head.lastIndexOf("\n");
  if (newline >= Math.floor(maxBytes / 2)) head = head.slice(0, newline);
  return head;
}

function buildCapNotice(dropped: number, maxBytes: number, fullPath?: string): string {
  const where = fullPath ? `Full output saved to: ${fullPath} — read it to see everything.` : "To see more, narrow the query or redirect output to a file and read the relevant slice.";
  return `\n\n[ACP guardrail: output capped at ${formatBytes(maxBytes)} (~${formatBytes(dropped)} dropped). ${where}]`;
}

function buildTimeoutNotice(secs: number): string {
  const suggested = Math.min(Math.max(Math.ceil(secs * 2), 120), 3600);
  return `\n\n[ACP guardrail: command killed after ${secs}s. To give it more time, re-run the bash tool with a larger \`timeout\` argument (e.g. \"timeout\": ${suggested}).]`;
}

function formatBytes(value: number): string {
  return value >= 1024 ? `${(value / 1024).toFixed(1)}KB` : `${value}B`;
}

export function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined || typeof value !== "object") {
    try {
      return JSON.stringify(value) ?? "null";
    } catch {
      return String(value);
    }
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalStringify(item)}`).join(",")}}`;
}

export function repetitionFingerprint(toolName: string, input: unknown): string {
  const payload = `${toolName}\u0000${canonicalStringify(input ?? {})}`;
  try {
    return createHash("sha1").update(payload).digest("hex");
  } catch {
    return `unhashable:${toolName}`;
  }
}

export type RepetitionAction = "none" | "warn" | "abort";
export interface RepetitionDecision {
  action: RepetitionAction;
  count: number;
  fingerprint: string;
  toolName: string;
}

export class RepetitionTracker {
  private readonly thresholds: { warn: number; abort: number };
  private lastFp: string | null = null;
  private count = 0;
  constructor(thresholds: { warn: number; abort: number }) {
    this.thresholds = thresholds;
  }
  note(toolName: string, input: unknown): RepetitionDecision {
    const fingerprint = repetitionFingerprint(toolName, input);
    this.count = fingerprint === this.lastFp ? this.count + 1 : 1;
    this.lastFp = fingerprint;
    const action: RepetitionAction = this.count >= this.thresholds.abort ? "abort" : this.count >= this.thresholds.warn ? "warn" : "none";
    return { action, count: this.count, fingerprint, toolName };
  }
  reset(): void {
    this.lastFp = null;
    this.count = 0;
  }
}

function buildRepetitionWarnNotice(toolName: string, count: number): string {
  return `\n\n[ACP guardrail: you have issued ${count} CONSECUTIVE identical \`${toolName}\` calls (name + arguments byte-for-byte identical). Re-running the exact same call will not produce a new result. STOP issuing this identical call — change your approach, change the arguments, or stop and report to the user.]`;
}

function buildRepetitionAbortNotice(toolName: string, count: number): string {
  return `[ACP guardrail: BLOCKED — you issued ${count} consecutive identical \`${toolName}\` calls (byte-for-byte identical arguments). This call was refused and NOT executed. You MUST change strategy: use different arguments, a different tool, or stop and report to the user. The turn has been aborted.`;
}

export function wireToolGuardrails(pi: ExtensionAPI, runtime: AcpRuntime): void {
  const trackers = new Map<string, RepetitionTracker>();
  const pendingWarns = new Map<string, number>();

  pi.on("tool_call", (event, ctx) => {
    if (isToolCallEventType("bash", event)) {
      const timeout = resolveBashTimeout(event.input, runtime.adapter.toolBashDefaultTimeout);
      if (timeout !== undefined) {
        event.input.timeout = timeout;
        debug.event("guardrail-bash-timeout", { applied: timeout });
      }
    }
    if (!ctx || !ctx.sessionManager) return;
    const config = resolveRepetitionGuard(runtime.adapter);
    if (!config.enabled) return;
    const sid = ctx.sessionManager.getSessionId();
    let tracker = trackers.get(sid);
    if (!tracker) {
      tracker = new RepetitionTracker(config);
      trackers.set(sid, tracker);
    }
    const decision = tracker.note(event.toolName, event.input);
    debug.event("guardrail-repetition", { sid, tool: decision.toolName, count: decision.count, action: decision.action });
    if (decision.action === "abort") {
      const notice = buildRepetitionAbortNotice(decision.toolName, decision.count);
      logWarn("guardrail", { event: "repetition-abort", sid, tool: decision.toolName, count: decision.count });
      if (ctx.hasUI) ctx.ui.notify(`[ACP] ${notice}`, "warning");
      try {
        ctx.abort();
      } catch {
        // Best effort; blocking the call is the hard guarantee.
      }
      return { block: true, reason: notice };
    }
    if (decision.action === "warn") {
      logInfo("guardrail", { event: "repetition-warn", sid, tool: decision.toolName, count: decision.count });
      pendingWarns.set(event.toolCallId, decision.count);
    }
  });

  pi.on("tool_result", (event) => {
    const isBash = isBashToolResult(event);
    const fullPath = isBash
      ? (event.details as { fullOutputPath?: string } | undefined)?.fullOutputPath
      : undefined;
    const timeoutSecs = isBash && event.isError ? detectBashTimeout(event.content) : undefined;
    let modified: ToolResultEvent["content"] | undefined;
    const max = runtime.adapter.toolOutputMaxBytes ?? DEFAULT_TOOL_OUTPUT_MAX_BYTES;
    const capped = capToolOutput(event.content, max, fullPath);
    if (capped) {
      modified = capped;
      debug.event("guardrail-output-cap", { max, hadPath: !!fullPath });
      logWarn("guardrail", { event: "output-cap", max, hadPath: !!fullPath });
    }
    if (timeoutSecs !== undefined) {
      modified = appendTimeoutNotice(modified ?? event.content, timeoutSecs);
      debug.event("guardrail-bash-timeout-notice", { secs: timeoutSecs });
      logInfo("guardrail", { event: "bash-timeout-notice", secs: timeoutSecs });
    }
    const warnCount = pendingWarns.get(event.toolCallId);
    if (warnCount !== undefined) {
      pendingWarns.delete(event.toolCallId);
      modified = appendTrailingText(modified ?? event.content, buildRepetitionWarnNotice(event.toolName, warnCount));
      debug.event("guardrail-repetition-warn-injected", { tool: event.toolName, count: warnCount });
    }
    if (modified) return { content: modified };
  });

  pi.on("input", (event, ctx) => {
    if (event.source !== "extension") trackers.get(ctx.sessionManager.getSessionId())?.reset();
  });
  pi.on("session_shutdown", (_event, ctx) => {
    trackers.delete(ctx.sessionManager.getSessionId());
  });
}
