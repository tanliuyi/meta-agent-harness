/**
 * 从 Pi canonical JSONL session 重建 desktop 最小 snapshot。
 */

import {
	SessionManager,
	type ModelChangeEntry,
	type SessionEntry,
	type SessionInfoEntry,
	type ThinkingLevelChangeEntry,
} from "../../core/session-manager.ts";
import type { ThreadSnapshot } from "../protocol/snapshot.ts";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ThreadSummary } from "../protocol/thread.ts";
import { toDesktopFileChanges, toDesktopMessages, toDesktopToolCalls } from "../protocol/message.ts";

/**
 * 从 session 文件构建 snapshot 所需的输入。
 */
export interface BuildSnapshotFromSessionInput {
	/** Thread 摘要。 */
	thread: ThreadSummary;
	/** Session 文件路径。 */
	sessionFile: string;
	/** 可选的工作目录覆盖。 */
	cwdOverride?: string;
}

/**
 * 根据 session 文件构建 desktop thread snapshot。
 * @param input - 构建输入。
 * @returns 重建后的 thread snapshot。
 */
export function buildSnapshotFromSession(input: BuildSnapshotFromSessionInput): ThreadSnapshot {
	const manager = SessionManager.open(input.sessionFile, undefined, input.cwdOverride);
	const header = manager.getHeader();
	const context = manager.buildSessionContext();
	const entries = manager.getEntries();
	const title = findLastEntry(entries, isSessionInfoEntry)?.name ?? input.thread.title;
	const modelEntry = findLastEntry(entries, isModelChangeEntry);
	const thinkingEntry = findLastEntry(entries, isThinkingLevelChangeEntry);
	return {
		threadId: input.thread.threadId,
		cwd: header?.cwd || input.thread.cwd,
		sessionFile: input.sessionFile,
		title,
		status: input.thread.status,
		model: modelEntry ? { provider: modelEntry.provider, id: modelEntry.modelId } : undefined,
		thinkingLevel: normalizeThinkingLevel(thinkingEntry?.thinkingLevel ?? context.thinkingLevel),
		messages: toDesktopMessages(context.messages),
		toolCalls: toDesktopToolCalls(context.messages, input.thread.threadId),
		fileChanges: toDesktopFileChanges(context.messages, input.thread.threadId),
		approvals: [],
		queue: { steering: [], followUp: [] },
		diagnostics: [],
	};
}

/**
 * 将字符串 thinking level 归一化为 Pi ThinkingLevel。
 * @param value - 原始 thinking level 字符串。
 * @returns 归一化后的 thinking level。
 */
function normalizeThinkingLevel(value: string | undefined): ThinkingLevel {
	switch (value) {
		case "minimal":
		case "low":
		case "medium":
		case "high":
		case "xhigh":
			return value;
		default:
			return "off";
	}
}

/**
 * 判断 entry 是否为 session 信息 entry。
 */
function isSessionInfoEntry(entry: SessionEntry): entry is SessionInfoEntry {
	return entry.type === "session_info";
}

/**
 * 判断 entry 是否为模型切换 entry。
 */
function isModelChangeEntry(entry: SessionEntry): entry is ModelChangeEntry {
	return entry.type === "model_change";
}

/**
 * 判断 entry 是否为 thinking level 切换 entry。
 */
function isThinkingLevelChangeEntry(entry: SessionEntry): entry is ThinkingLevelChangeEntry {
	return entry.type === "thinking_level_change";
}

/**
 * 从 entries 中查找最后一个匹配谓词的 entry。
 * @param entries - entry 数组。
 * @param predicate - 类型谓词。
 * @returns 匹配的 entry 或 undefined。
 */
function findLastEntry<T, U extends T>(entries: readonly T[], predicate: (entry: T) => entry is U): U | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index]!;
		if (predicate(entry)) {
			return entry;
		}
	}
	return undefined;
}
