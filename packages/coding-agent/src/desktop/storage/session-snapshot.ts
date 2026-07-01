/**
 * 从 Pi canonical JSONL session 重建 desktop 最小 snapshot。
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	SessionManager,
	type ModelChangeEntry,
	type SessionEntry,
	type SessionInfoEntry,
	type ThinkingLevelChangeEntry,
} from "../../core/session-manager.ts";
import type { ThreadSnapshot, DesktopMessage } from "../protocol/snapshot.ts";
import type { DesktopThinkingLevel } from "../protocol/model.ts";
import type { ThreadSummary } from "../protocol/thread.ts";

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
	const manager = SessionManager.open(input.sessionFile, undefined, input.cwdOverride ?? input.thread.cwd);
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
		messages: context.messages.map((message, index) => toDesktopMessage(message, index)),
		toolCalls: [],
		fileChanges: [],
		approvals: [],
		queue: { steering: [], followUp: [] },
		diagnostics: [],
	};
}

/**
 * 将字符串 thinking level 归一化为有效的 DesktopThinkingLevel。
 * @param value - 原始 thinking level 字符串。
 * @returns 归一化后的 thinking level。
 */
function normalizeThinkingLevel(value: string | undefined): DesktopThinkingLevel {
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
 * 将 AgentMessage 转换为 DesktopMessage。
 * @param message - 原始 agent 消息。
 * @param index - 消息索引，用于生成 ID。
 * @returns Desktop 消息对象。
 */
function toDesktopMessage(message: AgentMessage, index: number): DesktopMessage {
	return {
		id: `message-${index}`,
		role: mapRole(message.role),
		text: hasContent(message) ? extractText(message.content) : undefined,
		createdAt: typeof message.timestamp === "number" ? new Date(message.timestamp).toISOString() : undefined,
	};
}

/**
 * 映射消息角色到 desktop 消息角色。
 * @param role - 原始角色。
 * @returns Desktop 消息角色。
 */
function mapRole(role: AgentMessage["role"]): DesktopMessage["role"] {
	if (role === "assistant") {
		return role;
	}
	return "user";
}

/**
 * 判断消息是否包含 content 字段。
 * @param message - 原始消息。
 * @returns 是否包含 content。
 */
function hasContent(message: AgentMessage): message is AgentMessage & { content: unknown } {
	return "content" in message;
}

/**
 * 从消息内容中提取文本。
 * @param content - 消息内容。
 * @returns 提取的文本字符串，若不存在则返回 undefined。
 */
function extractText(content: unknown): string | undefined {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return undefined;
	}
	const text = content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("");
	return text || undefined;
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
