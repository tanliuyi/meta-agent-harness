import type { CommandInfo } from '@shared/coding-agent/types'
import type { BaseContextMenuSection } from '@renderer/components/base/BaseContextMenu.vue'

export const commandMenuSections: BaseContextMenuSection[] = [
  {
    items: [
      { id: 'run', label: '运行命令' },
      { id: 'copy-name', label: '复制名称' }
    ]
  }
]

export function filterCommands(commands: CommandInfo[], query: string): CommandInfo[] {
  const normalizedQuery = getCommandQueryName(query).toLowerCase()
  if (!normalizedQuery) {
    return commands
  }
  return commands.filter((command) =>
    [command.name, command.description, command.source].some((value) =>
      value?.toLowerCase().includes(normalizedQuery)
    )
  )
}

export function getCommandKey(command: CommandInfo): string {
  return `${command.source}:${command.name}`
}

export function getCommandName(command: CommandInfo): string {
  return command.name
}

export function getCommandDescription(command: CommandInfo): string {
  return command.description || command.source
}

export function getCommandClipboardText(command: CommandInfo): string {
  return `/${getCommandName(command)}`
}

/**
 * 从命令输入中取用于过滤命令名的部分。
 * @param query - 用户输入。
 * @returns 命令名查询。
 */
export function getCommandQueryName(query: string): string {
  return query.trimStart().replace(/^\/+/, '').split(/\s+/, 1)[0]?.trim() ?? ''
}

/**
 * 从命令输入中提取传给指定命令的参数。
 * @param query - 用户输入。
 * @param commandName - 已选择的命令名。
 * @returns 命令参数。
 */
export function getCommandQueryArgs(query: string, commandName: string): string | undefined {
  const normalizedQuery = query.trimStart()
  const candidates = [commandName, `/${commandName}`]
  for (const candidate of candidates) {
    if (normalizedQuery === candidate) {
      return undefined
    }
    if (normalizedQuery.toLowerCase().startsWith(`${candidate.toLowerCase()} `)) {
      return normalizedQuery.slice(candidate.length + 1)
    }
  }
  return undefined
}
