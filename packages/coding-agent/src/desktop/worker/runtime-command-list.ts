/**
 * 本文件从 Pi session 资源汇总可调用 slash command。
 */

import type { AgentSession } from "../../core/agent-session.ts";
import type { RpcSlashCommand } from "../../modes/rpc/rpc-types.ts";

export function getRuntimeCommands(session: AgentSession): RpcSlashCommand[] {
	const commands: RpcSlashCommand[] = [];
	for (const command of session.extensionRunner.getRegisteredCommands()) {
		commands.push({
			name: command.invocationName,
			description: command.description,
			source: "extension",
			sourceInfo: command.sourceInfo,
		});
	}
	for (const template of session.promptTemplates) {
		commands.push({
			name: template.name,
			description: template.description,
			source: "prompt",
			sourceInfo: template.sourceInfo,
		});
	}
	for (const skill of session.resourceLoader.getSkills().skills) {
		commands.push({
			name: `skill:${skill.name}`,
			description: skill.description,
			source: "skill",
			sourceInfo: skill.sourceInfo,
		});
	}
	return commands;
}
