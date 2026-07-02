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

/** worker hang 回调信息。 */
export interface WorkerHangInfo {
  /** worker ID。 */
  workerId: string
  /** 线程 ID，若未绑定则为 undefined。 */
  threadId?: string
  /** 无消息持续时间，毫秒。 */
  silentMs: number
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
  /** 无消息超时毫秒数；超过此时间未收到任何 response/event 则触发 hang。 */
  inactivityTimeoutMs?: number
  /** 启动线程超时毫秒数。 */
  startupTimeoutMs?: number
  /** 生成请求 ID 的函数。 */
  createRequestId?: () => string
  /** 获取当前时间戳的函数，用于测试注入。 */
  now?: () => number
  /** worker 无消息时回调。 */
  onHang?: (info: WorkerHangInfo) => void
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
  private readonly eventListeners: Array<(event: WorkerEnvelope) => void> = []
  /** 是否已停止。 */
  private stopped = false
  /** 无消息超时毫秒数。 */
  private readonly inactivityTimeoutMs: number
  /** 启动线程超时毫秒数。 */
  private readonly startupTimeoutMs: number
  /** 获取当前时间戳的函数。 */
  private readonly now: () => number
  /** worker 无消息时回调。 */
  private readonly onHang?: (info: WorkerHangInfo) => void
  /** 最近收到消息时间戳。 */
  private lastMessageAt: number
  /** 无消息检测计时器。 */
  private inactivityTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * 创建 TransportWorkerClient 实例。
   * @param options - 客户端选项。
   */
  constructor(options: TransportWorkerClientOptions) {
    this.workerId = options.workerId
    this.transport = options.transport
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30000
    this.inactivityTimeoutMs = options.inactivityTimeoutMs ?? 30000
    this.startupTimeoutMs = options.startupTimeoutMs ?? 30000
    this.createRequestId = options.createRequestId ?? (() => crypto.randomUUID())
    this.now = options.now ?? Date.now
    this.onHang = options.onHang
    this.lastMessageAt = this.now()
    this.transport.onMessage((envelope) => this.handleEnvelope(envelope))
    this.transport.onClose((reason) => this.rejectAll(new Error(reason)))
    this.scheduleInactivityCheck()
  }

  /**
   * 启动线程并绑定到当前 worker。
   * @param input - 启动线程输入。
   * @throws 当 worker 返回启动失败或启动超时时。
   */
  async startThread(input: StartThreadInput): Promise<void> {
    const startPromise = this.send({ type: 'worker.startThread', input })
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`startThread timed out after ${this.startupTimeoutMs}ms`))
      }, this.startupTimeoutMs)
      // 如果启动成功，清理超时计时器
      startPromise.then(() => clearTimeout(timer), () => clearTimeout(timer))
    })
    const response = await Promise.race([startPromise, timeoutPromise])
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
    this.eventListeners.push(listener)
    return () => {
      const index = this.eventListeners.indexOf(listener)
      if (index >= 0) {
        this.eventListeners.splice(index, 1)
      }
    }
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
    this.clearInactivityTimer()
    this.rejectAll(new Error(reason))
    this.transport.close()
  }

  /**
   * 处理收到的信封，响应则匹配到 pending，事件则广播给监听器。
   * 任何消息都重置无消息检测时间。
   * @param envelope - 收到的信封。
   */
  private handleEnvelope(envelope: WorkerEnvelope): void {
    this.lastMessageAt = this.now()
    if (envelope.kind !== 'response') {
      this.eventListeners.forEach((listener) => listener(envelope))
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
   * 调度无消息检测。
   */
  private scheduleInactivityCheck(): void {
    if (this.stopped) {
      return
    }
    this.inactivityTimer = setTimeout(() => {
      this.checkInactivity()
    }, this.inactivityTimeoutMs)
  }

  /**
   * 检查 worker 是否长时间无消息。
   * 触发时标记停止，清理资源，并通知上层。
   */
  private checkInactivity(): void {
    if (this.stopped) {
      return
    }
    const silentMs = this.now() - this.lastMessageAt
    if (silentMs < this.inactivityTimeoutMs) {
      this.scheduleInactivityCheck()
      return
    }
    this.onHang?.({
      workerId: this.workerId,
      threadId: this.threadId,
      silentMs
    })
    this.stop(`worker hang: no message for ${silentMs}ms`).catch(() => {
      // 清理操作失败时忽略，避免影响回调执行
    })
  }

  /**
   * 清除无消息检测计时器。
   */
  private clearInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer)
      this.inactivityTimer = undefined
    }
  }

  /**
   * 以指定错误拒绝所有待处理请求。
   * @param error - 错误对象。
   */
  private rejectAll(error: Error): void {
    this.clearInactivityTimer()
    this.pending.forEach((pending, id) => {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(error)
    })
  }
}
