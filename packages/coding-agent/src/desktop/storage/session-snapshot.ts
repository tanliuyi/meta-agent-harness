/**
 * 本文件从 Pi canonical JSONL session 重建 desktop 最小 snapshot。
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

export interface BuildSnapshotFromSessionInput {
	thread: ThreadSummary;
	sessionFile: string;
	cwdOverride?: string;
}

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

function toDesktopMessage(message: AgentMessage, index: number): DesktopMessage {
	return {
		id: `message-${index}`,
		role: mapRole(message.role),
		text: hasContent(message) ? extractText(message.content) : undefined,
		createdAt: typeof message.timestamp === "number" ? new Date(message.timestamp).toISOString() : undefined,
	};
}

function mapRole(role: AgentMessage["role"]): DesktopMessage["role"] {
	if (role === "assistant") {
		return role;
	}
	return "user";
}

function hasContent(message: AgentMessage): message is AgentMessage & { content: unknown } {
	return "content" in message;
}

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

function isSessionInfoEntry(entry: SessionEntry): entry is SessionInfoEntry {
	return entry.type === "session_info";
}

function isModelChangeEntry(entry: SessionEntry): entry is ModelChangeEntry {
	return entry.type === "model_change";
}

function isThinkingLevelChangeEntry(entry: SessionEntry): entry is ThinkingLevelChangeEntry {
	return entry.type === "thinking_level_change";
}

function findLastEntry<T, U extends T>(entries: readonly T[], predicate: (entry: T) => entry is U): U | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index]!;
		if (predicate(entry)) {
			return entry;
		}
	}
	return undefined;
}
