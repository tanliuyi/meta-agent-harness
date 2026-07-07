/**
 * 处理 Pi 同构 session lifecycle command。
 */

import { createDesktopError } from "../protocol/error.ts";
import { SessionManager } from "../agent-runtime/index.ts";
import { createWorkerErrorResponse, createWorkerResponse, type WorkerCommandEnvelope, type WorkerResponseEnvelope } from "../protocol/envelope.ts";
import type { CanonicalAgentCommand } from "../protocol/commands/canonical.ts";
import { toDesktopSessionTreeChildren } from "../storage/session-snapshot.ts";
import { rebindIfNeeded, type RuntimeCommandHandlerHost } from "./runtime-command-host.ts";

/**
 * 处理 runtime session 生命周期命令。
 * @param host - runtime 命令 host。
 * @param envelope - 命令 envelope。
 * @param command - canonical agent 命令。
 * @returns worker 响应 envelope，或 undefined 表示不处理该命令。
 */
export async function handleRuntimeSessionCommand(
	host: RuntimeCommandHandlerHost,
	envelope: WorkerCommandEnvelope,
	command: CanonicalAgentCommand,
): Promise<WorkerResponseEnvelope | undefined> {
	const session = host.runtime.session;
	switch (command.type) {
		case "new_session": {
			const result = await host.runtime.newSession(command.parentSession ? { parentSession: command.parentSession } : undefined);
			await rebindIfNeeded(host, result.cancelled);
			return createWorkerResponse(envelope.id, command.type, result);
		}
		case "switch_session": {
			const result = await host.runtime.switchSession(command.sessionPath, {
				cwdOverride: command.cwdOverride,
				projectTrustContextFactory: host.projectTrustContextFactory,
			});
			await rebindIfNeeded(host, result.cancelled);
			return createWorkerResponse(envelope.id, command.type, result);
		}
		case "import_session": {
			const result = await host.runtime.importFromJsonl(command.inputPath, command.cwdOverride);
			await rebindIfNeeded(host, result.cancelled);
			return createWorkerResponse(envelope.id, command.type, result);
		}
		case "fork": {
			const result = await host.runtime.fork(command.entryId, { position: command.position });
			await rebindIfNeeded(host, result.cancelled);
			return createWorkerResponse(envelope.id, command.type, { text: result.selectedText, cancelled: result.cancelled });
		}
		case "create_fork_session": {
			const result = createForkedSessionFile(host, command.entryId, command.position);
			return createWorkerResponse(envelope.id, command.type, {
				sessionFile: result.sessionFile,
				text: result.selectedText,
				cancelled: result.cancelled,
			});
		}
		case "navigate_tree": {
			const result = await session.navigateTree(command.entryId, {
				summarize: command.summarize,
				customInstructions: command.customInstructions,
			});
			return createWorkerResponse(envelope.id, command.type, {
				editorText: result.editorText,
				cancelled: result.cancelled,
				aborted: result.aborted,
			});
		}
		case "get_session_tree_children": {
			return createWorkerResponse(envelope.id, command.type, {
				children: toDesktopSessionTreeChildren(
					session.sessionManager.getTree(),
					command.parentId,
					command.maxDepth,
				),
			});
		}
		case "get_session_tree_path": {
			return createWorkerResponse(envelope.id, command.type, {
				path: session.sessionManager.getBranch(command.entryId).map((entry) => entry.id),
			});
		}
		case "set_session_entry_label": {
			session.sessionManager.appendLabelChange(command.entryId, command.label?.trim() || undefined);
			return createWorkerResponse(envelope.id, command.type, undefined);
		}
		case "clone": {
			const leafId = session.sessionManager.getLeafId();
			if (!leafId) {
				return createWorkerErrorResponse(
					envelope.id,
					command.type,
					createDesktopError("invalid_state", "Cannot clone session: no current entry selected", true),
				);
			}
			const result = await host.runtime.fork(leafId, { position: "at" });
			await rebindIfNeeded(host, result.cancelled);
			return createWorkerResponse(envelope.id, command.type, { cancelled: result.cancelled });
		}
		case "get_fork_messages":
			return createWorkerResponse(envelope.id, command.type, { messages: session.getUserMessagesForForking() });
		case "get_last_assistant_text":
			return createWorkerResponse(envelope.id, command.type, { text: session.getLastAssistantText() });
		case "set_session_name":
			if (!command.name.trim()) {
				return createWorkerErrorResponse(
					envelope.id,
					command.type,
					createDesktopError("invalid_command", "Session name cannot be empty", true),
				);
			}
			session.setSessionName(command.name.trim());
			return createWorkerResponse(envelope.id, command.type, undefined);
		default:
			return undefined;
	}
}

function createForkedSessionFile(
	host: RuntimeCommandHandlerHost,
	entryId: string,
	position: "before" | "at" | undefined,
): { cancelled: false; sessionFile?: string; selectedText?: string } {
	const runtimeSession = host.runtime.session;
	const sessionFile = runtimeSession.sessionFile;
	if (!sessionFile) {
		return { cancelled: false, sessionFile: undefined };
	}
	const selectedEntry = runtimeSession.sessionManager.getEntry(entryId);
	if (!selectedEntry) {
		throw new Error("Invalid entry ID for forking");
	}

	let targetLeafId: string | null;
	let selectedText: string | undefined;
	if ((position ?? "before") === "at") {
		targetLeafId = selectedEntry.id;
	} else {
		if (selectedEntry.type !== "message" || selectedEntry.message.role !== "user") {
			throw new Error("Invalid entry ID for forking");
		}
		targetLeafId = selectedEntry.parentId;
		selectedText = extractUserMessageText(selectedEntry.message.content);
	}

	const sessionManager = SessionManager.open(sessionFile, runtimeSession.sessionManager.getSessionDir());
	if (!targetLeafId) {
		sessionManager.newSession({ parentSession: sessionFile });
		return { cancelled: false, sessionFile: sessionManager.getSessionFile(), selectedText };
	}
	return {
		cancelled: false,
		sessionFile: sessionManager.createBranchedSession(targetLeafId),
		selectedText,
	};
}

function extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") {
		return content;
	}
	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("");
}
