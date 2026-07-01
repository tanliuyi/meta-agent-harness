/**
 * 本文件实现 Electron main 内部 coding agent worker 池。
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
 * Worker 池选项。
 */
export interface WorkerPoolOptions {
  /** 最大并发 worker 数。 */
  maxWorkers: number
  /** 创建 worker 客户端的工厂函数。 */
  createWorker: () => Promise<WorkerClient>
  /** 可选的事件监听器。 */
  onEvent?: (event: WorkerEnvelope) => void
  /** 获取当前时间戳的函数，用于测试注入。 */
  now?: () => number
}

/**
 * 等待分配 worker 的队列项。
 */
interface QueueItem {
  /** 启动线程输入。 */
  input: StartThreadInput
  /** 分配成功回调。 */
  resolve: (lease: WorkerLease) => void
  /** 分配失败回调。 */
  reject: (error: Error) => void
}

/**
 * Electron main 内部 coding agent worker 池，管理 worker 生命周期与线程绑定。
 */
export class WorkerPool {
  /** 最大并发 worker 数。 */
  private readonly maxWorkers: number
  /** 创建 worker 客户端的工厂函数。 */
  private readonly createWorker: () => Promise<WorkerClient>
  /** 可选的全局事件监听器。 */
  private readonly onEvent: ((event: WorkerEnvelope) => void) | undefined
  /** 获取当前时间戳的函数。 */
  private readonly now: () => number
  /** workerId -> WorkerClient 映射。 */
  private readonly workers = new Map<string, WorkerClient>()
  /** threadId -> WorkerLease 映射。 */
  private readonly leases = new Map<string, WorkerLease>()
  /** 等待队列。 */
  private readonly queue: QueueItem[] = []
  /** 当前活跃 worker 数量。 */
  private active = 0
  /** 是否已关闭。 */
  private closed = false

  /**
   * 创建 WorkerPool 实例。
   * @param options - worker 池选项。
   * @throws 当 maxWorkers 小于 1 时。
   */
  constructor(options: WorkerPoolOptions) {
    if (options.maxWorkers < 1) {
      throw new Error('maxWorkers must be at least 1')
    }
    this.maxWorkers = options.maxWorkers
    this.createWorker = options.createWorker
    this.onEvent = options.onEvent
    this.now = options.now ?? Date.now
  }

  /**
   * 获取或创建绑定到指定线程的 worker 租约。
   * @param input - 启动线程输入。
   * @returns worker 租约。
   * @throws 当线程已绑定 worker 或 pool 已关闭时。
   */
  acquireThreadWorker(input: StartThreadInput): Promise<WorkerLease> {
    this.assertOpen()
    if (!input.threadId) {
      throw new Error('threadId is required')
    }
    if (this.leases.has(input.threadId)) {
      throw new Error(`thread already has a worker: ${input.threadId}`)
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ input, resolve, reject })
      void this.drain()
    })
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
    this.active -= 1
    void this.drain()
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
        id: 'pool',
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
        id: 'pool',
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
   * 关闭 worker 池，停止所有 worker 并清空队列。
   */
  async shutdown(): Promise<void> {
    this.closed = true
    const workers = [...this.workers.values()]
    this.queue.splice(0).forEach((item) => item.reject(new Error('worker pool is closed')))
    this.workers.clear()
    this.leases.clear()
    this.active = 0
    await Promise.all(workers.map((worker) => worker.stop('shutdown')))
  }

  /**
   * 消费等待队列，按需创建 worker 直到达到上限。
   */
  private async drain(): Promise<void> {
    while (!this.closed && this.active < this.maxWorkers && this.queue.length > 0) {
      const item = this.queue.shift()
      if (!item) {
        return
      }
      this.active += 1
      try {
        const worker = await this.createWorker()
        worker.onEvent?.((event) => this.onEvent?.(event))
        await worker.startThread(item.input)
        if (!item.input.threadId) {
          throw new Error('threadId is required')
        }
        const time = this.now()
        const lease: WorkerLease = {
          workerId: worker.workerId,
          threadId: item.input.threadId,
          cwd: item.input.cwd,
          sessionFile: item.input.sessionFile,
          acquiredAt: time,
          lastActiveAt: time
        }
        this.workers.set(worker.workerId, worker)
        this.leases.set(item.input.threadId, lease)
        item.resolve(lease)
      } catch (error) {
        this.active -= 1
        item.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  /**
   * 断言 worker 池未关闭。
   * @throws 当 pool 已关闭时。
   */
  private assertOpen(): void {
    if (this.closed) {
      throw new Error('worker pool is closed')
    }
  }
}
