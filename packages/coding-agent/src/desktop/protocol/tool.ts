/**
 * 本文件定义 desktop projection 使用的工具与文件变更结构。
 */

import type { IsoTime, ThreadId } from "./identity.ts";

export type DesktopToolStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface DesktopToolCall {
	threadId: ThreadId;
	toolCallId: string;
	toolName: string;
	status: DesktopToolStatus;
	args?: unknown;
	resultSummary?: string;
	startedAt?: IsoTime;
	finishedAt?: IsoTime;
}

export type DesktopFileChangeType = "created" | "updated" | "deleted" | "renamed";

export interface DesktopFileChange {
	threadId: ThreadId;
	path: string;
	changeType: DesktopFileChangeType;
	toolCallId?: string;
	patch?: string;
	createdAt: IsoTime;
}

