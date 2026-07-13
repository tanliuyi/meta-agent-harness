/**
 * 本文件实现 Electron main 内部 coding agent thread 到 utility worker 的绑定与路由。
 */

import type {
  StartThreadInput,
  WorkerClient,
  WorkerCommand,
  WorkerEnvelope,
  WorkerExitInfo,
  WorkerHangInfo,
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
  /** 是否启用 idle 超时回收。 */
  enableIdleTimeout?: boolean
  /** idle 超时毫秒数，默认 10 分钟。 */
  idleTimeoutMs?: number
  /** idle 检查间隔毫秒数，默认 3 分钟。 */
  idleCheckIntervalMs?: number
}

/** Thread worker 生命周期事件。 */
export type ThreadWorkerLifecycleEvent =
  | {
      type: 'worker.run.started'
      workerId: string
      threadId: string
      cwd: string
      startedAt: number
    }
  | {
      type: 'worker.run.finished'
      workerId: string
      threadId: string
      reason: 'idle' | 'stop' | 'archive' | 'crash' | 'shutdown'
      startedAt: number
      exitedAt: number
      message?: string
      details?: unknown
    }
  | { type: 'worker.run.failed'; threadId?: string; message: string; createdAt: number }

interface StartingThreadWaiter {
  promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

class ThreadStartReleasedError extends Error {
  constructor(threadId: string) {
    super(`thread worker was released while starting: ${threadId}`)
    this.name = 'ThreadStartReleasedError'
  }
}

class ThreadWorkerRegistryClosedError extends Error {
  constructor() {
    super('worker registry is closed')
    this.name = 'ThreadWorkerRegistryClosedError'
  }
}

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
  /** threadId -> 可取消启动等待器，用于启动期命令等待 runtime 绑定完成。 */
  private readonly startingThreads = new Map<string, StartingThreadWaiter>()
  /** 正在创建 worker 的 threadId 集合。 */
  private readonly pendingThreads = new Set<string>()
  /** 正在创建或启动的 worker acquisition；shutdown 必须等待它们全部收束。 */
  private readonly pendingAcquisitions = new Set<Promise<WorkerLease>>()
  /** 是否已关闭。 */
  private closed = false
  /** 是否启用 idle 超时回收。 */
  private readonly enableIdleTimeout: boolean
  /** idle 超时毫秒数。 */
  private readonly idleTimeoutMs: number
  /** idle 检查间隔毫秒数。 */
  private readonly idleCheckIntervalMs: number
  /** idle 检查计时器。 */
  private idleCheckTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * 创建 ThreadWorkerRegistry 实例。
   * @param options - registry 选项。
   */
  constructor(options: ThreadWorkerRegistryOptions) {
    this.createWorker = options.createWorker
    this.onEvent = options.onEvent
    this.onLifecycle = options.onLifecycle
    this.now = options.now ?? Date.now
    this.enableIdleTimeout = options.enableIdleTimeout ?? true
    this.idleTimeoutMs = options.idleTimeoutMs ?? 600000
    this.idleCheckIntervalMs = options.idleCheckIntervalMs ?? 180000
  }

  /**
   * 启动 idle 检查计时器。
   */
  private startIdleCheck(): void {
    if (this.idleCheckTimer || !this.enableIdleTimeout || this.closed) {
      return
    }
    this.idleCheckTimer = setTimeout(() => {
      this.idleCheckTimer = undefined
      void this.checkIdleWorkers()
    }, this.idleCheckIntervalMs)
  }

  /**
   * 检查并回收 idle 超时的 worker。
   */
  private async checkIdleWorkers(): Promise<void> {
    if (this.closed || this.leases.size === 0) {
      return
    }
    try {
      const now = this.now()
      const candidates: string[] = []
      this.leases.forEach((lease, threadId) => {
        if (lease.status === 'running') {
          return
        }
        if (now - lease.lastActiveAt >= this.idleTimeoutMs) {
          candidates.push(threadId)
        }
      })
      for (const threadId of candidates) {
        if (this.leases.has(threadId)) {
          await this.releaseThreadWorker(threadId, 'idle')
        }
      }
    } finally {
      this.startIdleCheck()
    }
  }

  /**
   * 停止 idle 检查计时器。
   */
  private stopIdleCheck(): void {
    if (this.idleCheckTimer) {
      clearTimeout(this.idleCheckTimer)
      this.idleCheckTimer = undefined
    }
  }

  /**
   * 创建并绑定指定线程的 worker。
   * @param input - 启动线程输入。
   * @returns worker 租约。
   * @throws 当线程已绑定 worker 或 registry 已关闭时。
   */
  acquireThreadWorker(input: StartThreadInput): Promise<WorkerLease> {
    const acquisition = this.acquireThreadWorkerInternal(input)
    this.pendingAcquisitions.add(acquisition)
    void acquisition.then(
      () => this.pendingAcquisitions.delete(acquisition),
      () => this.pendingAcquisitions.delete(acquisition)
    )
    return acquisition
  }

  private async acquireThreadWorkerInternal(input: StartThreadInput): Promise<WorkerLease> {
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
      if (this.closed) {
        await worker.stop('shutdown')
        throw new ThreadWorkerRegistryClosedError()
      }
      worker.onEvent?.((event) => this.onWorkerEvent(input.threadId, event))
      worker.onHang?.((info) => {
        void this.releaseHungWorker(info)
      })
      worker.onExit?.((info) => {
        void this.releaseExitedWorker(info)
      })
      const time = this.now()
      const lease: WorkerLease = {
        workerId: worker.workerId,
        threadId: input.threadId,
        cwd: input.cwd,
        sessionFile: input.sessionFile,
        acquiredAt: time,
        lastActiveAt: time,
        lastEventAt: time,
        status: 'starting'
      }
      this.workers.set(worker.workerId, worker)
      this.leases.set(input.threadId, lease)
      this.startIdleCheck()
      const startingThread = createStartingThreadWaiter()
      this.startingThreads.set(input.threadId, startingThread)
      void worker.startThread(input).then(startingThread.resolve, startingThread.reject)
      await startingThread.promise
      const activeLease = this.leases.get(input.threadId)
      if (!activeLease || activeLease.workerId !== worker.workerId) {
        throw new ThreadStartReleasedError(input.threadId)
      }
      activeLease.status = 'idle'
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
        this.resolveStartingThread(input.threadId)
        const worker = this.workers.get(lease.workerId)
        this.workers.delete(lease.workerId)
        await worker?.stop('crash')
      }
      if (
        !(error instanceof ThreadStartReleasedError) &&
        !(error instanceof ThreadWorkerRegistryClosedError)
      ) {
        this.onLifecycle?.({
          type: 'worker.run.failed',
          threadId: input.threadId,
          message: error instanceof Error ? error.message : String(error),
          createdAt: this.now()
        })
      }
      throw error instanceof Error ? error : new Error(String(error))
    } finally {
      this.startingThreads.delete(input.threadId)
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
    reason: 'idle' | 'stop' | 'archive' | 'crash',
    diagnostic?: { message?: string; details?: unknown }
  ): Promise<void> {
    const lease = this.leases.get(threadId)
    if (!lease) {
      throw new Error(`thread has no worker: ${threadId}`)
    }
    const worker = this.workers.get(lease.workerId)
    this.leases.delete(threadId)
    if (lease.status === 'starting' && reason === 'crash') {
      this.rejectStartingThread(
        threadId,
        new Error(diagnostic?.message ?? `worker exited while starting: ${threadId}`)
      )
    } else {
      this.resolveStartingThread(threadId)
    }
    this.startingThreads.delete(threadId)
    if (this.leases.size === 0) {
      this.stopIdleCheck()
    }
    if (worker) {
      await worker.stop(reason)
      this.workers.delete(worker.workerId)
    }
    this.onLifecycle?.({
      type: 'worker.run.finished',
      workerId: lease.workerId,
      threadId,
      reason,
      startedAt: lease.acquiredAt,
      exitedAt: this.now(),
      message: diagnostic?.message,
      details: diagnostic?.details
    })
  }

  /**
   * 向指定线程的 worker 发送命令。
   * @param threadId - 线程 ID。
   * @param command - 要发送的命令。
   * @returns worker 响应。
   */
  async send(threadId: string, command: WorkerCommand): Promise<WorkerResponseEnvelope> {
    let lease = this.leases.get(threadId)
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
    if (lease.status === 'starting' && !canSendWhileStarting(command)) {
      const startingThread = this.startingThreads.get(threadId)
      if (startingThread) {
        try {
          await startingThread.promise
        } catch (error) {
          return {
            kind: 'response',
            id: 'worker-registry',
            command: command.type,
            success: false,
            error: {
              code: 'runtime_error',
              message: error instanceof Error ? error.message : String(error),
              recoverable: true
            }
          }
        }
      }
      lease = this.leases.get(threadId)
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
    const response = await worker.send(command)
    if (response.error?.code === 'worker_exited' && this.leases.has(threadId)) {
      await this.releaseThreadWorker(threadId, 'crash', {
        message: response.error.message,
        details: response.error.details
      })
    }
    return response
  }

  /**
   * 列出所有 worker 租约。
   * @returns worker 租约数组。
   */
  listLeases(): WorkerLease[] {
    return Array.from(this.leases.values())
  }

  /**
   * 关闭所有已绑定的 worker。
   */
  async shutdown(): Promise<void> {
    this.closed = true
    this.stopIdleCheck()
    const pendingAcquisitions = Array.from(this.pendingAcquisitions)
    const workers = Array.from(this.workers.values())
    const leases = Array.from(this.leases.values())
    this.workers.clear()
    this.leases.clear()
    this.pendingThreads.clear()
    leases.forEach((lease) => this.resolveStartingThread(lease.threadId))
    this.startingThreads.clear()
    await Promise.all(workers.map((worker) => worker.stop('shutdown')))
    await Promise.allSettled(pendingAcquisitions)
    const exitedAt = this.now()
    leases.forEach((lease) => {
      this.onLifecycle?.({
        type: 'worker.run.finished',
        workerId: lease.workerId,
        threadId: lease.threadId,
        reason: 'shutdown',
        startedAt: lease.acquiredAt,
        exitedAt
      })
    })
  }

  /**
   * 处理 worker 事件，更新租约活跃时间并透传给上层。
   * @param threadId - 所属线程 ID。
   * @param event - worker 事件。
   */
  private onWorkerEvent(threadId: string | undefined, event: WorkerEnvelope): void {
    if (threadId) {
      const lease = this.leases.get(threadId)
      if (lease) {
        const time = this.now()
        lease.lastActiveAt = time
        lease.lastEventAt = time
        if (event.kind === 'event') {
          if (event.eventType === 'projection' && event.event.type === 'thread.stateChanged') {
            lease.status = event.event.status
          } else if (event.eventType === 'canonical') {
            if (event.event.type === 'agent_start') {
              lease.status = 'running'
            } else if (event.event.type === 'agent_end' && !event.event.willRetry) {
              lease.status = 'idle'
            }
          }
        }
      }
    }
    this.onEvent?.(event)
  }

  /**
   * 释放 hang 的 worker 租约。
   * @param info - hang 信息。
   */
  private async releaseHungWorker(info: WorkerHangInfo): Promise<void> {
    const threadId = info.threadId
    if (!threadId) {
      return
    }
    const lease = this.leases.get(threadId)
    if (!lease) {
      return
    }
    if (lease.status === 'running' || lease.status === 'starting') {
      await this.releaseThreadWorker(threadId, 'crash', {
        message: `worker hang: no message for ${info.silentMs}ms`,
        details: { silentMs: info.silentMs, workerId: info.workerId, leaseStatus: lease.status }
      })
      return
    }
    await this.releaseThreadWorker(threadId, 'idle')
  }

  /**
   * 释放已退出 worker 的租约。
   * @param info - exit 信息。
   */
  private async releaseExitedWorker(info: WorkerExitInfo): Promise<void> {
    const lease = info.threadId
      ? this.leases.get(info.threadId)
      : Array.from(this.leases.values()).find((candidate) => candidate.workerId === info.workerId)
    if (!lease || !this.leases.has(lease.threadId)) {
      this.workers.delete(info.workerId)
      return
    }
    await this.releaseThreadWorker(lease.threadId, 'crash', {
      message: info.reason,
      details: { workerId: info.workerId, transportReason: info.reason }
    })
  }

  /**
   * 断言 registry 未关闭。
   * @throws 当 registry 已关闭时。
   */
  private assertOpen(): void {
    if (this.closed) {
      throw new ThreadWorkerRegistryClosedError()
    }
  }

  /**
   * 完成启动等待器，让等待 starting 状态的命令重新检查租约状态。
   * @param threadId - 线程 ID。
   */
  private resolveStartingThread(threadId: string): void {
    this.startingThreads.get(threadId)?.resolve()
  }

  private rejectStartingThread(threadId: string, error: Error): void {
    this.startingThreads.get(threadId)?.reject(error)
  }
}

function createStartingThreadWaiter(): StartingThreadWaiter {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function canSendWhileStarting(command: WorkerCommand): boolean {
  return (
    command.type === 'approval.respond' ||
    command.type === 'ui.respond' ||
    command.type === 'ui.editorTextChanged' ||
    command.type === 'ui.toolsExpandedChanged'
  )
}
