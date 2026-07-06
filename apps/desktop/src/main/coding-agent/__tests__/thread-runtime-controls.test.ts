/**
 * 本文件测试 desktop runtime controls 对 Pi command list 的补齐。
 */

import { describe, expect, it, vi } from 'vitest'
import { getCommands } from '../thread-runtime-controls'
import type { ThreadManagerCore } from '../thread-manager-core'

describe('thread-runtime-controls', () => {
  it('getCommands 合并 agent 内建 slash commands 和 worker 资源命令', async () => {
    const core = {
      sendData: vi.fn().mockResolvedValue({
        commands: [
          {
            name: 'skill:test',
            description: 'Run test skill',
            source: 'skill',
            sourceInfo: {
              path: '/tmp/skill',
              source: 'test',
              scope: 'temporary',
              origin: 'top-level'
            }
          }
        ]
      })
    } as unknown as ThreadManagerCore

    const commands = await getCommands(core, 'thread-a')

    expect(core.sendData).toHaveBeenCalledWith('thread-a', { type: 'get_commands' })
    expect(commands.map((command) => command.name)).toEqual(
      expect.arrayContaining(['reload', 'skill:test'])
    )
    expect(commands.map((command) => command.name)).not.toEqual(
      expect.arrayContaining([
        'settings',
        'model',
        'scoped-models',
        'export',
        'import',
        'share',
        'copy',
        'fork',
        'clone',
        'tree',
        'trust',
        'login',
        'logout',
        'resume',
        'quit'
      ])
    )
    expect(commands.find((command) => command.name === 'reload')?.source).toBe('builtin')
  })
})
