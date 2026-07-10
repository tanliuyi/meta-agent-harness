/**
 * 本文件把 Pi agent 内建 slash command 映射为 desktop 可展示的命令信息。
 *
 * 注意：不要从 renderer shared 代码直接 import Pi core 的 slash-commands.ts。
 * 该模块会经由 config 牵出 Node-only 依赖，导致 renderer bundle 缺少 process。
 */

import type { BuiltinCommandInfo } from './types'

const builtinSlashCommands: ReadonlyArray<Pick<BuiltinCommandInfo, 'name' | 'description'>> = [
  { name: 'name', description: '设置会话显示名称' },
  { name: 'session', description: '显示会话信息和统计数据' },
  { name: 'compact', description: '手动压缩会话上下文' },
  { name: 'reload', description: '重新加载快捷键、扩展、技能、提示词和主题' }
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
