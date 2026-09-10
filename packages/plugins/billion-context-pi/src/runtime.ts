import type { ExtensionContext, SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import {
  createCore,
  defaultCountTokens,
  defaultPrompts,
  type CompressionCore,
  type CompressionState,
  type Config,
  type Prompts,
} from "acp-kernel";
import { resolveCompress, resolveConfig, type AdapterConfig } from "./config.ts";
import { resolveReasoningDrop, type CompressReasoningConfig } from "./reasoning-drop.ts";
import { entriesToCoreMessages } from "./messages.ts";
import { SessionStateStore } from "./state.ts";
import { hasCompressHistory, rebuildStateFromLog } from "./state-rebuild.ts";
import { applyUserConfig, loadUserConfig, type UserAcpConfig, type UserAcpConfigKey } from "./user-config.ts";
import { ThrottleEpisode } from "./throttle-retry.ts";
import { OverflowEpisode } from "./overflow-selfheal.ts";
import { logInfo, logWarn, setDebugEnabled } from "./log.ts";

export const MAX_COMPRESS_ATTEMPTS = 3;

type AgentMessage = SessionMessageEntry["message"];

type SessionEntrySource = {
  buildContextEntries?: () => SessionEntry[];
};

export function readContextEntries(sessionManager: ExtensionContext["sessionManager"]): SessionEntry[] {
  const source = sessionManager as SessionEntrySource;
  return typeof source.buildContextEntries === "function" ? source.buildContextEntries() : [];
}

function pruneOrphanRefs(state: CompressionState, messages: ReturnType<typeof entriesToCoreMessages>): void {
  const retainedRawIds = new Set(messages.map((message) => message.id));
  for (const block of state.blocks) {
    for (const rawId of [...block.directMessageIds, ...block.effectiveMessageIds]) retainedRawIds.add(rawId);
  }
  for (const [rawId, ref] of Object.entries(state.messageRefs.byRaw)) {
    if (retainedRawIds.has(rawId)) continue;
    delete state.messageRefs.byRaw[rawId];
    if (state.messageRefs.byRef[ref] === rawId) delete state.messageRefs.byRef[ref];
  }
  for (const [ref, rawId] of Object.entries(state.messageRefs.byRef)) {
    if (!retainedRawIds.has(rawId)) delete state.messageRefs.byRef[ref];
  }
}

export interface AcpRuntime {
  core: CompressionCore;
  store: SessionStateStore;
  adapter: AdapterConfig;
  setAdapter(adapter: AdapterConfig): void;
  prompts: Prompts;
  setPrompts(prompts: Prompts): void;
  markNudgeShown(turnKey: string, tokenCount?: number): void;
  nudgeShownFor(turnKey: string): boolean;
  nudgeShownTokensFor(turnKey: string): number | undefined;
  clearNudgeTracking(): void;
  clearNudgeTokenStamps(): void;
  noteCompressOutcomes(turnKey: string, outcomes: ReadonlyArray<{ toolCallId: string; isError: boolean; success: boolean; noop?: boolean }>): { count: number; cappedNow: boolean };
  compressRetryCappedFor(turnKey: string): boolean;
  clearCompressRetryTracking(): void;
  liveContextLimit(ctx: ExtensionContext): number;
  configFor(ctx: ExtensionContext): Config;
  reasoningDropFor(ctx: ExtensionContext): Required<CompressReasoningConfig>;
  reloadConfig(cwd?: string): Promise<void>;
  stateFor(ctx: ExtensionContext, liveMessages?: AgentMessage[]): Promise<{ state: CompressionState; coreMessages: ReturnType<typeof entriesToCoreMessages>; entries: SessionEntry[] }>;
  save(state: CompressionState, ctx: ExtensionContext): Promise<void>;
  acquireLock(sid: string): Promise<() => void>;
  overflowFor(sid: string): OverflowEpisode;
  overflowDrop(sid: string): void;
  noteDeadCompress(sid: string, fingerprint: string): number;
  clearDeadCompress(sid: string): void;
  throttleFor(sid: string): ThrottleEpisode;
  throttleDrop(sid: string): void;
  noteTokenScale(sid: string, stale: boolean): boolean;
  dropTokenScale(sid: string): void;
}

export function createRuntime(adapter: AdapterConfig, protectedKeys: ReadonlySet<UserAcpConfigKey> = new Set()): AcpRuntime {
  const core = createCore({ countTokens: defaultCountTokens });
  const store = new SessionStateStore();
  const locks = new Map<string, Promise<void>>();
  let baseAdapter = adapter;
  let adapterRef = adapter;
  let configCwd = process.cwd();
  let lastUserConfigKey: string | undefined;
  let promptsRef: Prompts = defaultPrompts;
  const nudgeShownTurns = new Set<string>();
  const nudgeShownTokens = new Map<string, number>();
  const overflowEpisodes = new Map<string, OverflowEpisode>();
  const throttleEpisodes = new Map<string, ThrottleEpisode>();
  const tokenScaleStale = new Map<string, boolean>();
  const deadCompressCounts = new Map<string, Map<string, number>>();

  let compressFailTurnKey: string | null = null;
  let compressFailCount = 0;
  const compressOutcomeSeen = new Set<string>();

  function overflowFor(sid: string): OverflowEpisode {
    let episode = overflowEpisodes.get(sid);
    if (!episode) {
      episode = new OverflowEpisode();
      overflowEpisodes.set(sid, episode);
    }
    return episode;
  }

  function throttleFor(sid: string): ThrottleEpisode {
    let episode = throttleEpisodes.get(sid);
    if (!episode) {
      episode = new ThrottleEpisode();
      throttleEpisodes.set(sid, episode);
    }
    return episode;
  }

  function noteDeadCompress(sid: string, fingerprint: string): number {
    let counts = deadCompressCounts.get(sid);
    if (!counts) {
      counts = new Map();
      deadCompressCounts.set(sid, counts);
    }
    const next = (counts.get(fingerprint) ?? 0) + 1;
    counts.set(fingerprint, next);
    return next;
  }

  async function acquireLock(sid: string): Promise<() => void> {
    const previous = locks.get(sid) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = () => {
        locks.delete(sid);
        resolve();
      };
    });
    locks.set(sid, previous.then(() => next));
    await previous;
    return release;
  }

  function liveContextLimit(ctx: ExtensionContext): number {
    const usage = ctx.getContextUsage?.();
    if (usage?.contextWindow && usage.contextWindow > 0) return usage.contextWindow;
    const model = ctx.model as { contextWindow?: number } | undefined;
    return model?.contextWindow ?? 0;
  }

  function configFor(ctx: ExtensionContext): Config {
    const model = ctx.model as { provider?: string; id?: string } | undefined;
    return resolveConfig(adapterRef, liveContextLimit(ctx), model?.provider, model?.id);
  }

  function reasoningDropFor(ctx: ExtensionContext): Required<CompressReasoningConfig> {
    const model = ctx.model as { provider?: string; id?: string } | undefined;
    return resolveReasoningDrop(resolveCompress(adapterRef.compress, model?.provider, model?.id).reasoning);
  }

  async function reloadConfig(cwd?: string): Promise<void> {
    const effectiveCwd = typeof cwd === "string" && cwd.length > 0 ? cwd : configCwd;
    if (typeof cwd === "string" && cwd.length > 0) configCwd = cwd;
    let user: UserAcpConfig;
    try {
      user = await loadUserConfig(effectiveCwd);
    } catch (error) {
      logWarn("runtime", { event: "config-reload-failed", error: error instanceof Error ? error.message : String(error) });
      return;
    }
    const key = JSON.stringify(user);
    if (key === lastUserConfigKey) return;
    lastUserConfigKey = key;
    try {
      adapterRef = applyUserConfig(baseAdapter, user, protectedKeys);
      if (adapterRef.debug !== undefined) setDebugEnabled(adapterRef.debug);
      logInfo("runtime", { event: "config-reloaded", limit: adapterRef.modelContextLimit ?? null });
    } catch (error) {
      logWarn("runtime", { event: "config-reload-failed", error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function stateFor(ctx: ExtensionContext, _liveMessages?: AgentMessage[]) {
    const sessionManager = ctx.sessionManager;
    const sessionFile = sessionManager.getSessionFile() ?? undefined;
    const sessionId = sessionManager.getSessionId();
    let state = await store.load(sessionFile, sessionId);
    const entries = readContextEntries(sessionManager);

    if (sessionFile && state.blocks.length === 0 && hasCompressHistory(entries)) {
      const rebuilt = rebuildStateFromLog({ entries, state, config: configFor(ctx), core });
      if (rebuilt.report.blocks > 0) {
        state = rebuilt.state;
        await store.save(state, sessionFile, sessionId);
        logInfo("state", { sid: sessionId, event: "state-rebuilt", blocks: rebuilt.report.blocks, callsApplied: rebuilt.report.callsApplied, callsSkipped: rebuilt.report.callsSkipped });
      }
    }

    const coreMessages = entriesToCoreMessages(entries);
    pruneOrphanRefs(state, coreMessages);
    return { state, coreMessages, entries };
  }

  async function save(state: CompressionState, ctx: ExtensionContext): Promise<void> {
    const sessionManager = ctx.sessionManager;
    await store.save(state, sessionManager.getSessionFile() ?? undefined, sessionManager.getSessionId());
  }

  function noteCompressOutcomes(turnKey: string, outcomes: ReadonlyArray<{ toolCallId: string; isError: boolean; success: boolean; noop?: boolean }>): { count: number; cappedNow: boolean } {
    if (compressFailTurnKey !== turnKey) {
      compressFailTurnKey = turnKey;
      compressFailCount = 0;
    }
    const previous = compressFailCount;
    for (const outcome of outcomes) {
      if (compressOutcomeSeen.has(outcome.toolCallId)) continue;
      compressOutcomeSeen.add(outcome.toolCallId);
      if (outcome.isError || outcome.noop === true) compressFailCount++;
      else if (outcome.success) compressFailCount = 0;
    }
    return { count: compressFailCount, cappedNow: compressFailCount >= MAX_COMPRESS_ATTEMPTS && previous < MAX_COMPRESS_ATTEMPTS };
  }

  function clearNudgeTracking(): void {
    nudgeShownTurns.clear();
    nudgeShownTokens.clear();
  }

  function clearCompressRetryTracking(): void {
    compressOutcomeSeen.clear();
    compressFailTurnKey = null;
    compressFailCount = 0;
  }

  const runtime: AcpRuntime = {
    core,
    store,
    get adapter() { return adapterRef; },
    setAdapter(next) {
      baseAdapter = next;
      adapterRef = next;
    },
    get prompts() { return promptsRef; },
    setPrompts(next) { promptsRef = next; },
    markNudgeShown(turnKey, tokenCount) {
      nudgeShownTurns.add(turnKey);
      if (tokenCount !== undefined) nudgeShownTokens.set(turnKey, tokenCount);
    },
    nudgeShownFor: (turnKey) => nudgeShownTurns.has(turnKey),
    nudgeShownTokensFor: (turnKey) => nudgeShownTokens.get(turnKey),
    clearNudgeTracking,
    clearNudgeTokenStamps: () => nudgeShownTokens.clear(),
    noteCompressOutcomes,
    compressRetryCappedFor: (turnKey) => compressFailTurnKey === turnKey && compressFailCount >= MAX_COMPRESS_ATTEMPTS,
    clearCompressRetryTracking,
    liveContextLimit,
    configFor,
    reasoningDropFor,
    reloadConfig,
    stateFor,
    save,
    acquireLock,
    overflowFor,
    overflowDrop: (sid) => overflowEpisodes.delete(sid),
    noteDeadCompress,
    clearDeadCompress: (sid) => deadCompressCounts.delete(sid),
    throttleFor,
    throttleDrop: (sid) => {
      throttleEpisodes.get(sid)?.reset();
      throttleEpisodes.delete(sid);
    },
    noteTokenScale: (sid, stale) => {
      const previous = tokenScaleStale.get(sid);
      tokenScaleStale.set(sid, stale);
      return previous !== undefined && previous !== stale;
    },
    dropTokenScale: (sid) => tokenScaleStale.delete(sid),
  };
  return runtime;
}
