/**
 * 本文件实现 Electron main 内部 coding agent thread 到 utility worker 的绑定与路由。
 */

import type {
  StartThreadInput,
  WorkerClient,
  WorkerCommand,
  WorkerEnvelope,
  WorkerLease,
  WorkerResponseEnvelope
} from './worker-types'

/**
 * Thread worker registry 选项。
 */
export interface ThreadWorkerRegistryOptions {
  /** 创建 worker 客户端的工厂函数。 */
  createWorker: () => Promise<WorkerClient>
  /** 可选的事件监听器。 */
  onEvent?: (event: WorkerEnvelope) => void
  /** 可选的生命周期监听器。 */
  onLifecycle?: (event: ThreadWorkerLifecycleEvent) => void
  /** 获取当前时间戳的函数，用于测试注入。 */
  now?: () => number
}

/** Thread worker 生命周期事件。 */
export type ThreadWorkerLifecycleEvent =
  | { type: 'worker.run.started'; workerId: string; threadId: string; cwd: string; startedAt: number }
  | {
      type: 'worker.run.finished'
      workerId: string
      threadId: string
      reason: 'idle' | 'stop' | 'archive' | 'crash' | 'shutdown'
      startedAt: number
      exitedAt: number
    }
  | { type: 'worker.run.failed'; threadId?: string; message: string; createdAt: number }

/**
 * 管理 thread 与独立 utility worker 进程的绑定。
 */
export class ThreadWorkerRegistry {
  /** 创建 worker 客户端的工厂函数。 */
  private readonly createWorker: () => Promise<WorkerClient>
  /** 可选的全局事件监听器。 */
  private readonly onEvent: ((event: WorkerEnvelope) => void) | undefined
  /** 可选的生命周期监听器。 */
  private readonly onLifecycle: ((event: ThreadWorkerLifecycleEvent) => void) | undefined
  /** 获取当前时间戳的函数。 */
  private readonly now: () => number
  /** workerId -> WorkerClient 映射。 */
  private readonly workers = new Map<string, WorkerClient>()
  /** threadId -> WorkerLease 映射。 */
  private readonly leases = new Map<string, WorkerLease>()
  /** 正在创建 worker 的 threadId 集合。 */
  private readonly pendingThreads = new Set<string>()
  /** 是否已关闭。 */
  private closed = false

  /**
   * 创建 ThreadWorkerRegistry 实例。
   * @param options - registry 选项。
   */
  constructor(options: ThreadWorkerRegistryOptions) {
    this.createWorker = options.createWorker
    this.onEvent = options.onEvent
    this.onLifecycle = options.onLifecycle
    this.now = options.now ?? Date.now
  }

  /**
   * 创建并绑定指定线程的 worker。
   * @param input - 启动线程输入。
   * @returns worker 租约。
   * @throws 当线程已绑定 worker 或 registry 已关闭时。
   */
  async acquireThreadWorker(input: StartThreadInput): Promise<WorkerLease> {
    this.assertOpen()
    if (!input.threadId) {
      throw new Error('threadId is required')
    }
    if (this.leases.has(input.threadId) || this.pendingThreads.has(input.threadId)) {
      throw new Error(`thread already has a worker: ${input.threadId}`)
    }
    this.pendingThreads.add(input.threadId)
    try {
      const worker = await this.createWorker()
      worker.onEvent?.((event) => this.onEvent?.(event))
      const time = this.now()
      const lease: WorkerLease = {
        workerId: worker.workerId,
        threadId: input.threadId,
        cwd: input.cwd,
        sessionFile: input.sessionFile,
        acquiredAt: time,
        lastActiveAt: time
      }
      this.workers.set(worker.workerId, worker)
      this.leases.set(input.threadId, lease)
      await worker.startThread(input)
      this.onLifecycle?.({
        type: 'worker.run.started',
        workerId: worker.workerId,
        threadId: input.threadId,
        cwd: input.cwd,
        startedAt: time
      })
      return lease
    } catch (error) {
      const lease = this.leases.get(input.threadId)
      if (lease) {
        this.leases.delete(input.threadId)
        const worker = this.workers.get(lease.workerId)
        this.workers.delete(lease.workerId)
        await worker?.stop('crash')
      }
      this.onLifecycle?.({
        type: 'worker.run.failed',
        threadId: input.threadId,
        message: error instanceof Error ? error.message : String(error),
        createdAt: this.now()
      })
      throw error instanceof Error ? error : new Error(String(error))
    } finally {
      this.pendingThreads.delete(input.threadId)
    }
  }

  /**
   * 释放绑定到指定线程的 worker。
   * @param threadId - 线程 ID。
   * @param reason - 释放原因。
   * @throws 当线程没有绑定 worker 时。
   */
  async releaseThreadWorker(
    threadId: string,
    reason: 'idle' | 'stop' | 'archive' | 'crash'
  ): Promise<void> {
    const lease = this.leases.get(threadId)
    if (!lease) {
      throw new Error(`thread has no worker: ${threadId}`)
    }
    const worker = this.workers.get(lease.workerId)
    this.leases.delete(threadId)
    if (worker) {
      this.workers.delete(worker.workerId)
      await worker.stop(reason)
    }
    this.onLifecycle?.({
      type: 'worker.run.finished',
      workerId: lease.workerId,
      threadId,
      reason,
      startedAt: lease.acquiredAt,
      exitedAt: this.now()
    })
  }

  /**
   * 向指定线程的 worker 发送命令。
   * @param threadId - 线程 ID。
   * @param command - 要发送的命令。
   * @returns worker 响应。
   */
  async send(threadId: string, command: WorkerCommand): Promise<WorkerResponseEnvelope> {
    const lease = this.leases.get(threadId)
    if (!lease) {
      return {
        kind: 'response',
        id: 'worker-registry',
        command: command.type,
        success: false,
        error: {
          code: 'thread_not_found',
          message: `thread has no worker: ${threadId}`,
          recoverable: true
        }
      }
    }
    const worker = this.workers.get(lease.workerId)
    if (!worker) {
      return {
        kind: 'response',
        id: 'worker-registry',
        command: command.type,
        success: false,
        error: {
          code: 'worker_not_found',
          message: `worker not found: ${lease.workerId}`,
          recoverable: true
        }
      }
    }
    lease.lastActiveAt = this.now()
    return worker.send(command)
  }

  /**
   * 列出所有 worker 租约。
   * @returns worker 租约数组。
   */
  listLeases(): WorkerLease[] {
    return [...this.leases.values()]
  }

  /**
   * 关闭所有已绑定的 worker。
   */
  async shutdown(): Promise<void> {
    this.closed = true
    const workers = [...this.workers.values()]
    const leases = [...this.leases.values()]
    this.workers.clear()
    this.leases.clear()
    this.pendingThreads.clear()
    await Promise.all(workers.map((worker) => worker.stop('shutdown')))
    const exitedAt = this.now()
    for (const lease of leases) {
      this.onLifecycle?.({
        type: 'worker.run.finished',
        workerId: lease.workerId,
        threadId: lease.threadId,
        reason: 'shutdown',
        startedAt: lease.acquiredAt,
        exitedAt
      })
    }
  }

  /**
   * 断言 registry 未关闭。
   * @throws 当 registry 已关闭时。
   */
  private assertOpen(): void {
    if (this.closed) {
      throw new Error('worker registry is closed')
    }
  }
}
