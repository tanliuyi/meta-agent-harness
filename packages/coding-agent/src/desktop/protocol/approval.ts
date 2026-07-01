/**
 * 本文件定义 desktop 后端审批请求与响应结构。
 */

import type { IsoTime, ThreadId } from "./identity.ts";

export type ApprovalRisk = "low" | "medium" | "high";

export type ApprovalScope = "once" | "thread" | "workspace";

export interface ApprovalRequest {
	approvalId: string;
	threadId: ThreadId;
	action: string;
	risk: ApprovalRisk;
	scope: ApprovalScope;
	choices?: string[];
	subject?: string;
	defaultAction: "allow" | "deny";
	timeoutMs?: number;
	createdAt: IsoTime;
}

export interface ApprovalResponse {
	approvalId: string;
	allow: boolean;
	scope: ApprovalScope;
	choice?: string;
	reason?: string;
}
