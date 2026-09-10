import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createInitialState, type CompressionState } from "acp-kernel";
import { logError, logInfo, logWarn } from "./log.ts";

const STATE_SUFFIX = ".acp.json";

export interface LiveRefOrigin {
  rawId: string;
  identity: string;
}

interface StateCacheSlot {
  state: CompressionState;
  liveRefOrigins: LiveRefOrigin[];
}

function stateFileFor(sessionFile: string | undefined): string | null {
  return sessionFile ? sessionFile + STATE_SUFFIX : null;
}

export async function readParentSessionPath(sessionFile: string): Promise<string | undefined> {
  try {
    const handle = await fs.open(sessionFile, "r");
    try {
      const buffer = Buffer.alloc(65536);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead === 0) return undefined;
      const firstLine = buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0] ?? "";
      if (!firstLine.startsWith("{")) return undefined;
      const header = JSON.parse(firstLine) as { parentSession?: unknown };
      return typeof header.parentSession === "string" ? header.parentSession : undefined;
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") logWarn("state", { event: "read-parent-header-failed", file: sessionFile, error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

function cacheKey(sessionFile: string | undefined, sessionId: string): string {
  return sessionFile ? `file:${sessionFile}` : `session:${sessionId}`;
}

export class SessionStateStore {
  private cache = new Map<string, StateCacheSlot>();

  async load(sessionFile: string | undefined, sessionId: string): Promise<CompressionState> {
    const file = stateFileFor(sessionFile);
    const key = cacheKey(sessionFile, sessionId);
    const cached = this.cache.get(key);
    if (cached) return cached.state;

    let state = createInitialState();
    let liveRefOrigins: LiveRefOrigin[] = [];
    if (file) {
      try {
        const raw = await fs.readFile(file, "utf8");
        const parsed = JSON.parse(raw) as CompressionState & { liveRefOrigins?: unknown };
        if (parsed && Array.isArray(parsed.blocks)) {
          state = mergeInitialState(parsed);
          liveRefOrigins = parseLiveRefOrigins(parsed.liveRefOrigins);
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") logWarn("state", { event: "load-failed", file, error: error instanceof Error ? error.message : String(error) });
      }
      if (state.blocks.length === 0 && sessionFile) {
        const parentState = await this.tryLoadParentState(sessionFile);
        if (parentState) state = parentState;
      }
    }
    this.cache.set(key, { state, liveRefOrigins });
    return state;
  }

  async save(state: CompressionState, sessionFile: string | undefined, sessionId: string): Promise<void> {
    const file = stateFileFor(sessionFile);
    const key = cacheKey(sessionFile, sessionId);
    const liveRefOrigins = this.cache.get(key)?.liveRefOrigins ?? [];
    this.cache.set(key, { state, liveRefOrigins });
    if (!file) return;

    const dir = path.dirname(file);
    await fs.mkdir(dir, { recursive: true }).catch((error: unknown) => {
      logError("state", { event: "save-mkdir-failed", dir, error: error instanceof Error ? error.message : String(error) });
    });
    const tmp = path.join(dir, `.acp-tmp-${path.basename(file)}`);
    try {
      await fs.writeFile(tmp, JSON.stringify({ ...state, liveRefOrigins }), "utf8");
      await fs.rename(tmp, file);
    } catch (error) {
      logError("state", { event: "save-failed", file, error: error instanceof Error ? error.message : String(error) });
    }
  }

  getLiveRefOrigins(sessionFile: string | undefined, sessionId: string): LiveRefOrigin[] {
    return [...(this.cache.get(cacheKey(sessionFile, sessionId))?.liveRefOrigins ?? [])];
  }

  setLiveRefOrigins(sessionFile: string | undefined, sessionId: string, origins: LiveRefOrigin[]): void {
    const key = cacheKey(sessionFile, sessionId);
    const slot = this.cache.get(key);
    if (slot) this.cache.set(key, { state: slot.state, liveRefOrigins: [...origins] });
  }

  invalidate(): void {
    this.cache.clear();
  }

  private async tryLoadParentState(sessionFile: string): Promise<CompressionState | undefined> {
    const maxDepth = 8;
    let current = sessionFile;
    for (let depth = 0; depth < maxDepth; depth++) {
      const parentJsonl = await readParentSessionPath(current);
      if (!parentJsonl) return undefined;
      const parentAcp = stateFileFor(parentJsonl);
      if (!parentAcp) return undefined;
      try {
        const raw = await fs.readFile(parentAcp, "utf8");
        const parsed = JSON.parse(raw) as CompressionState;
        if (parsed && Array.isArray(parsed.blocks) && parsed.blocks.length > 0) {
          logInfo("state", { event: "inherited-parent-state", file: parentAcp, depth, blocks: parsed.blocks.length, tokensCompressed: parsed.stats?.tokensCompressed ?? 0 });
          return mergeInitialState(parsed);
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          logWarn("state", { event: "parent-state-load-failed", file: parentAcp, error: error instanceof Error ? error.message : String(error) });
          return undefined;
        }
      }
      current = parentJsonl;
    }
    logWarn("state", { event: "parent-chain-exhausted", file: sessionFile, maxDepth });
    return undefined;
  }
}

function parseLiveRefOrigins(value: unknown): LiveRefOrigin[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is LiveRefOrigin => {
    if (!item || typeof item !== "object") return false;
    const origin = item as { rawId?: unknown; identity?: unknown };
    return typeof origin.rawId === "string" && typeof origin.identity === "string";
  });
}

function mergeInitialState(parsed: CompressionState): CompressionState {
  const fresh = createInitialState();
  return {
    blocks: parsed.blocks ?? fresh.blocks,
    messageRefs: parsed.messageRefs ?? fresh.messageRefs,
    tokenSnapshot: parsed.tokenSnapshot ?? fresh.tokenSnapshot,
    nudge: { ...fresh.nudge, ...(parsed.nudge ?? {}) },
    stats: { ...fresh.stats, ...(parsed.stats ?? {}) },
    nextBlockId: parsed.nextBlockId ?? fresh.nextBlockId,
    nextRunId: parsed.nextRunId ?? fresh.nextRunId,
  };
}
