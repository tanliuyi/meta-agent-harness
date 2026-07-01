/**
 * 本文件定义 preload 暴露给 renderer 的 coding agent API 形状。
 */

import type { ApprovalResponse } from "../protocol/approval.ts";
import type { WorkerCommand } from "../protocol/envelope.ts";
import type { ExtensionUiResponse } from "../protocol/extension-ui.ts";
import type { ThreadId } from "../protocol/identity.ts";
import type { DesktopThinkingLevel } from "../protocol/model.ts";
import type { ThreadSnapshot } from "../protocol/snapshot.ts";
import type { StartThreadInput, ThreadSummary } from "../protocol/thread.ts";
import type { DesktopIpcEvent } from "./event.ts";

export interface CodingAgentApi {
	createThread(input: StartThreadInput): Promise<ThreadSnapshot>;
	stopThread(threadId: ThreadId): Promise<void>;
	listThreads(): Promise<ThreadSummary[]>;
	getSnapshot(threadId: ThreadId): Promise<ThreadSnapshot>;
	send(threadId: ThreadId, command: WorkerCommand): Promise<unknown>;
	setThinkingLevel(threadId: ThreadId, level: DesktopThinkingLevel): Promise<void>;
	respondUi(response: ExtensionUiResponse): Promise<void>;
	respondApproval(response: ApprovalResponse): Promise<void>;
	onEvent(listener: (event: DesktopIpcEvent) => void): () => void;
}

