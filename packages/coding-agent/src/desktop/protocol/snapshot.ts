/**
 * 本文件定义 thread snapshot 与 worker snapshot。
 */

import type { DesktopDiagnostic } from "./diagnostic.ts";
import type { CwdPath, SessionFile, ThreadId, WorkerId } from "./identity.ts";
import type { DesktopThinkingLevel, ModelIdentity } from "./model.ts";
import type { ApprovalRequest } from "./approval.ts";
import type { DesktopFileChange, DesktopToolCall } from "./tool.ts";
import type { ThreadRuntimeState } from "./thread.ts";

export interface DesktopMessage {
	id: string;
	role: "user" | "assistant" | "tool" | "system";
	text?: string;
	createdAt?: string;
}

export interface ThreadSnapshot {
	threadId: ThreadId;
	cwd: CwdPath;
	sessionFile?: SessionFile;
	title?: string;
	status: ThreadRuntimeState;
	model?: ModelIdentity;
	thinkingLevel: DesktopThinkingLevel;
	messages: DesktopMessage[];
	toolCalls: DesktopToolCall[];
	fileChanges: DesktopFileChange[];
	approvals: ApprovalRequest[];
	queue: {
		steering: string[];
		followUp: string[];
	};
	context?: {
		tokens?: number;
		contextWindow?: number;
		percent?: number;
	};
	cost?: {
		total: number;
	};
	diagnostics: DesktopDiagnostic[];
}

export interface WorkerSnapshot {
	workerId: WorkerId;
	threadId?: ThreadId;
	state: "starting" | "ready" | "bound" | "busy" | "idle" | "stopping" | "exited" | "crashed";
	pid?: number;
	startedAt?: string;
	lastActiveAt?: string;
	thread?: ThreadSnapshot;
	diagnostics: DesktopDiagnostic[];
}

