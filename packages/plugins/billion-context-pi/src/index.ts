import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionFactory, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import type { CompressionBlock, NudgeDecision, Prompts } from "acp-kernel";
import { defaultCountTokens, defaultPrompts, renderNudgeText, resolvePrompts, viableRanges } from "acp-kernel";
import type { AdapterConfig } from "./config.ts";
import type { UserAcpConfig } from "./user-config.ts";
import { createRuntime, type AcpRuntime } from "./runtime.ts";
import { makeCompressTool, isCompressNoopText, isCompressSuccessText } from "./compress-tool.ts";
import { makeDecompressTool } from "./decompress-tool.ts";
import { makeSearchTool } from "./search-tool.ts";
import { makeStatusTool } from "./status-tool.ts";
import { makeCommands } from "./commands.ts";
import { coreOutToAgentMessages, extractText } from "./messages.ts";
import { countThinkingChars, dropCompressReasoning } from "./reasoning-drop.ts";
import { collapseAssistantDegeneration, degenerationNotice, lastAssistantRuns, resolveDegenerationGuard } from "./degeneration.ts";
import { buildAcpSystemPrompt } from "./system-prompt.ts";
import { registerAcpChildExtension } from "./subagent-child-extension.ts";
import { wireToolGuardrails } from "./tool-guardrails.ts";
import { closeLogStream, debug, logInfo, logThrow, logWarn } from "./log.ts";
import { collectCoveredMessageIds, estimateTokens, lastUserMessageId, collectImageTokens, modelSupportsImages, sentViewTokenCount } from "./tokens.ts";
import { usageAnchorPredatesCompression } from "./floor-stale.ts";
import { checkForUpdate } from "./update.ts";
import { THROTTLE_KICK_TEXT, THROTTLE_RETRY_ERROR_MESSAGE, abortableSleep, isKickMessage, isThrottleError, resolveThrottleRetry, throttleDelayMs } from "./throttle-retry.ts";
import { applyOutputHeadroom, inspectOverflowMessage, resolveOutputHeadroomCap } from "./overflow-selfheal.ts";

type AgentMessage = SessionMessageEntry["message"];

declare const CURRENT_VERSION: string;

type DesktopAcpConfiguration = Pick<AdapterConfig, "debug" | "modelContextLimit" | "preserveRecentMessages" | "toolBashDefaultTimeout" | "toolOutputMaxBytes">;

interface HostConfigurableExtensionAPI extends ExtensionAPI {
  getConfig<T = DesktopAcpConfiguration>(): Readonly<T>;
}

export function createAcpExtension(adapter: AdapterConfig = {}): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    if (adapter.enabled === false || isUserConfigDisabled(process.cwd())) {
      console.log("[bcp] disabled: enabled=false — ACP tools and system prompt off; Pi's native context management is in control");
      return;
    }
    const hostApi = pi as Partial<HostConfigurableExtensionAPI>;
    const hostConfig = typeof hostApi.getConfig === "function" ? hostApi.getConfig<DesktopAcpConfiguration>() : {};
    const hostConfigKeys = desktopHostConfigKeys(hostConfig);
    const runtime = createRuntime({ ...adapter, ...hostConfig }, hostConfigKeys);
    registerAcpChildExtension(adapter.childExtensionPath ?? fileURLToPath(import.meta.url));
    wireCompactionDisable(pi);
    wireSessionLifecycle(pi, runtime);
    wireContextTransform(pi, runtime);
    wireSystemPrompt(pi, runtime);
    wireToolGuardrails(pi, runtime);
    wireOverflowSelfHeal(pi, runtime);
    wireThrottleRetry(pi, runtime);
    pi.registerTool(makeCompressTool(runtime));
    pi.registerTool(makeDecompressTool(runtime));
    pi.registerTool(makeSearchTool(runtime));
    pi.registerTool(makeStatusTool(runtime));
    for (const { name, options } of makeCommands(runtime)) pi.registerCommand(name, options);
  };
}

export default createAcpExtension();

export function isUserConfigDisabled(cwd: string): boolean {
  let enabled: boolean | undefined;
  for (const base of [join(homedir(), CONFIG_DIR_NAME), join(cwd, CONFIG_DIR_NAME)]) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(base, "acp.json"), "utf8"));
      if (parsed && typeof parsed === "object") {
        const value = (parsed as Record<string, unknown>).enabled;
        if (value === true || value === false) enabled = value;
      }
    } catch {
      // Missing or malformed config leaves the extension enabled.
    }
  }
  return enabled === false;
}

function desktopHostConfigKeys(config: DesktopAcpConfiguration): ReadonlySet<keyof UserAcpConfig> {
  const keys = new Set<keyof UserAcpConfig>();
  if (config.debug !== undefined) keys.add("debug");
  if (config.modelContextLimit !== undefined) keys.add("modelContextLimit");
  if (config.toolBashDefaultTimeout !== undefined) keys.add("toolBashDefaultTimeout");
  if (config.toolOutputMaxBytes !== undefined) keys.add("toolOutputMaxBytes");
  return keys;
}

function wireCompactionDisable(pi: ExtensionAPI): void {
  pi.on("session_before_compact", () => ({ cancel: true }));
}

function wireSessionLifecycle(pi: ExtensionAPI, runtime: AcpRuntime): void {
  pi.on("session_start", async (_event, ctx) => {
    const sid = ctx.sessionManager.getSessionId();
    runtime.store.invalidate();
    runtime.clearNudgeTracking();
    runtime.clearCompressRetryTracking();
    runtime.throttleFor(sid).reset();
    runtime.dropTokenScale(sid);
    try {
      await runtime.reloadConfig(ctx.cwd);
      runtime.setPrompts(resolvePrompts(runtime.adapter.prompts, { acknowledgeRisk: runtime.adapter.acknowledgePromptsRisk === true }));
    } catch (error) {
      runtime.setPrompts(defaultPrompts);
      logThrow("config", error, { sid, phase: "session_start" });
    }
    const model = ctx.model as { id?: string; contextWindow?: number; api?: string } | undefined;
    logInfo("session", { event: "start", sid, cwd: ctx.cwd, version: typeof CURRENT_VERSION !== "undefined" ? CURRENT_VERSION : null, model: model?.id ?? null, modelApi: model?.api ?? null, contextWindow: model?.contextWindow ?? null });
    const updateCheck = checkForUpdate(runtime.adapter.autoUpdate ?? true, (message) => {
      if (ctx.hasUI) ctx.ui.notify(message);
    });
    if (!ctx.hasUI) await updateCheck;
  });
  pi.on("session_shutdown", (_event, ctx) => {
    const sid = ctx.sessionManager.getSessionId();
    runtime.clearDeadCompress(sid);
    runtime.overflowDrop(sid);
    runtime.throttleDrop(sid);
    runtime.dropTokenScale(sid);
    closeLogStream();
  });
}

let lastDegNoticeKey: string | null = null;

function wireContextTransform(pi: ExtensionAPI, runtime: AcpRuntime): void {
  pi.on("context", async (event, ctx) => {
    const sid = ctx.sessionManager.getSessionId();
    const release = await runtime.acquireLock(sid);
    try {
      await runtime.reloadConfig(ctx.cwd);
      const { state, coreMessages, entries } = await runtime.stateFor(ctx, event.messages as AgentMessage[]);
      const configBase = runtime.configFor(ctx);
      const modelId = (ctx.model as { id?: string } | undefined)?.id ?? "default";
      const overflow = runtime.overflowFor(sid);
      let config = configBase;
      const learnedWindow = overflow.learnedWindowFor(modelId);
      if (learnedWindow && learnedWindow > 0 && learnedWindow < config.modelContextLimit) {
        config = { ...config, modelContextLimit: learnedWindow };
        logInfo("overflow-selfheal", { sid, modelId, event: "window-recenter", resolved: configBase.modelContextLimit, learned: learnedWindow });
      }
      const fullWindow = config.modelContextLimit;
      config = applyOutputHeadroom(config, ctx.model, resolveOutputHeadroomCap(runtime.adapter.outputHeadroomMaxPct));
      const realUsage = ctx.getContextUsage?.();
      const systemPromptTokens = defaultCountTokens(buildAcpSystemPrompt(runtime.prompts));
      const imageTokens = collectImageTokens(entries, modelSupportsImages(ctx.model));
      const sentTokens = estimateTokens(coreMessages, collectCoveredMessageIds(state), imageTokens) + systemPromptTokens;
      let armedFloor = 0;
      if (overflow.armed && config.modelContextLimit > 0) {
        overflow.armed = false;
        armedFloor = Math.floor(config.modelContextLimit * 0.95);
        logWarn("overflow-selfheal", { sid, event: "armed-emergency", floor: armedFloor, limit: config.modelContextLimit });
      }
      const anchorStale = usageAnchorPredatesCompression(entries);
      const hostFloorActive = !anchorStale;
      const floor = (base: number): number => Math.max(base, hostFloorActive ? realUsage?.tokens ?? 0 : 0, armedFloor);
      let tokenCount = floor(sentTokens);
      if (state.blocks.some((block) => block.active && block.effectiveMessageIds.length > 0)) {
        const view = sentViewTokenCount(runtime.core, coreMessages, state, config, tokenCount, imageTokens, systemPromptTokens);
        if (view.drifted) tokenCount = floor(view.viewTokens);
      }
      if (runtime.noteTokenScale(sid, !hostFloorActive)) {
        state.nudge.lastNudgeShownTokens = 0;
        state.nudge.lastPerMessageNudgeTokens = 0;
        state.nudge.lastShownByTier = {};
        runtime.clearNudgeTokenStamps();
        logInfo("growth-scale", { sid, event: "scale-flip-reset", anchorStale: !hostFloorActive });
      }

      debug.event("context-in", { sid, modelId, eventMsgs: event.messages?.length ?? 0, entries: entries.length, coreMsgs: coreMessages.length, tokenCount, sessionTokens: realUsage?.tokens ?? null, limit: config.modelContextLimit, blocksBefore: state.blocks.length, activeBefore: state.blocks.filter((block) => block.active).length });
      const turn = runtime.core.processTurn({ messages: coreMessages, state, config, tokenCount });
      await runtime.save(turn.state, ctx);
      logInfo("turn", { sid, model: modelId, inMsgs: coreMessages.length, outMsgs: turn.messages.length, tokens: tokenCount, pct: config.modelContextLimit > 0 ? Number(((tokenCount / config.modelContextLimit) * 100).toFixed(2)) : null, limit: config.modelContextLimit, ...(fullWindow !== config.modelContextLimit ? { fullWindow } : {}), nudge: turn.nudge?.shouldInject ? turn.nudge.breakdown?.emergencyOverride === 1 ? "emergency" : "active" : "idle", nudgeReason: turn.nudge?.reason ?? null, blocks: turn.state.blocks.length, activeBlocks: turn.state.blocks.filter((block) => block.active).length, hostTokens: realUsage?.tokens ?? null, hostPct: realUsage?.percent ?? null });

      const originalById = collectOriginals(entries);
      let rebuilt = coreOutToAgentMessages(turn.messages, originalById);
      const reasoningDrop = runtime.reasoningDropFor(ctx);
      const droppedThinking = dropCompressReasoning(rebuilt, reasoningDrop);
      if (droppedThinking !== rebuilt) {
        debug.event("reasoning-drop", { sid, droppedChars: countThinkingChars(rebuilt) - countThinkingChars(droppedThinking), threshold: reasoningDrop.threshold });
        rebuilt = droppedThinking;
      }

      const degenerationConfig = resolveDegenerationGuard(runtime.adapter.degenerationGuard);
      const tailRuns = degenerationConfig.enabled ? lastAssistantRuns([...originalById.values()], degenerationConfig.minRun) : null;
      const degeneration = collapseAssistantDegeneration(rebuilt, degenerationConfig);
      if (degeneration.messages !== rebuilt) {
        rebuilt = degeneration.messages;
        const maxRun = degeneration.evidence.reduce((max, evidence) => evidence.runs.reduce((inner, run) => Math.max(inner, run.count), max), 0);
        logWarn("degeneration", { sid, event: "runs-collapsed", msgs: degeneration.evidence.length, maxRun, minRun: degenerationConfig.minRun });
      }
      if (tailRuns) {
        rebuilt.push(degenerationNotice(tailRuns));
        const top = [...tailRuns].sort((a, b) => b.count - a.count)[0]!;
        const key = `${sid}:${top.count}:${top.char.codePointAt(0)}`;
        if (ctx.hasUI && lastDegNoticeKey !== key) {
          lastDegNoticeKey = key;
          ctx.ui.notify(`[ACP] previous turn ended in degenerate generation (${top.count}x repeat) — the repeated segment was truncated above and a recovery notice was injected.`);
        }
      }

      const turnKey = lastUserMessageId(entries) ?? sid;
      const outcomes = collectCompressOutcomes(entries, turnStartIndex(entries));
      const outcome = outcomes.length > 0 ? runtime.noteCompressOutcomes(turnKey, outcomes) : null;
      const adaptiveGrowth = !config.modelContextLimit || config.modelContextLimit <= 0 ? config.nudge.growthFloor : Math.min(config.nudge.growthCap, Math.max(config.nudge.growthFloor, Math.round(config.modelContextLimit * config.nudge.growthRatio)));
      const reInjectFloor = Math.max(config.nudge.minGrowthFloor, config.nudge.minGrowthRatio * adaptiveGrowth);
      let shownAt = runtime.nudgeShownTokensFor(turnKey);
      if (shownAt !== undefined && tokenCount < shownAt - adaptiveGrowth) {
        shownAt = tokenCount;
        runtime.markNudgeShown(turnKey, tokenCount);
      }

      if (turn.nudge?.shouldInject) {
        const emergency = turn.nudge.breakdown?.emergencyOverride === 1;
        turn.nudge.compressibleRanges = viableRanges(turn.nudge.compressibleRanges);
        const retryCapped = runtime.compressRetryCappedFor(turnKey);
        const reInjectReady = shownAt === undefined || tokenCount - shownAt >= reInjectFloor;
        const alreadyShown = retryCapped || (!emergency && runtime.nudgeShownFor(turnKey) && !reInjectReady);
        if (!alreadyShown) {
          rebuilt.push(nudgeMessage(turn.nudge, turn.state.blocks.filter((block) => block.active), runtime.prompts));
          const rendered = renderNudgeText(turn.nudge, runtime.prompts);
          const top = [...turn.nudge.compressibleRanges].sort((a, b) => b.tokens - a.tokens)[0];
          const example = top ? `\n\nExample: compress({ content: [{ startId: "${top.startRef}", endId: "${top.endRef}", summary: "..." }] })` : "";
          if (debug.enabled && ctx.hasUI) ctx.ui.notify(`[ACP nudge → context]${emergency ? " [EMERGENCY]" : ""}\n${rendered.text}${example}`);
          if (!emergency) runtime.markNudgeShown(turnKey, tokenCount);
          debug.event("nudge-injected", { sid, voice: rendered.voice, emergency, turnKey, reInject: shownAt !== undefined, text: rendered.text + example });
        }
      }
      if (outcome?.cappedNow && ctx.hasUI) ctx.ui.notify(`[ACP] compress failed ${outcome.count}x this turn — nudge paused until the next user message.`);
      debug.event("context-out", { outMsgs: rebuilt.length, injected: turn.nudge?.shouldInject ?? false, emergency: turn.nudge?.breakdown?.emergencyOverride === 1 });
      const updateCheck = checkForUpdate(runtime.adapter.autoUpdate ?? true, (message) => {
        if (ctx.hasUI) ctx.ui.notify(message);
      });
      if (!ctx.hasUI) await updateCheck;
      return { messages: rebuilt };
    } catch (error) {
      logThrow("context", error, { sid, phase: "transform" });
      throw error;
    } finally {
      release();
    }
  });
}

function wireSystemPrompt(pi: ExtensionAPI, runtime: AcpRuntime): void {
  pi.on("before_agent_start", (event) => ({ systemPrompt: `${event.systemPrompt}\n\n${buildAcpSystemPrompt(runtime.prompts)}` }));
}

function wireOverflowSelfHeal(pi: ExtensionAPI, runtime: AcpRuntime): void {
  pi.on("message_end", (event, ctx) => {
    const message = event.message;
    if (message.role !== "assistant" || message.stopReason !== "error") return;
    const info = inspectOverflowMessage(`${message.errorMessage ?? ""}\n${extractText(message.content)}`);
    if (!info.isOverflow) return;
    const sid = ctx.sessionManager.getSessionId();
    const modelId = (ctx.model as { id?: string } | undefined)?.id ?? "default";
    const episode = runtime.overflowFor(sid);
    if (info.window) episode.setLearnedWindow(modelId, info.window);
    episode.armed = true;
    logWarn("overflow-selfheal", { sid, modelId, event: "detected", window: info.window ?? null, message: info.message.slice(0, 200) });
    if (ctx.hasUI) ctx.ui.notify(`[ACP] context overflow detected${info.window ? ` (window ${info.window})` : ""} — forcing emergency compression next turn`);
  });
}

function wireThrottleRetry(pi: ExtensionAPI, runtime: AcpRuntime): void {
  pi.on("message_end", (event, ctx) => {
    const episode = runtime.throttleFor(ctx.sessionManager.getSessionId());
    const message = event.message;
    if (message.role === "user") {
      episode.onUserMessage(isKickMessage(message));
      return;
    }
    if (message.role !== "assistant") return;
    if (message.stopReason !== "error") {
      episode.onProgress();
      return;
    }
    if (!isThrottleError(message)) {
      episode.onNonThrottleError();
      return;
    }
    const config = resolveThrottleRetry(runtime.adapter.throttleRetry);
    if (!config.enabled) {
      episode.onNonThrottleError();
      return;
    }
    const decision = episode.onThrottleError(config.maxRetries);
    if (decision === "exhausted") {
      if (ctx.hasUI) ctx.ui.notify(`[ACP] provider throttled — retry budget exhausted (${config.maxRetries}); surfacing error`);
      return;
    }
    if (ctx.hasUI) ctx.ui.notify(`[ACP] provider throttled — retry ${episode.state.attempts}/${config.maxRetries} (fast probe)`);
    return { message: { ...message, errorMessage: THROTTLE_RETRY_ERROR_MESSAGE } };
  });
  pi.on("agent_settled", async (_event, ctx) => {
    const episode = runtime.throttleFor(ctx.sessionManager.getSessionId());
    const config = resolveThrottleRetry(runtime.adapter.throttleRetry);
    if (!config.enabled || !episode.readyToKick(config.maxRetries)) return;
    const kickNumber = episode.state.kicks + 1;
    const delayMs = throttleDelayMs(kickNumber, config);
    episode.onKickStarted();
    if (ctx.hasUI) ctx.ui.notify(`[ACP] provider throttled — waiting ${Math.round(delayMs / 1000)}s before retry ${episode.state.attempts + 1}/${config.maxRetries}`);
    const result = await abortableSleep(delayMs, episode.sleepController().signal);
    if (result === "aborted") {
      episode.onKickCancelled();
      if (ctx.hasUI) ctx.ui.notify("[ACP] throttle retry cancelled (user input received)");
      return;
    }
    if (episode.readyToKick(config.maxRetries)) pi.sendUserMessage(THROTTLE_KICK_TEXT);
  });
  pi.on("input", (event, ctx) => {
    if (event.source !== "extension") runtime.throttleFor(ctx.sessionManager.getSessionId()).cancelSleep();
  });
}

function collectOriginals(entries: Array<{ type: string; id: string; message?: AgentMessage; content?: unknown }>): Map<string, AgentMessage> {
  const map = new Map<string, AgentMessage>();
  for (const entry of entries) {
    if (entry.type === "message" && entry.message) map.set(entry.id, entry.message);
    else if (entry.type === "custom_message") {
      const content = typeof entry.content === "string" ? [{ type: "text" as const, text: entry.content }] : entry.content;
      map.set(entry.id, { role: "user", content } as AgentMessage);
    }
  }
  return map;
}

function turnStartIndex(entries: Array<{ type: string; message?: { role?: string } }>): number {
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i]!.message?.role === "user") return i;
  return -1;
}

function collectCompressOutcomes(entries: Array<{ type: string; message?: AgentMessage }>, startIndex: number): Array<{ toolCallId: string; isError: boolean; success: boolean; noop: boolean }> {
  const out: Array<{ toolCallId: string; isError: boolean; success: boolean; noop: boolean }> = [];
  for (let i = Math.max(startIndex, -1) + 1; i < entries.length; i++) {
    const entry = entries[i];
    if (entry?.type !== "message" || !entry.message) continue;
    const message = entry.message as { role?: string; toolName?: string; toolCallId?: string; isError?: boolean; content?: unknown };
    if (message.role !== "toolResult" || message.toolName !== "compress" || !message.toolCallId) continue;
    const text = extractText(message.content);
    out.push({ toolCallId: message.toolCallId, isError: message.isError === true, success: message.isError !== true && isCompressSuccessText(text), noop: message.isError !== true && isCompressNoopText(text) });
  }
  return out;
}

function nudgeMessage(nudge: NudgeDecision, blocks: CompressionBlock[], prompts: Prompts): AgentMessage {
  const rendered = renderNudgeText(nudge, prompts);
  const lines = [rendered.text];
  if (blocks.length > 0) {
    const totalSummary = blocks.reduce((sum, block) => sum + Math.ceil((block.summary || "").length / 4), 0);
    const totalCompressed = blocks.reduce((sum, block) => sum + (block.compressedTokens || 0), 0);
    const format = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(value);
    const tierCounts: Record<number, number> = {};
    for (const block of blocks) {
      const tier = block.tier ?? 1;
      tierCounts[tier] = (tierCounts[tier] || 0) + 1;
    }
    const tierText = Object.keys(tierCounts).map(Number).sort().map((tier) => `T${tier}:${tierCounts[tier]}`).join(" ");
    const ids = blocks.slice(0, 10).map((block) => block.blockId).join(", ");
    const extra = blocks.length > 10 ? ` (+${blocks.length - 10} more)` : "";
    lines.push("", `Compressed blocks: ${blocks.length} active (${tierText}) — ${format(totalSummary)} summary, ${format(totalCompressed)} original compressed. Blocks: ${ids}${extra}.`);
  }
  return { role: "user", content: [{ type: "text", text: lines.join("\n") }], timestamp: Date.now() } as AgentMessage;
}
