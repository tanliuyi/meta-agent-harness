/**
 * 定义 Pi AgentMessage 到 desktop message 的纯转换逻辑。
 */

import type { CustomMessage } from "../../core/messages.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { DesktopMessage } from "./snapshot.ts";
import type { DesktopToolCall } from "./tool.ts";
import type { ThreadId } from "./identity.ts";

export type _DesktopMessageProtocolAugmentation = CustomMessage;

/** 不含 ID 的 desktop message 内容。 */
export type DesktopMessageContent = Omit<DesktopMessage, "id">;

/**
 * 将 AgentMessage 转换为不含 ID 的 DesktopMessage 内容。
 * @param message - 原始 agent 消息。
 * @returns Desktop 消息内容；不应展示的消息返回 undefined。
 */
export function toDesktopMessageContent(message: AgentMessage): DesktopMessageContent | undefined {
	const role = mapRole(message.role);
	if (!role) {
		return undefined;
	}
	const text = hasContent(message) ? extractText(message.content) : undefined;
	if (role === "assistant" && !text?.trim() && !hasAssistantBlockContent(message)) {
		return undefined;
	}
	return {
		role,
		text,
		raw: message,
		createdAt: hasTimestamp(message) ? normalizeTimestamp(message.timestamp) : undefined,
	};
}

/**
 * 将 AgentMessage 转换为 DesktopMessage。
 * @param message - 原始 agent 消息。
 * @param id - desktop message ID。
 * @returns Desktop 消息；不应展示的消息返回 undefined。
 */
export function toDesktopMessage(message: AgentMessage, id: string): DesktopMessage | undefined {
	const content = toDesktopMessageContent(message);
	return content ? { id, ...content } : undefined;
}

/**
 * 将 AgentMessage 列表转换为 DesktopMessage 列表。
 * @param messages - Pi live/context messages。
 * @returns desktop messages。
 */
export function toDesktopMessages(messages: AgentMessage[]): DesktopMessage[] {
	return messages.flatMap((message, index) => {
		const item = toDesktopMessage(message, `message-${index}`);
		return item ? [item] : [];
	});
}

/**
 * 从 AgentMessage 列表派生 Desktop 工具调用。
 * @param messages - Pi live/context messages。
 * @param threadId - 关联线程 ID。
 * @returns desktop 工具调用列表。
 */
export function toDesktopToolCalls(messages: AgentMessage[], threadId: ThreadId): DesktopToolCall[] {
	const toolCalls = new Map<string, DesktopToolCall>();
	for (const message of messages) {
		if (message.role === "assistant" && hasContent(message) && Array.isArray(message.content)) {
			for (const block of message.content) {
				if (!isRecord(block) || block.type !== "toolCall" || typeof block.id !== "string") {
					continue;
				}
				const existing = toolCalls.get(block.id);
				toolCalls.set(block.id, {
					...existing,
					threadId,
					toolCallId: block.id,
					toolName: typeof block.name === "string" ? block.name : existing?.toolName ?? "tool",
					status: existing?.status ?? "queued",
					args: "arguments" in block ? block.arguments : existing?.args,
				});
			}
			continue;
		}
		if (message.role === "toolResult" && typeof message.toolCallId === "string") {
			const existing = toolCalls.get(message.toolCallId);
			toolCalls.set(message.toolCallId, {
				...existing,
				threadId,
				toolCallId: message.toolCallId,
				toolName: typeof message.toolName === "string" ? message.toolName : existing?.toolName ?? "tool",
				status: message.isError ? "failed" : "succeeded",
				args: existing?.args,
				result: message.content,
				resultSummary: extractText(message.content),
				finishedAt: hasTimestamp(message) ? normalizeTimestamp(message.timestamp) : existing?.finishedAt,
			});
		}
	}
	return [...toolCalls.values()];
}

/**
 * 映射消息角色到 desktop 消息角色。
 * @param role - 原始角色。
 * @returns Desktop 消息角色。
 */
function mapRole(role: AgentMessage["role"]): DesktopMessage["role"] | undefined {
	switch (role) {
		case "user":
		case "assistant":
			return role;
		case "toolResult":
			return "tool";
		case "bashExecution":
		case "custom":
		case "branchSummary":
		case "compactionSummary":
			return "user";
		default:
			return undefined;
	}
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
 * 判断消息是否包含 timestamp 字段。
 * @param message - 原始消息。
 * @returns 是否包含 timestamp。
 */
function hasTimestamp(message: AgentMessage): message is AgentMessage & { timestamp: unknown } {
	return "timestamp" in message;
}

/**
 * 判断 assistant 消息是否包含可单独渲染的结构块。
 * @param message - 原始消息。
 * @returns 是否包含 thinking 或 toolCall 内容。
 */
function hasAssistantBlockContent(message: AgentMessage): boolean {
	if (!hasContent(message) || !Array.isArray(message.content)) {
		return false;
	}
	return message.content.some(
		(part) =>
			isRecord(part) &&
			((part.type === "thinking" && typeof part.thinking === "string") ||
				(part.type === "toolCall" && typeof part.id === "string")),
	);
}

/**
 * 判断普通对象。
 * @param value - 值。
 * @returns 是否普通对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
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
 * 归一化 timestamp。
 * @param value - timestamp。
 * @returns ISO 字符串。
 */
function normalizeTimestamp(value: unknown): string | undefined {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number") {
		return new Date(value).toISOString();
	}
	return undefined;
}
