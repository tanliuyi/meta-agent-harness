import { appendFileSync, mkdirSync } from "node:fs";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";

const ENV_DEBUG = process.env.ACP_DEBUG === "1" || process.env.ACP_DEBUG === "true";
const LOG_FILE = process.env.ACP_LOG_FILE ?? path.join(homedir(), ".pi", "acp-debug.log");

let runtimeDebug: boolean | null = null;
let initialized = false;

export function setDebugEnabled(enabled: boolean): void {
  runtimeDebug = enabled;
}

function debugOn(): boolean {
  return runtimeDebug ?? ENV_DEBUG;
}

function fmt(value: unknown): string {
  if (value instanceof Error) return value.stack || String(value);
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function writeLine(level: string, scope: string, fields: Record<string, unknown>): void {
  const body = Object.entries(fields).map(([key, value]) => `${key}=${fmt(value)}`).join(" ");
  try {
    mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, `${new Date().toISOString()} [${level}] [${scope}] ${body}\n`);
  } catch {
    // Logging must never affect the agent turn.
  }
}

async function writeDebug(line: string): Promise<void> {
  if (!debugOn()) return;
  if (!initialized) {
    initialized = true;
    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true }).catch(() => {});
  }
  await fs.appendFile(LOG_FILE, line, "utf8").catch(() => {});
}

export function logError(scope: string, fields: Record<string, unknown>): void {
  writeLine("error", scope, fields);
}

export function logWarn(scope: string, fields: Record<string, unknown>): void {
  writeLine("warn", scope, fields);
}

export function logInfo(scope: string, fields: Record<string, unknown>): void {
  writeLine("info", scope, fields);
}

export function logThrow(scope: string, error: unknown, extra: Record<string, unknown> = {}): void {
  logError(scope, { ...extra, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack ?? "" : "" });
}

export function closeLogStream(): void {
  // The logger uses per-line writes and has no open stream.
}

export const debug = {
  get enabled(): boolean {
    return debugOn();
  },
  get logFile(): string {
    return LOG_FILE;
  },
  event(scope: string, fields: Record<string, unknown>): void {
    if (!debugOn()) return;
    const body = Object.entries(fields).map(([key, value]) => `${key}=${fmt(value)}`).join(" ");
    void writeDebug(`${new Date().toISOString()} [${scope}] ${body}\n`);
  },
};
