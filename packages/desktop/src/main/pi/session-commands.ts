import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { SlashCommand } from "../../shared/contracts.ts";

type CommandSession = Pick<AgentSession, "extensionRunner" | "promptTemplates" | "resourceLoader">;

/** 从 Pi session 的真实资源生成 Composer slash command。 */
export function getSessionCommands(session: CommandSession): SlashCommand[] {
  const extensions = session.extensionRunner.getRegisteredCommands().map((command) => ({
    name: command.invocationName,
    description: command.description,
    source: "extension" as const,
  }));
  const prompts = session.promptTemplates.map((prompt) => ({
    name: prompt.name,
    description: prompt.description,
    source: "prompt" as const,
  }));
  const skills = session.resourceLoader.getSkills().skills.map((skill) => ({
    name: `skill:${skill.name}`,
    description: skill.description,
    source: "skill" as const,
  }));
  return [...extensions, ...prompts, ...skills];
}
