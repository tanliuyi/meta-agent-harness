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

/**
 * 待处理请求结构。
 */
interface PendingRequest {
  /** 成功回调。 */
  resolve: (response: WorkerResponseEnvelope) => void
  /** 失败回调。 */
  reject: (error: Error) => void
  /** 超时计时器。 */
  timer: ReturnType<typeof setTimeout>
}

/**
 * 基于传输层的 worker 客户端选项。
 */
export interface TransportWorkerClientOptions {
  /** worker ID。 */
  workerId: string
  /** 底层传输层实例。 */
  transport: WorkerTransport
  /** 请求超时毫秒数。 */
  requestTimeoutMs?: number
  /** 生成请求 ID 的函数。 */
  createRequestId?: () => string
}

/**
 * 基于传输层的 worker 客户端实现，负责请求-响应匹配与事件分发。
 */
export class TransportWorkerClient implements WorkerClient {
  /** 唯一 worker ID。 */
  readonly workerId: string
  /** 当前绑定的线程 ID。 */
  threadId?: string
  /** 底层传输层实例。 */
  private readonly transport: WorkerTransport
  /** 请求超时毫秒数。 */
  private readonly requestTimeoutMs: number
  /** 生成请求 ID 的函数。 */
  private readonly createRequestId: () => string
  /** 请求 ID -> 待处理请求映射。 */
  private readonly pending = new Map<string, PendingRequest>()
  /** 事件监听器集合。 */
  private readonly eventListeners = new Set<(event: WorkerEnvelope) => void>()
  /** 是否已停止。 */
  private stopped = false

  /**
   * 创建 TransportWorkerClient 实例。
   * @param options - 客户端选项。
   */
  constructor(options: TransportWorkerClientOptions) {
    this.workerId = options.workerId
    this.transport = options.transport
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30000
    this.createRequestId = options.createRequestId ?? (() => crypto.randomUUID())
    this.transport.onMessage((envelope) => this.handleEnvelope(envelope))
    this.transport.onClose((reason) => this.rejectAll(new Error(reason)))
  }

  /**
   * 启动线程并绑定到当前 worker。
   * @param input - 启动线程输入。
   * @throws 当 worker 返回启动失败时。
   */
  async startThread(input: StartThreadInput): Promise<void> {
    const response = await this.send({ type: 'worker.startThread', input })
    if (!response.success) {
      throw new Error(response.error?.message ?? 'failed to start thread')
    }
    this.threadId = input.threadId
  }

  /**
   * 发送命令并等待响应。
   * @param command - 要发送的命令。
   * @returns worker 响应。
   */
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

  /**
   * 获取当前 worker 快照。
   * @returns worker 快照。
   */
  snapshot(): WorkerSnapshot {
    return {
      workerId: this.workerId,
      threadId: this.threadId,
      state: this.threadId ? 'bound' : 'ready',
      diagnostics: []
    }
  }

  /**
   * 注册事件监听器。
   * @param listener - 事件监听器。
   * @returns 取消订阅函数。
   */
  onEvent(listener: (event: WorkerEnvelope) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  /**
   * 停止 worker 并清理所有待处理请求。
   * @param reason - 停止原因。
   */
  async stop(reason: string): Promise<void> {
    if (this.stopped) {
      return
    }
    this.stopped = true
    this.rejectAll(new Error(reason))
    this.transport.close()
  }

  /**
   * 处理收到的信封，响应则匹配到 pending，事件则广播给监听器。
   * @param envelope - 收到的信封。
   */
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

  /**
   * 以指定错误拒绝所有待处理请求。
   * @param error - 错误对象。
   */
  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(error)
    }
  }
}
