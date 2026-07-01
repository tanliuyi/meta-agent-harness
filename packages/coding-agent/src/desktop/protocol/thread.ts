/**
 * 定义 coding thread 的输入、状态与摘要类型。
 */

import type { CwdPath, IsoTime, SessionFile, ThreadId } from "./identity.ts";

/** Thread 运行时状态。 */
export type ThreadRuntimeState = "new" | "queued" | "starting" | "idle" | "running" | "stopping" | "stopped" | "error";

/** 启动 thread 的输入。 */
export interface StartThreadInput {
	/** 线程 ID（可选，未指定时由系统生成）。 */
	threadId?: ThreadId;
	/** 当前工作目录。 */
	cwd: CwdPath;
	/** Session 文件路径（可选）。 */
	sessionFile?: SessionFile;
	/** 线程标题。 */
	title?: string;
	/** Agent 目录路径（可选）。 */
	agentDir?: string;
}

/** Thread 摘要。 */
export interface ThreadSummary {
	/** 线程 ID。 */
	threadId: ThreadId;
	/** 当前工作目录。 */
	cwd: CwdPath;
	/** Session 文件路径（可选）。 */
	sessionFile?: SessionFile;
	/** 线程标题。 */
	title?: string;
	/** 线程运行时状态。 */
	status: ThreadRuntimeState;
	/** 创建时间（ISO 8601）。 */
	createdAt: IsoTime;
	/** 最后更新时间（ISO 8601）。 */
	updatedAt: IsoTime;
}
