/**
 * 本文件测试 desktop runtime controls 到 worker command 的桥接。
 */

import { describe, expect, it } from 'vitest'
import { ThreadManagerCore } from '../thread-manager-core'
import {
  getCommands,
  respondApproval,
  respondUi
} from '../thread-runtime-controls'
import { runCommand } from '../thread-agent-commands'
import type { WorkerCommand, WorkerResponseEnvelope } from '../worker-types'
import type { ThreadWorkerRegistry } from '../thread-worker-registry'

describe('thread-runtime-controls', () => {
  it('桥接 extension command、UI response 与 approval response 到 worker command', async () => {
    const commands: WorkerCommand[] = []
    const core = new ThreadManagerCore(createThreadWorkerRegistry(commands))
    core.saveThread({
      threadId: 'thread-a',
      projectId: 'project-a',
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })

    await expect(getCommands(core, 'thread-a')).resolves.toEqual([
      {
        name: 'mycommand',
        source: 'extension',
        sourceInfo: { extensionPath: 'extension.ts' }
      }
    ])
    await runCommand(core, { threadId: 'thread-a', command: 'mycommand' })
    await respondUi(core, { threadId: 'thread-a', response: { value: 'ok' } })
    await respondApproval(core, {
      threadId: 'thread-a',
      response: {
        approvalId: 'approval-a',
        allow: true,
        scope: 'once'
      }
    })

    expect(commands).toEqual([
      { type: 'get_commands' },
      {
        type: 'prompt',
        message: '/mycommand',
        images: undefined,
        streamingBehavior: undefined
      },
      { type: 'ui.respond', response: { value: 'ok' } },
      {
        type: 'approval.respond',
        response: {
          approvalId: 'approval-a',
          allow: true,
          scope: 'once'
        }
      }
    ])
  })
})

/**
 * 创建记录命令的 ThreadWorkerRegistry stub。
 * @param commands - 命令收集数组。
 * @returns ThreadWorkerRegistry stub。
 */
function createThreadWorkerRegistry(commands: WorkerCommand[]): ThreadWorkerRegistry {
  return {
    listLeases: () => [{ threadId: 'thread-a', workerId: 'worker-a' }],
    send: async (_threadId: string, command: WorkerCommand): Promise<WorkerResponseEnvelope> => {
      commands.push(command)
      if (command.type === 'get_commands') {
        return {
          kind: 'response',
          id: 'response-a',
          command: command.type,
          success: true,
          data: {
            commands: [
              {
                name: 'mycommand',
                source: 'extension',
                sourceInfo: { extensionPath: 'extension.ts' }
              }
            ]
          }
        }
      }
      return {
        kind: 'response',
        id: 'response-a',
        command: command.type,
        success: true
      }
    }
  } as unknown as ThreadWorkerRegistry
}
