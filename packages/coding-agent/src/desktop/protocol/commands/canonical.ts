/**
 * 定义与 Pi RPC 同构的 canonical agent command。
 */

import type { RpcCommand } from "../../../modes/rpc/rpc-types.ts";

/** 分配式 Omit 辅助类型。 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** 基础 canonical agent 命令类型，省略了 RPC 命令的 id 字段。 */
type BaseCanonicalAgentCommand = DistributiveOmit<RpcCommand, "id">;

/** Canonical agent 命令联合类型。 */
export type CanonicalAgentCommand =
	| Exclude<BaseCanonicalAgentCommand, { type: "switch_session" } | { type: "fork" }>
	| {
			/** 命令类型：切换会话。 */
			type: "switch_session";
			/** 目标会话路径。 */
			sessionPath: string;
			/** 可选的工作目录覆盖。 */
			cwdOverride?: string;
	  }
	| {
			/** 命令类型：导入会话。 */
			type: "import_session";
			/** 输入会话路径。 */
			inputPath: string;
			/** 可选的工作目录覆盖。 */
			cwdOverride?: string;
	  }
	| {
			/** 命令类型：分叉。 */
			type: "fork";
			/** 入口消息 ID。 */
			entryId: string;
			/** 分叉位置。 */
			position?: "before" | "at";
	  };

/**
 * 判断给定命令是否为 canonical agent 命令。
 * @param command - 要判断的命令。
 * @returns 是否为 canonical agent 命令。
 */
export function isCanonicalAgentCommand(command: { type: string }): command is CanonicalAgentCommand {
	return canonicalCommandTypes.has(command.type);
}

/** 预定义的 canonical 命令类型集合。 */
const canonicalCommandTypes = new Set<string>([
	"prompt",
	"steer",
	"follow_up",
	"abort",
	"new_session",
	"get_state",
	"set_model",
	"cycle_model",
	"get_available_models",
	"set_thinking_level",
	"cycle_thinking_level",
	"set_steering_mode",
	"set_follow_up_mode",
	"compact",
	"set_auto_compaction",
	"set_auto_retry",
	"abort_retry",
	"bash",
	"abort_bash",
	"get_session_stats",
	"export_html",
	"switch_session",
	"import_session",
	"fork",
	"clone",
	"get_fork_messages",
	"get_last_assistant_text",
	"set_session_name",
	"get_messages",
	"get_commands",
]);
