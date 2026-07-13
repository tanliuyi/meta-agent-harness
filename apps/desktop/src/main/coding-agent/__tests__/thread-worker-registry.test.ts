/**
 * 本文件测试 ThreadWorkerRegistry 生命周期事件。
 */

import { describe, expect, it } from 'vitest'
import { ThreadWorkerRegistry, type ThreadWorkerLifecycleEvent } from '../thread-worker-registry'
import type {
  StartThreadInput,
  WorkerClient,
  WorkerCommand,
  WorkerEnvelope,
  WorkerHangInfo,
  WorkerResponseEnvelope,
  WorkerSnapshot
} from '../worker-types'

describe('ThreadWorkerRegistry', () => {
  it('shutdown 等待尚未完成的 worker 创建并立即终止返回的 worker', async () => {
    let resolveWorker: ((worker: WorkerClient) => void) | undefined
    const stopReasons: string[] = []
    const registry = new ThreadWorkerRegistry({
      createWorker: () =>
        new Promise<WorkerClient>((resolve) => {
          resolveWorker = resolve
        })
    })

    const acquisition = registry
      .acquireThreadWorker({ threadId: 'thread-a', cwd: '/tmp/project-a' })
      .then(
        () => undefined,
        (error: unknown) => error
      )
    await waitUntil(() => Boolean(resolveWorker))

    let shutdownFinished = false
    const shutdown = registry.shutdown().then(() => {
      shutdownFinished = true
    })
    await waitMs(0)
    expect(shutdownFinished).toBe(false)

    resolveWorker?.({
      ...createFakeWorker('worker-a'),
      stop: async (reason: string) => {
        stopReasons.push(reason)
      }
    })

    await shutdown
    expect(await acquisition).toMatchObject({ message: 'worker registry is closed' })
    expect(stopReasons).toEqual(['shutdown'])
    expect(registry.listLeases()).toEqual([])
  })

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
    expect(
      registry
        .listLeases()
        .map((lease) => lease.threadId)
        .sort()
    ).toEqual(['thread-a', 'thread-b'])
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

  it('startThread 挂起期间普通 runtime 命令等待 worker 绑定完成', async () => {
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
    const send = registry.send('thread-a', { type: 'get_commands' })
    await waitMs(0)
    expect(commands).toEqual([])

    resolveStart?.()
    await expect(send).resolves.toMatchObject({
      success: true,
      command: 'get_commands'
    })
    await acquire
    expect(commands).toEqual([{ type: 'get_commands' }])
  })

  it('startThread 挂起期间 worker hang 会释放等待中的普通 runtime 命令', async () => {
    let started = false
    let hangListener: ((info: WorkerHangInfo) => void) | undefined
    const stopReasons: string[] = []
    const registry = new ThreadWorkerRegistry({
      createWorker: async () => ({
        ...createFakeWorker('worker-a'),
        startThread: async () => {
          started = true
          await new Promise<void>(() => {})
        },
        onHang: (listener) => {
          hangListener = listener
          return () => {
            hangListener = undefined
          }
        },
        stop: async (reason: string) => {
          stopReasons.push(reason)
        }
      })
    })

    const acquire = registry
      .acquireThreadWorker({
        threadId: 'thread-a',
        cwd: '/tmp/project-a'
      })
      .then(
        () => undefined,
        (error: unknown) => error
      )

    await waitUntil(() => started && Boolean(hangListener))
    const send = registry.send('thread-a', { type: 'get_commands' })
    await waitMs(0)

    hangListener?.({ workerId: 'worker-a', threadId: 'thread-a', silentMs: 1000 })

    await expect(send).resolves.toMatchObject({
      success: false,
      command: 'get_commands',
      error: {
        code: 'runtime_error',
        message: 'worker hang: no message for 1000ms'
      }
    })
    expect(await acquire).toBeInstanceOf(Error)
    expect(stopReasons).toEqual(['crash'])
  })

  it('idle 超时时自动释放 worker，reason 为 idle', async () => {
    let now = 0
    const events: ThreadWorkerLifecycleEvent[] = []
    const stopReasons: string[] = []
    const registry = new ThreadWorkerRegistry({
      now: () => now,
      onLifecycle: (event) => events.push(event),
      idleTimeoutMs: 1000,
      idleCheckIntervalMs: 300,
      createWorker: async () => ({
        ...createFakeWorker('worker-a'),
        stop: async (reason: string) => {
          stopReasons.push(reason)
        }
      })
    })

    await registry.acquireThreadWorker({ threadId: 'thread-a', cwd: '/tmp/project-a' })
    now = 500
    await waitMs(400)
    expect(registry.listLeases()).toHaveLength(1)

    now = 1200
    await waitMs(500)
    expect(registry.listLeases()).toHaveLength(0)
    expect(stopReasons).toEqual(['idle'])
    expect(events).toContainEqual({
      type: 'worker.run.finished',
      workerId: 'worker-a',
      threadId: 'thread-a',
      reason: 'idle',
      startedAt: 0,
      exitedAt: 1200
    })
  })

  it('canonical agent_start 后即使 idle 超时也不回收 running worker', async () => {
    let now = 0
    const stopReasons: string[] = []
    let eventListener: ((event: WorkerEnvelope) => void) | undefined
    const registry = new ThreadWorkerRegistry({
      now: () => now,
      idleTimeoutMs: 1000,
      idleCheckIntervalMs: 300,
      createWorker: async () => ({
        ...createFakeWorker('worker-a'),
        onEvent: (listener) => {
          eventListener = listener
          return () => {
            eventListener = undefined
          }
        },
        stop: async (reason: string) => {
          stopReasons.push(reason)
        }
      })
    })

    await registry.acquireThreadWorker({ threadId: 'thread-a', cwd: '/tmp/project-a' })
    eventListener?.({
      kind: 'event',
      eventType: 'canonical',
      threadId: 'thread-a',
      event: { type: 'agent_start' }
    })
    now = 1200
    await waitMs(500)

    expect(registry.listLeases()).toHaveLength(1)
    expect(stopReasons).toHaveLength(0)

    eventListener?.({
      kind: 'event',
      eventType: 'canonical',
      threadId: 'thread-a',
      event: { type: 'agent_end', messages: [], willRetry: false }
    })
    now = 2400
    await waitMs(500)

    expect(registry.listLeases()).toHaveLength(0)
    expect(stopReasons).toEqual(['idle'])
  })

  it('idle 扫描遇到已并发释放的 worker 时继续完成回收', async () => {
    let now = 0
    let count = 0
    const stopReasons: Array<{ workerId: string; reason: string }> = []
    const registry = new ThreadWorkerRegistry({
      now: () => now,
      idleTimeoutMs: 1000,
      idleCheckIntervalMs: 50,
      createWorker: async () => {
        const workerId = `worker-${++count}`
        return {
          ...createFakeWorker(workerId),
          stop: async (reason: string) => {
            stopReasons.push({ workerId, reason })
            if (
              workerId === 'worker-1' &&
              registry.listLeases().some((lease) => lease.threadId === 'thread-b')
            ) {
              await registry.releaseThreadWorker('thread-b', 'stop')
            }
          }
        }
      }
    })

    await registry.acquireThreadWorker({ threadId: 'thread-a', cwd: '/tmp/project-a' })
    await registry.acquireThreadWorker({ threadId: 'thread-b', cwd: '/tmp/project-b' })
    now = 1200
    await waitMs(100)

    expect(registry.listLeases()).toHaveLength(0)
    expect(stopReasons).toEqual([
      { workerId: 'worker-1', reason: 'idle' },
      { workerId: 'worker-2', reason: 'stop' }
    ])
  })

  it('worker 返回 worker_exited 时释放租约并记录 crash 生命周期', async () => {
    let now = 0
    const events: ThreadWorkerLifecycleEvent[] = []
    const stopReasons: string[] = []
    const registry = new ThreadWorkerRegistry({
      now: () => now,
      onLifecycle: (event) => events.push(event),
      createWorker: async () => ({
        ...createFakeWorker('worker-a'),
        send: async (command: WorkerCommand): Promise<WorkerResponseEnvelope> => ({
          kind: 'response',
          id: 'fake',
          command: command.type,
          success: false,
          error: {
            code: 'worker_exited',
            message: 'worker is stopped',
            recoverable: true
          }
        }),
        stop: async (reason: string) => {
          stopReasons.push(reason)
        }
      })
    })

    await registry.acquireThreadWorker({ threadId: 'thread-a', cwd: '/tmp/project-a' })
    now = 200
    const response = await registry.send('thread-a', { type: 'get_state' })

    expect(response).toMatchObject({
      success: false,
      error: { code: 'worker_exited' }
    })
    expect(registry.listLeases()).toHaveLength(0)
    expect(stopReasons).toEqual(['crash'])
    expect(events.at(-1)).toMatchObject({
      type: 'worker.run.finished',
      workerId: 'worker-a',
      threadId: 'thread-a',
      reason: 'crash',
      startedAt: 0,
      exitedAt: 200,
      message: 'worker is stopped'
    })
  })

  it('idle worker hang 会释放租约但不记录 crash', async () => {
    let hangListener: ((info: WorkerHangInfo) => void) | undefined
    const events: ThreadWorkerLifecycleEvent[] = []
    const stopReasons: string[] = []
    const registry = new ThreadWorkerRegistry({
      onLifecycle: (event) => events.push(event),
      createWorker: async () => ({
        ...createFakeWorker('worker-a'),
        onHang: (listener) => {
          hangListener = listener
          return () => {
            hangListener = undefined
          }
        },
        stop: async (reason: string) => {
          stopReasons.push(reason)
        }
      })
    })

    await registry.acquireThreadWorker({ threadId: 'thread-a', cwd: '/tmp/project-a' })
    hangListener?.({ workerId: 'worker-a', threadId: 'thread-a', silentMs: 217137 })
    await waitMs(0)

    expect(registry.listLeases()).toHaveLength(0)
    expect(stopReasons).toEqual(['idle'])
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'worker.run.finished',
        workerId: 'worker-a',
        threadId: 'thread-a',
        reason: 'idle'
      })
    )
  })

  it('running worker hang 时释放租约并记录 crash 生命周期', async () => {
    let hangListener: ((info: WorkerHangInfo) => void) | undefined
    let eventListener: ((event: WorkerEnvelope) => void) | undefined
    let now = 0
    const events: ThreadWorkerLifecycleEvent[] = []
    const stopReasons: string[] = []
    const registry = new ThreadWorkerRegistry({
      now: () => now,
      onLifecycle: (event) => events.push(event),
      createWorker: async () => ({
        ...createFakeWorker('worker-a'),
        onEvent: (listener) => {
          eventListener = listener
          return () => {
            eventListener = undefined
          }
        },
        onHang: (listener) => {
          hangListener = listener
          return () => {
            hangListener = undefined
          }
        },
        stop: async (reason: string) => {
          stopReasons.push(reason)
        }
      })
    })

    await registry.acquireThreadWorker({ threadId: 'thread-a', cwd: '/tmp/project-a' })
    eventListener?.({
      kind: 'event',
      eventType: 'projection',
      threadId: 'thread-a',
      event: { type: 'thread.stateChanged', threadId: 'thread-a', status: 'running' }
    })
    now = 200
    hangListener?.({ workerId: 'worker-a', threadId: 'thread-a', silentMs: 1000 })
    await waitUntil(() => registry.listLeases().length === 0)

    expect(stopReasons).toEqual(['crash'])
    expect(events.at(-1)).toMatchObject({
      type: 'worker.run.finished',
      workerId: 'worker-a',
      threadId: 'thread-a',
      reason: 'crash',
      startedAt: 0,
      exitedAt: 200,
      message: 'worker hang: no message for 1000ms'
    })
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

async function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
