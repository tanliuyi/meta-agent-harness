/**
 * 本文件定义与 Pi RPC 同构的 canonical agent command。
 */

import type { RpcCommand } from "../../../modes/rpc/rpc-types.ts";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type BaseCanonicalAgentCommand = DistributiveOmit<RpcCommand, "id">;

export type CanonicalAgentCommand =
	| Exclude<BaseCanonicalAgentCommand, { type: "switch_session" } | { type: "fork" }>
	| { type: "switch_session"; sessionPath: string; cwdOverride?: string }
	| { type: "import_session"; inputPath: string; cwdOverride?: string }
	| { type: "fork"; entryId: string; position?: "before" | "at" };

export function isCanonicalAgentCommand(command: { type: string }): command is CanonicalAgentCommand {
	return canonicalCommandTypes.has(command.type);
}

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
