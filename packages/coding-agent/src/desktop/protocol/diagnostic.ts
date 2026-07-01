/**
 * 本文件定义 desktop 后端统一诊断结构。
 */

import type { IsoTime, ThreadId, WorkerId } from "./identity.ts";

export type DiagnosticSeverity = "debug" | "info" | "warning" | "error";

export interface DesktopDiagnostic {
	id: string;
	severity: DiagnosticSeverity;
	message: string;
	source: "worker" | "pool" | "ipc" | "storage" | "protocol" | "runtime";
	threadId?: ThreadId;
	workerId?: WorkerId;
	details?: unknown;
	createdAt: IsoTime;
}

