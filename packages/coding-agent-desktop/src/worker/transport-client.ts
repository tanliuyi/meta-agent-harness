/**
 * 本文件实现基于 transport 的 worker client。
 */

import { createDesktopError } from '../protocol/error.ts'
import type {
  WorkerCommand,
  WorkerCommandEnvelope,
  WorkerEnvelope,
  WorkerResponseEnvelope
} from '../protocol/envelope.ts'
import type { ThreadId, WorkerId } from '../protocol/identity.ts'
import type { StartThreadInput } from '../protocol/thread.ts'
import type { WorkerSnapshot } from '../protocol/snapshot.ts'
import type { WorkerTransport } from '../transport/transport.ts'
import type { WorkerClient } from './client.ts'

/** 基于 transport 的 worker client 选项。 */
export interface TransportWorkerClientOptions {
  /** worker 标识。 */
  workerId: WorkerId
  /** 底层 worker transport 实例。 */
  transport: WorkerTransport
  /** 请求超时时间（毫秒，可选）。 */
  requestTimeoutMs?: number
  /** 生成请求 ID 的函数（可选）。 */
  createRequestId?: () => string
}

/** 正在等待响应的请求记录。 */
interface PendingRequest {
  /** 发起请求的命令类型。 */
  command: string
  /** 响应时的 resolve 回调。 */
  resolve: (response: WorkerResponseEnvelope) => void
  /** 拒绝时的 reject 回调。 */
  reject: (error: Error) => void
  /** 超时计时器。 */
  timer: ReturnType<typeof setTimeout>
}

/** 基于抽象 transport 实现的 WorkerClient。 */
export class TransportWorkerClient implements WorkerClient {
  /** 绑定的 worker 标识。 */
  readonly workerId: WorkerId
  /** 当前已启动的 thread 标识（若尚未启动则为 undefined）。 */
  threadId?: ThreadId
  /** 底层 worker transport 实例。 */
  private readonly transport: WorkerTransport
  /** 请求超时时间（毫秒）。 */
  private readonly requestTimeoutMs: number
  /** 生成请求 ID 的函数。 */
  private readonly createRequestId: () => string
  /** 等待响应的请求映射。 */
  private readonly pending = new Map<string, PendingRequest>()
  /** 标记 client 是否已停止。 */
  private stopped = false

  /**
   * 构造 TransportWorkerClient 实例。
   * @param options - transport worker client 选项。
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
   * 启动 thread。
   * 发送 worker.startThread 命令，成功后记录 threadId。
   * @param input - 启动 thread 的输入参数。
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
   * 若 client 已停止，则直接返回 worker_exited 错误响应。
   * @param command - 要发送的 worker 命令。
   * @returns 命令响应信封。
   */
  send(command: WorkerCommand): Promise<WorkerResponseEnvelope> {
    if (this.stopped) {
      return Promise.resolve({
        kind: 'response',
        id: 'stopped',
        command: command.type,
        success: false,
        error: createDesktopError('worker_exited', 'worker is stopped', true)
      })
    }
    const id = this.createRequestId()
    const envelope: WorkerCommandEnvelope = { kind: 'command', id, command }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`request timed out: ${command.type}`))
      }, this.requestTimeoutMs)
      this.pending.set(id, { command: command.type, resolve, reject, timer })
      this.transport.send(envelope)
    })
  }

  /**
   * 获取 worker 当前快照。
   * 若已绑定 thread 则状态为 bound，否则为 ready。
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
   * 停止 client 并关闭 transport。
   * 会拒绝所有待处理的请求。
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
   * 处理从 transport 收到的信封。
   * 仅处理响应信封，并匹配对应 pending 请求。
   * @param envelope - 收到的 worker 信封。
   */
  private handleEnvelope(envelope: WorkerEnvelope): void {
    if (envelope.kind !== 'response') {
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
   * 以指定错误拒绝所有待处理的请求，并清理 pending 映射。
   * @param error - 要拒绝的错误。
   */
  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(error)
    }
  }
}
