/**
 * 处理 Pi 同构 session lifecycle command。
 */

import { createDesktopError } from "../protocol/error.ts";
import { createWorkerErrorResponse, createWorkerResponse, type WorkerCommandEnvelope, type WorkerResponseEnvelope } from "../protocol/envelope.ts";
import type { CanonicalAgentCommand } from "../protocol/commands/canonical.ts";
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
			const result = await host.runtime.switchSession(command.sessionPath, { cwdOverride: command.cwdOverride });
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
