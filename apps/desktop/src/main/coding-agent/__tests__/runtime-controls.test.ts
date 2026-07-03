/**
 * 本文件测试 desktop runtime controls 到 worker command 的桥接。
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ThreadManagerCore } from '../thread-manager-core'
import { getCommands, respondApproval, respondUi } from '../thread-runtime-controls'
import { followUp, prompt, runCommand, steer } from '../thread-agent-commands'
import { setThreadTitle } from '../thread-session-commands'
import type { WorkerCommand, WorkerResponseEnvelope } from '../worker-types'
import type { ThreadWorkerRegistry } from '../thread-worker-registry'

describe('thread-runtime-controls', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('桥接 extension command、UI response 与 approval response 到 worker command', async () => {
    const commands: WorkerCommand[] = []
    const core = createThreadManagerCore(commands)
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
    await respondUi(core, { threadId: 'thread-a', response: { id: 'ui-a', value: 'ok' } })
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
      { type: 'ui.respond', response: { id: 'ui-a', value: 'ok' } },
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

  it('prompt 只更新运行状态，不自动写入 thread title', async () => {
    const commands: WorkerCommand[] = []
    const core = createThreadManagerCore(commands)
    core.saveThread({
      threadId: 'thread-a',
      projectId: 'project-a',
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })

    await prompt(core, {
      threadId: 'thread-a',
      message: '  这是第一条 prompt，应该成为会话标题，并且超过限制后截断  '
    })

    expect(core.requireThread('thread-a')).toMatchObject({
      status: 'running'
    })
    expect(core.requireThread('thread-a').title).toBeUndefined()
  })

  it('steer 与 followUp 直接桥接到 Pi canonical worker command', async () => {
    const commands: WorkerCommand[] = []
    const core = createThreadManagerCore(commands)
    core.saveThread({
      threadId: 'thread-a',
      projectId: 'project-a',
      status: 'running',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })

    await steer(core, { threadId: 'thread-a', message: 'change direction' })
    await followUp(core, { threadId: 'thread-a', message: 'after current work' })

    expect(commands).toEqual([
      {
        type: 'steer',
        message: 'change direction',
        images: undefined
      },
      {
        type: 'follow_up',
        message: 'after current work',
        images: undefined
      }
    ])
  })

  it('prompt 展开 Pi @file 文本文件参数后发送给 worker', async () => {
    const commands: WorkerCommand[] = []
    const core = createThreadManagerCore(commands)
    core.saveThread({
      threadId: 'thread-a',
      projectId: 'project-a',
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })
    const dir = join(tmpdir(), `desktop-file-args-${Date.now()}-${Math.random()}`)
    tempDirs.push(dir)
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, 'notes.txt')
    writeFileSync(filePath, 'hello from file')

    await prompt(core, {
      threadId: 'thread-a',
      message: '总结一下 @notes.txt',
      fileArgs: [filePath]
    })

    expect(commands[0]).toMatchObject({
      type: 'prompt',
      images: undefined,
      streamingBehavior: undefined
    })
    expect(commands[0]).toMatchObject({
      message: expect.stringContaining('<file name=')
    })
    expect((commands[0] as { message: string }).message).toContain('hello from file')
    expect((commands[0] as { message: string }).message).toContain('总结一下 @notes.txt')
  })

  it('图片文件处理失败时使用 inline fallback 发送给 worker', async () => {
    const commands: WorkerCommand[] = []
    const core = createThreadManagerCore(commands)
    core.saveThread({
      threadId: 'thread-a',
      projectId: 'project-a',
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })

    const imagePath = writeUndecodablePng(tempDirs)

    await prompt(core, {
      threadId: 'thread-a',
      message: '看图',
      imageFiles: [
        {
          path: imagePath,
          inlineFallback: {
            type: 'image',
            mimeType: 'image/png',
            data: 'abc'
          }
        }
      ]
    })

    expect(commands[0]).toMatchObject({
      type: 'prompt',
      message: expect.not.stringContaining('Image omitted'),
      images: [
        {
          type: 'image',
          mimeType: 'image/png',
          data: 'abc'
        }
      ]
    })
  })

  it('setThreadTitle 写入 thread title 并同步 worker session name', async () => {
    const commands: WorkerCommand[] = []
    const core = createThreadManagerCore(commands)
    core.saveThread({
      threadId: 'thread-a',
      projectId: 'project-a',
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })

    const thread = await setThreadTitle(core, {
      threadId: 'thread-a',
      title: '  这是 renderer 推导的标题  '
    })

    expect(thread.title).toBe('这是 renderer 推导的标题')
    expect(core.requireThread('thread-a').title).toBe('这是 renderer 推导的标题')
    expect(commands).toEqual([{ type: 'set_session_name', name: '这是 renderer 推导的标题' }])
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

/**
 * 创建 runtime controls 测试用 ThreadManagerCore。
 * @param commands - Worker 命令收集数组。
 * @returns ThreadManagerCore。
 */
function createThreadManagerCore(commands: WorkerCommand[]): ThreadManagerCore {
  return new ThreadManagerCore(
    createThreadWorkerRegistry(commands),
    undefined,
    undefined,
    undefined,
    undefined,
    {
      getImageAutoResize: async () => true
    } as never
  )
}

/**
 * 写入一个通过 PNG sniff、但无法被图片 resize 管线解码的临时文件。
 * @param tempDirs - 待清理目录列表。
 * @returns 图片路径。
 */
function writeUndecodablePng(tempDirs: string[]): string {
  const dir = join(tmpdir(), `desktop-runtime-controls-${Date.now()}-${Math.random()}`)
  tempDirs.push(dir)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'broken.png')
  writeFileSync(
    path,
    Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
      0x44, 0x52
    ])
  )
  return path
}
