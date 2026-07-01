/**
 * 定义 desktop 状态数据库的表名与 schema 版本。
 */

/** Desktop 状态数据库的 schema 版本号。 */
export const DESKTOP_STATE_SCHEMA_VERSION = 1;

/** Desktop 状态数据库中包含的表名列表。 */
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

/** Desktop 状态表类型。 */
export type DesktopStateTable = (typeof desktopStateTables)[number];

