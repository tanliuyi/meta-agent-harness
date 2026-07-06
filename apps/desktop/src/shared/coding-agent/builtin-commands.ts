/**
 * 本文件把 Pi agent 内建 slash command 映射为 desktop 可展示的命令信息。
 *
 * 注意：不要从 renderer shared 代码直接 import Pi core 的 slash-commands.ts。
 * 该模块会经由 config 牵出 Node-only 依赖，导致 renderer bundle 缺少 process。
 */

import type { BuiltinCommandInfo } from './types'

const builtinSlashCommands: ReadonlyArray<Pick<BuiltinCommandInfo, 'name' | 'description'>> = [
  { name: 'name', description: 'Set session display name' },
  { name: 'session', description: 'Show session info and stats' },
  { name: 'changelog', description: 'Show changelog entries' },
  { name: 'hotkeys', description: 'Show all keyboard shortcuts' },
  { name: 'new', description: 'Start a new session' },
  { name: 'compact', description: 'Manually compact the session context' },
  { name: 'reload', description: 'Reload keybindings, extensions, skills, prompts, and themes' }
]

/** 获取 Pi agent 内建 slash commands。 */
export function getBuiltinCommandInfos(): BuiltinCommandInfo[] {
  return builtinSlashCommands.map((command) => ({
    name: command.name,
    description: command.description,
    source: 'builtin',
    sourceInfo: {
      path: `<builtin:${command.name}>`,
      source: 'builtin',
      scope: 'temporary',
      origin: 'top-level'
    }
  }))
}
