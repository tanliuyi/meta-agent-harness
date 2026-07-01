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

export interface WorkerPoolOptions {
  maxWorkers: number
  createWorker: () => Promise<WorkerClient>
  onEvent?: (event: WorkerEnvelope) => void
  now?: () => number
}

interface QueueItem {
  input: StartThreadInput
  resolve: (lease: WorkerLease) => void
  reject: (error: Error) => void
}

export class WorkerPool {
  private readonly maxWorkers: number
  private readonly createWorker: () => Promise<WorkerClient>
  private readonly onEvent: ((event: WorkerEnvelope) => void) | undefined
  private readonly now: () => number
  private readonly workers = new Map<string, WorkerClient>()
  private readonly leases = new Map<string, WorkerLease>()
  private readonly queue: QueueItem[] = []
  private active = 0
  private closed = false

  constructor(options: WorkerPoolOptions) {
    if (options.maxWorkers < 1) {
      throw new Error('maxWorkers must be at least 1')
    }
    this.maxWorkers = options.maxWorkers
    this.createWorker = options.createWorker
    this.onEvent = options.onEvent
    this.now = options.now ?? Date.now
  }

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

  listLeases(): WorkerLease[] {
    return [...this.leases.values()]
  }

  async shutdown(): Promise<void> {
    this.closed = true
    const workers = [...this.workers.values()]
    this.queue.splice(0).forEach((item) => item.reject(new Error('worker pool is closed')))
    this.workers.clear()
    this.leases.clear()
    this.active = 0
    await Promise.all(workers.map((worker) => worker.stop('shutdown')))
  }

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

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('worker pool is closed')
    }
  }
}
