/**
 * 本文件实现 main 侧基于 transport 的 worker client。
 */

import type {
  StartThreadInput,
  WorkerClient,
  WorkerCommand,
  WorkerCommandEnvelope,
  WorkerEnvelope,
  WorkerResponseEnvelope,
  WorkerSnapshot,
  WorkerTransport
} from './worker-types'

interface PendingRequest {
  resolve: (response: WorkerResponseEnvelope) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface TransportWorkerClientOptions {
  workerId: string
  transport: WorkerTransport
  requestTimeoutMs?: number
  createRequestId?: () => string
}

export class TransportWorkerClient implements WorkerClient {
  readonly workerId: string
  threadId?: string
  private readonly transport: WorkerTransport
  private readonly requestTimeoutMs: number
  private readonly createRequestId: () => string
  private readonly pending = new Map<string, PendingRequest>()
  private readonly eventListeners = new Set<(event: WorkerEnvelope) => void>()
  private stopped = false

  constructor(options: TransportWorkerClientOptions) {
    this.workerId = options.workerId
    this.transport = options.transport
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30000
    this.createRequestId = options.createRequestId ?? (() => crypto.randomUUID())
    this.transport.onMessage((envelope) => this.handleEnvelope(envelope))
    this.transport.onClose((reason) => this.rejectAll(new Error(reason)))
  }

  async startThread(input: StartThreadInput): Promise<void> {
    const response = await this.send({ type: 'worker.startThread', input })
    if (!response.success) {
      throw new Error(response.error?.message ?? 'failed to start thread')
    }
    this.threadId = input.threadId
  }

  send(command: WorkerCommand): Promise<WorkerResponseEnvelope> {
    if (this.stopped) {
      return Promise.resolve({
        kind: 'response',
        id: 'stopped',
        command: command.type,
        success: false,
        error: {
          code: 'worker_exited',
          message: 'worker is stopped',
          recoverable: true
        }
      })
    }
    const id = this.createRequestId()
    const envelope: WorkerCommandEnvelope = { kind: 'command', id, command }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`request timed out: ${command.type}`))
      }, this.requestTimeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.transport.send(envelope)
    })
  }

  snapshot(): WorkerSnapshot {
    return {
      workerId: this.workerId,
      threadId: this.threadId,
      state: this.threadId ? 'bound' : 'ready',
      diagnostics: []
    }
  }

  onEvent(listener: (event: WorkerEnvelope) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  async stop(reason: string): Promise<void> {
    if (this.stopped) {
      return
    }
    this.stopped = true
    this.rejectAll(new Error(reason))
    this.transport.close()
  }

  private handleEnvelope(envelope: WorkerEnvelope): void {
    if (envelope.kind !== 'response') {
      for (const listener of this.eventListeners) {
        listener(envelope)
      }
      return
    }
    const pending = this.pending.get(envelope.id)
    if (!pending) {
      return
    }
    clearTimeout(pending.timer)
    this.pending.delete(envelope.id)
    pending.resolve(envelope)
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(error)
    }
  }
}
