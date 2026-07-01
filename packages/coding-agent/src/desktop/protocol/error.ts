/**
 * 本文件定义 worker、pool 与 IPC 共用的结构化错误。
 */

export type DesktopErrorCode =
	| "invalid_command"
	| "invalid_state"
	| "thread_not_found"
	| "worker_not_found"
	| "worker_crashed"
	| "worker_exited"
	| "protocol_error"
	| "timeout"
	| "permission_denied"
	| "runtime_error";

export interface DesktopError {
	code: DesktopErrorCode;
	message: string;
	recoverable: boolean;
	details?: unknown;
}

export function createDesktopError(code: DesktopErrorCode, message: string, recoverable: boolean): DesktopError {
	return { code, message, recoverable };
}

