/**
 * 本文件定义 desktop worker control command。
 */

import type { ApprovalResponse } from "../approval.ts";
import type { ExtensionUiResponse } from "../extension-ui.ts";
import type { StartThreadInput } from "../thread.ts";

export type DesktopControlCommand =
	| { type: "worker.startThread"; input: StartThreadInput }
	| { type: "worker.stopThread"; reason?: string }
	| { type: "worker.snapshot" }
	| { type: "worker.reset"; input: StartThreadInput }
	| { type: "worker.ping" }
	| { type: "ui.respond"; response: ExtensionUiResponse }
	| { type: "approval.respond"; response: ApprovalResponse };

export function isDesktopControlCommand(command: { type: string }): command is DesktopControlCommand {
	return controlCommandTypes.has(command.type);
}

const controlCommandTypes = new Set<string>([
	"worker.startThread",
	"worker.stopThread",
	"worker.snapshot",
	"worker.reset",
	"worker.ping",
	"ui.respond",
	"approval.respond",
]);

