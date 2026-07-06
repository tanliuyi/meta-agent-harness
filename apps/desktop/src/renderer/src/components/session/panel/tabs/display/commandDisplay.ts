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
  const normalizedQuery = query.trim().toLowerCase()
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
