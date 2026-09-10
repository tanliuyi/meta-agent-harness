import type { SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { logWarn } from "./log.ts";

type AgentMessage = SessionMessageEntry["message"];

export interface DegenerationGuardConfig {
  enabled?: boolean;
  minRun?: number;
}

export const DEFAULT_DEGENERATION_GUARD: Required<DegenerationGuardConfig> = { enabled: true, minRun: 200 };
const MIN_VALID_MIN_RUN = 8;

export function resolveDegenerationGuard(cfg?: boolean | DegenerationGuardConfig): Required<DegenerationGuardConfig> {
  if (cfg === false) return { enabled: false, minRun: DEFAULT_DEGENERATION_GUARD.minRun };
  const c = typeof cfg === "object" && cfg !== null ? cfg : {};
  let minRun = DEFAULT_DEGENERATION_GUARD.minRun;
  if (c.minRun !== undefined) {
    const n = c.minRun;
    if (typeof n === "number" && Number.isFinite(n) && n >= 2) minRun = Math.max(MIN_VALID_MIN_RUN, Math.floor(n));
    else logWarn("config", { event: "degeneration-guard-invalid", field: "minRun", value: n, fallback: minRun });
  }
  return { enabled: c.enabled !== false, minRun };
}

export interface DegenerateRun {
  char: string;
  count: number;
  index: number;
}

let preScreenMinRun = Number.NaN;
let preScreenRe: RegExp | null = null;

function hasLongRun(text: string, minRun: number): boolean {
  const n = Math.floor(minRun);
  if (preScreenRe === null || preScreenMinRun !== n) {
    preScreenMinRun = n;
    preScreenRe = new RegExp(`(.)\\1{${Math.max(n - 1, 0)},}`, "su");
  }
  return preScreenRe.test(text);
}

export function findDegenerateRuns(text: string, minRun: number): DegenerateRun[] {
  const runs: DegenerateRun[] = [];
  if (!text || !Number.isFinite(minRun) || minRun < 2 || !hasLongRun(text, minRun)) return runs;
  const chars = Array.from(text);
  let utf16 = 0;
  let k = 0;
  while (k < chars.length) {
    const ch = chars[k]!;
    let m = k + 1;
    while (m < chars.length && chars[m] === ch) m++;
    const count = m - k;
    if (count >= minRun) runs.push({ char: ch, count, index: utf16 });
    utf16 += count * ch.length;
    k = m;
  }
  return runs;
}

function describeChar(ch: string): string {
  if (ch === " ") return "space";
  if (ch === "\n") return "newline";
  if (ch === "\t") return "tab";
  if (ch === "\r") return "carriage-return";
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x20 || cp === 0x7f) return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
  return JSON.stringify(ch);
}

function applyRuns(text: string, runs: DegenerateRun[], minRun: number): string {
  const keep = Math.max(1, Math.min(3, minRun - 1));
  let out = "";
  let last = 0;
  for (const r of runs) {
    out += text.slice(last, r.index);
    out += `${r.char.repeat(keep)}… [${r.count}× identical chars cut — degenerate repeat]`;
    last = r.index + r.count * r.char.length;
  }
  out += text.slice(last);
  return out;
}

export function collapseDegenerateRuns(text: string, minRun: number): string {
  const runs = findDegenerateRuns(text, minRun);
  return runs.length > 0 ? applyRuns(text, runs, minRun) : text;
}

export interface CollapseEvidence {
  msgIndex: number;
  blocks: string[];
  runs: DegenerateRun[];
}

export function collapseAssistantDegeneration(
  messages: AgentMessage[],
  cfg?: boolean | DegenerationGuardConfig,
): { messages: AgentMessage[]; evidence: CollapseEvidence[] } {
  const { enabled, minRun } = resolveDegenerationGuard(cfg);
  if (!enabled || messages.length === 0) return { messages, evidence: [] };
  try {
    const evidence: CollapseEvidence[] = [];
    let changed = false;
    const out = messages.slice();
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i] as { role?: string; content?: unknown };
      if (msg.role !== "assistant") continue;
      const c = msg.content;
      if (typeof c === "string") {
        const runs = findDegenerateRuns(c, minRun);
        if (runs.length > 0) {
          out[i] = { ...(msg as object), content: applyRuns(c, runs, minRun) } as AgentMessage;
          evidence.push({ msgIndex: i, blocks: ["content"], runs });
          changed = true;
        }
        continue;
      }
      if (!Array.isArray(c)) continue;
      const blocks: string[] = [];
      const runs: DegenerateRun[] = [];
      let blockChanged = false;
      const nc = c.map((p) => {
        const b = p as { type?: string; text?: unknown; thinking?: unknown };
        if (b?.type === "text" && typeof b.text === "string") {
          const r = findDegenerateRuns(b.text, minRun);
          if (r.length > 0) {
            blockChanged = true;
            blocks.push("text");
            runs.push(...r);
            return { ...(b as object), text: applyRuns(b.text, r, minRun) };
          }
        } else if (b?.type === "thinking" && typeof b.thinking === "string") {
          const r = findDegenerateRuns(b.thinking, minRun);
          if (r.length > 0) {
            blockChanged = true;
            blocks.push("thinking");
            runs.push(...r);
            return { ...(b as object), thinking: applyRuns(b.thinking, r, minRun) };
          }
        }
        return p;
      });
      if (blockChanged) {
        out[i] = { ...(msg as object), content: nc } as AgentMessage;
        evidence.push({ msgIndex: i, blocks, runs });
        changed = true;
      }
    }
    return { messages: changed ? out : messages, evidence };
  } catch {
    return { messages, evidence: [] };
  }
}

export function lastAssistantRuns(messages: AgentMessage[], minRun: number): DegenerateRun[] | null {
  try {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as { role?: string; content?: unknown };
      if (msg.role !== "assistant") continue;
      const runs: DegenerateRun[] = [];
      const c = msg.content;
      if (typeof c === "string") runs.push(...findDegenerateRuns(c, minRun));
      else if (Array.isArray(c)) {
        for (const p of c) {
          const b = p as { type?: string; text?: unknown; thinking?: unknown };
          if (b?.type === "text" && typeof b.text === "string") runs.push(...findDegenerateRuns(b.text, minRun));
          else if (b?.type === "thinking" && typeof b.thinking === "string") runs.push(...findDegenerateRuns(b.thinking, minRun));
        }
      }
      return runs.length > 0 ? runs : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function degenerationNotice(runs: DegenerateRun[]): AgentMessage {
  const sorted = [...runs].sort((a, b) => b.count - a.count);
  const top = sorted[0]!;
  const extra = sorted.length > 1 ? ` and ${sorted.length - 1} other repeated segment(s)` : "";
  return {
    role: "user",
    content: [{ type: "text", text: `[ACP recovery notice] Your previous turn ended in degenerate generation: its output contained ${top.count} consecutive repetitions of ${describeChar(top.char)}${extra}. That repeated segment carries no information and has been truncated in the context above. Do not reproduce it or continue the pattern. Resume your task from your last valid step.` }],
    timestamp: Date.now(),
  } as AgentMessage;
}
