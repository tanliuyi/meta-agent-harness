/**
 * 从 Pi canonical JSONL session 重建 desktop 最小 snapshot。
 */

import {
	SessionManager,
	type ModelChangeEntry,
	type SessionEntry,
	type SessionInfoEntry,
	type SessionTreeNode,
	type ThinkingLevelChangeEntry,
} from "../agent-runtime/index.ts";
import type { DesktopSessionTreeNode, ThreadSnapshot } from "../protocol/snapshot.ts";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ThreadSummary } from "../protocol/thread.ts";
import {
	isRenderableConversationMessage,
	toDesktopFileChanges,
	toDesktopMessages,
	toDesktopToolCalls,
} from "../protocol/message.ts";

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
		messages: attachSessionEntryIds(toDesktopMessages(context.messages), manager.getBranch()),
		sessionTree: toDesktopSessionTree(manager.getTree()),
		currentEntryId: manager.getLeafId(),
		toolCalls: toDesktopToolCalls(context.messages, input.thread.threadId),
		fileChanges: toDesktopFileChanges(context.messages, input.thread.threadId),
		approvals: [],
		queue: { steering: [], followUp: [] },
		diagnostics: [],
	};
}

/**
 * Desktop 初始 snapshot 和单次懒加载返回的 session tree 深度。
 * 保持较浅，避免 Electron contextBridge 传递深层嵌套对象，也减少 renderer 初始 diff 开销。
 */
const MAX_DESKTOP_SESSION_TREE_DEPTH = 3

/**
 * 将 Pi SessionManager tree 转为 desktop-safe tree。
 * @param nodes - Pi session tree nodes。
 * @param maxDepth - 最大递归深度。
 * @param currentDepth - 当前递归深度。
 * @returns desktop session tree nodes。
 */
export function toDesktopSessionTree(
  nodes: SessionTreeNode[],
  maxDepth = MAX_DESKTOP_SESSION_TREE_DEPTH,
  currentDepth = 0
): DesktopSessionTreeNode[] {
  if (currentDepth > maxDepth) {
    return []
  }
  return nodes.map((node) => {
    const hasChildren = node.children.length > 0
    const children = currentDepth >= maxDepth ? [] : toDesktopSessionTree(node.children, maxDepth, currentDepth + 1)
    return {
      id: node.entry.id,
      parentId: node.entry.parentId,
      type: node.entry.type,
      timestamp: node.entry.timestamp,
      title: buildEntryTitle(node.entry),
      summary: buildEntrySummary(node.entry),
      label: node.label,
      labelTimestamp: node.labelTimestamp,
      hasMoreChildren: currentDepth >= maxDepth && hasChildren,
      children
    }
  })
}

/**
 * 从完整 session tree 中取指定节点的子树切片。
 * @param roots - 完整 session tree roots。
 * @param parentId - 父节点 ID；null 表示 roots。
 * @param maxDepth - 返回深度。
 * @returns desktop-safe session tree nodes。
 */
export function toDesktopSessionTreeChildren(
  roots: SessionTreeNode[],
  parentId: string | null,
  maxDepth = MAX_DESKTOP_SESSION_TREE_DEPTH
): DesktopSessionTreeNode[] {
  if (parentId === null) {
    return toDesktopSessionTree(roots, maxDepth)
  }
  const parent = findSessionTreeNode(roots, parentId)
  return parent ? toDesktopSessionTree(parent.children, maxDepth) : []
}

function findSessionTreeNode(nodes: SessionTreeNode[], id: string): SessionTreeNode | undefined {
  const stack = [...nodes]
  while (stack.length > 0) {
    const node = stack.shift()!
    if (node.entry.id === id) {
      return node
    }
    stack.unshift(...node.children)
  }
  return undefined
}

/**
 * 将当前 branch 上的 message entry ID 附加到可渲染 desktop messages。
 * @param messages - 已转换的 desktop messages。
 * @param branchEntries - 当前 leaf 到 root 的 entry 路径。
 * @returns 带 sessionEntryId 的 desktop messages。
 */
function attachSessionEntryIds(messages: ThreadSnapshot["messages"], branchEntries: SessionEntry[]): ThreadSnapshot["messages"] {
	const messageEntryIds = branchEntries.flatMap((entry) => {
		if (entry.type !== "message" || !isRenderableConversationMessage(entry.message)) {
			return [];
		}
		return [entry.id];
	});
	let index = 0;
	return messages.map((message) => {
		if (message.role !== "user" && message.role !== "assistant") {
			return message;
		}
		const sessionEntryId = messageEntryIds[index++];
		return sessionEntryId ? { ...message, sessionEntryId } : message;
	});
}

function buildEntryTitle(entry: SessionEntry): string {
	switch (entry.type) {
		case "message":
			return `${entry.message.role}: ${truncateText(extractMessageText(entry.message), 48) || "message"}`;
		case "thinking_level_change":
			return `thinking: ${entry.thinkingLevel}`;
		case "model_change":
			return `model: ${entry.provider}/${entry.modelId}`;
		case "compaction":
			return "compaction";
		case "branch_summary":
			return "branch summary";
		case "custom":
			return `custom: ${entry.customType}`;
		case "custom_message":
			return `custom message: ${entry.customType}`;
		case "label":
			return entry.label ? `label: ${entry.label}` : "label removed";
		case "session_info":
			return entry.name ? `session: ${entry.name}` : "session info";
	}
	return "entry";
}

/**
 * 构建 session tree entry 摘要。
 * @param entry - Pi session entry。
 * @returns 摘要。
 */
function buildEntrySummary(entry: SessionEntry): string | undefined {
	switch (entry.type) {
		case "message":
			return truncateText(extractMessageText(entry.message), 120) || undefined;
		case "compaction":
		case "branch_summary":
			return truncateText(entry.summary, 120);
		case "label":
			return entry.targetId;
		default:
			return undefined;
	}
}

/**
 * 提取消息文本。
 * @param message - Agent message。
 * @returns 文本。
 */
function extractMessageText(message: unknown): string {
	if (!isRecord(message)) {
		return "";
	}
	const content = message.content;
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.map((part) => {
			if (!isRecord(part)) {
				return "";
			}
			if (typeof part.text === "string") {
				return part.text;
			}
			if (typeof part.thinking === "string") {
				return part.thinking;
			}
			if (typeof part.name === "string") {
				return part.name;
			}
			return "";
		})
		.filter(Boolean)
		.join(" ");
}

/**
 * 截断文本。
 * @param value - 文本。
 * @param maxLength - 最大长度。
 * @returns 截断后的文本。
 */
function truncateText(value: string, maxLength: number): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLength) {
		return normalized;
	}
	return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

/**
 * 判断普通对象。
 * @param value - 待检查值。
 * @returns 是否为普通对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
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
