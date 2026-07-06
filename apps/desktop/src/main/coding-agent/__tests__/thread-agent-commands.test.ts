/**
 * 本文件测试 desktop command invocation 与 Pi slash command 参数语义一致。
 */

import { describe, expect, it, vi } from 'vitest'
import { runCommand, toSlashCommand } from '../thread-agent-commands'
import type { ThreadManagerCore } from '../thread-manager-core'
import type { WorkerCommand } from '../worker-types'

describe('thread-agent-commands', () => {
  it('将 command 与 args 还原为 Pi slash command 文本', () => {
    expect(toSlashCommand('/deploy', 'prod --force')).toBe('/deploy prod --force')
    expect(toSlashCommand('deploy', '  prod')).toBe('/deploy   prod')
    expect(toSlashCommand('deploy')).toBe('/deploy')
  })

  it('runCommand 通过 prompt 将 args 传给 Pi extension command handler', async () => {
    const commands: WorkerCommand[] = []
    const core = {
      requireThread: vi.fn(() => ({ threadId: 'thread-a' })),
      updateThread: vi.fn(),
      sendOk: vi.fn(async (_threadId: string, command: WorkerCommand) => {
        commands.push(command)
      })
    } as unknown as ThreadManagerCore

    await runCommand(core, {
      threadId: 'thread-a',
      command: '/deploy',
      args: 'prod --force'
    })

    expect(core.requireThread).toHaveBeenCalledWith('thread-a')
    expect(core.updateThread).toHaveBeenCalledWith('thread-a', { status: 'running' })
    expect(commands).toEqual([
      {
        type: 'prompt',
        message: '/deploy prod --force',
        images: undefined,
        streamingBehavior: undefined
      }
    ])
  })
})
