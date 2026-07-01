/**
 * 定义 desktop projection 使用的工具与文件变更结构。
 */

import type { IsoTime, ThreadId } from "./identity.ts";

/** Desktop 工具调用状态。 */
export type DesktopToolStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/** Desktop 工具调用。 */
export interface DesktopToolCall {
	/** 线程 ID。 */
	threadId: ThreadId;
	/** 工具调用 ID。 */
	toolCallId: string;
	/** 工具名称。 */
	toolName: string;
	/** 当前状态。 */
	status: DesktopToolStatus;
	/** 调用参数。 */
	args?: unknown;
	/** 结果摘要。 */
	resultSummary?: string;
	/** 开始时间（ISO 8601）。 */
	startedAt?: IsoTime;
	/** 结束时间（ISO 8601）。 */
	finishedAt?: IsoTime;
}

/** Desktop 文件变更类型。 */
export type DesktopFileChangeType = "created" | "updated" | "deleted" | "renamed";

/** Desktop 文件变更。 */
export interface DesktopFileChange {
	/** 线程 ID。 */
	threadId: ThreadId;
	/** 文件路径。 */
	path: string;
	/** 变更类型。 */
	changeType: DesktopFileChangeType;
	/** 关联工具调用 ID（可选）。 */
	toolCallId?: string;
	/** 文件变更 diff（可选）。 */
	patch?: string;
	/** 变更时间（ISO 8601）。 */
	createdAt: IsoTime;
}
