/**
 * 本文件定义 coding thread 的输入、状态与摘要类型。
 */

import type { CwdPath, IsoTime, SessionFile, ThreadId } from "./identity.ts";

export type ThreadRuntimeState = "new" | "queued" | "starting" | "idle" | "running" | "stopping" | "stopped" | "error";

export interface StartThreadInput {
	threadId?: ThreadId;
	cwd: CwdPath;
	sessionFile?: SessionFile;
	title?: string;
	agentDir?: string;
}

export interface ThreadSummary {
	threadId: ThreadId;
	cwd: CwdPath;
	sessionFile?: SessionFile;
	title?: string;
	status: ThreadRuntimeState;
	createdAt: IsoTime;
	updatedAt: IsoTime;
}

