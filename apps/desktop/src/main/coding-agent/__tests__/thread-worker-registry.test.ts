/**
 * 本文件测试 ThreadWorkerRegistry 生命周期事件。
 */

import { describe, expect, it } from 'vitest'
import { ThreadWorkerRegistry, type ThreadWorkerLifecycleEvent } from '../thread-worker-registry'
import type {
  StartThreadInput,
  WorkerClient,
  WorkerCommand,
  WorkerResponseEnvelope,
  WorkerSnapshot
} from '../worker-types'

describe('ThreadWorkerRegistry', () => {
  it('为并行 thread 立即创建独立 worker，不排队等待其它 thread 释放', async () => {
    let count = 0
    const registry = new ThreadWorkerRegistry({
      createWorker: async () => createFakeWorker(`worker-${++count}`)
    })

    const [first, second] = await Promise.all([
      registry.acquireThreadWorker({ threadId: 'thread-a', cwd: '/tmp/project-a' }),
      registry.acquireThreadWorker({ threadId: 'thread-b', cwd: '/tmp/project-b' })
    ])

    expect(first.workerId).toBe('worker-1')
    expect(second.workerId).toBe('worker-2')
    expect(registry.listLeases().map((lease) => lease.threadId).sort()).toEqual([
      'thread-a',
      'thread-b'
    ])
  })

  it('记录 worker run start 与 finish 生命周期', async () => {
    let now = 100
    const events: ThreadWorkerLifecycleEvent[] = []
    const registry = new ThreadWorkerRegistry({
      now: () => now,
      onLifecycle: (event) => events.push(event),
      createWorker: async () => createFakeWorker('worker-a')
    })

    await registry.acquireThreadWorker({
      threadId: 'thread-a',
      cwd: '/tmp/project-a'
    })
    now = 200
    await registry.releaseThreadWorker('thread-a', 'stop')

    expect(events).toEqual([
      {
        type: 'worker.run.started',
        workerId: 'worker-a',
        threadId: 'thread-a',
        cwd: '/tmp/project-a',
        startedAt: 100
      },
      {
        type: 'worker.run.finished',
        workerId: 'worker-a',
        threadId: 'thread-a',
        reason: 'stop',
        startedAt: 100,
        exitedAt: 200
      }
    ])
  })

  it('记录 worker start 失败 diagnostics 生命周期', async () => {
    const events: ThreadWorkerLifecycleEvent[] = []
    const registry = new ThreadWorkerRegistry({
      now: () => 300,
      onLifecycle: (event) => events.push(event),
      createWorker: async () => ({
        ...createFakeWorker('worker-a'),
        startThread: async () => {
          throw new Error('worker crashed while starting')
        }
      })
    })

    await expect(
      registry.acquireThreadWorker({
        threadId: 'thread-a',
        cwd: '/tmp/project-a'
      })
    ).rejects.toThrow('worker crashed while starting')

    expect(events).toEqual([
      {
        type: 'worker.run.failed',
        threadId: 'thread-a',
        message: 'worker crashed while starting',
        createdAt: 300
      }
    ])
  })

  it('startThread 挂起期间仍可向同一 worker 发送审批响应', async () => {
    let resolveStart: (() => void) | undefined
    const commands: WorkerCommand[] = []
    const registry = new ThreadWorkerRegistry({
      createWorker: async () => ({
        ...createFakeWorker('worker-a'),
        startThread: async () => {
          await new Promise<void>((resolve) => {
            resolveStart = resolve
          })
        },
        send: async (command: WorkerCommand): Promise<WorkerResponseEnvelope> => {
          commands.push(command)
          return {
            kind: 'response',
            id: 'fake',
            command: command.type,
            success: true
          }
        }
      })
    })

    const acquire = registry.acquireThreadWorker({
      threadId: 'thread-a',
      cwd: '/tmp/project-a'
    })

    await waitUntil(() => Boolean(resolveStart))
    await expect(
      registry.send('thread-a', {
        type: 'approval.respond',
        response: { approvalId: 'approval-a', allow: true, scope: 'workspace' }
      })
    ).resolves.toMatchObject({
      success: true,
      command: 'approval.respond'
    })

    resolveStart?.()
    await acquire
    expect(commands).toEqual([
      {
        type: 'approval.respond',
        response: { approvalId: 'approval-a', allow: true, scope: 'workspace' }
      }
    ])
  })
})

/**
 * 创建 fake worker。
 * @param workerId - worker ID。
 * @returns worker client。
 */
function createFakeWorker(workerId: string): WorkerClient {
  let threadId: string | undefined
  return {
    workerId,
    get threadId() {
      return threadId
    },
    startThread: async (input: StartThreadInput) => {
      threadId = input.threadId
    },
    send: async (command: WorkerCommand): Promise<WorkerResponseEnvelope> => ({
      kind: 'response',
      id: 'fake',
      command: command.type,
      success: true
    }),
    snapshot: (): WorkerSnapshot => ({
      workerId,
      threadId,
      state: threadId ? 'bound' : 'ready',
      diagnostics: []
    }),
    stop: async () => {
      threadId = undefined
    }
  }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('condition was not met')
}
