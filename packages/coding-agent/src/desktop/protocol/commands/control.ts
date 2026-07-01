/**
 * 定义 desktop worker control command。
 */

import type { ApprovalResponse } from "../approval.ts";
import type { ExtensionUiResponse } from "../extension-ui.ts";
import type { StartThreadInput } from "../thread.ts";

/** Desktop worker 控制命令联合类型。 */
export type DesktopControlCommand =
	| {
			/** 命令类型：启动线程。 */
			type: "worker.startThread";
			/** 启动线程的输入参数。 */
			input: StartThreadInput;
	  }
	| {
			/** 命令类型：停止线程。 */
			type: "worker.stopThread";
			/** 停止原因。 */
			reason?: string;
	  }
	| {
			/** 命令类型：生成快照。 */
			type: "worker.snapshot";
	  }
	| {
			/** 命令类型：重置线程。 */
			type: "worker.reset";
			/** 重置线程的输入参数。 */
			input: StartThreadInput;
	  }
	| {
			/** 命令类型：心跳检测。 */
			type: "worker.ping";
	  }
	| {
			/** 命令类型：响应扩展 UI 请求。 */
			type: "ui.respond";
			/** 扩展 UI 响应。 */
			response: ExtensionUiResponse;
	  }
	| {
			/** 命令类型：响应审批请求。 */
			type: "approval.respond";
			/** 审批响应。 */
			response: ApprovalResponse;
	  };

/**
 * 判断给定命令是否为 desktop control command。
 * @param command - 要判断的命令。
 * @returns 是否为 desktop control command。
 */
export function isDesktopControlCommand(command: { type: string }): command is DesktopControlCommand {
	return controlCommandTypes.has(command.type);
}

/** 预定义的 control 命令类型集合。 */
const controlCommandTypes = new Set<string>([
	"worker.startThread",
	"worker.stopThread",
	"worker.snapshot",
	"worker.reset",
	"worker.ping",
	"ui.respond",
	"approval.respond",
]);
