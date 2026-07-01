/**
 * 本文件定义 desktop 状态数据库的表名与 schema 版本。
 */

export const DESKTOP_STATE_SCHEMA_VERSION = 1;

export const desktopStateTables = [
	"threads",
	"thread_snapshots",
	"message_index",
	"tool_calls",
	"file_changes",
	"approvals",
	"worker_runs",
	"diagnostics",
] as const;

export type DesktopStateTable = (typeof desktopStateTables)[number];

