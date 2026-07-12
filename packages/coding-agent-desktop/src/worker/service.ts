/**
 * 本文件定义 desktop worker 内部服务契约与 fail-first 基础实现。
 */

import { createDesktopError } from '../protocol/error.ts'
import {
  createWorkerErrorResponse,
  createWorkerResponse,
  type WorkerCommandEnvelope,
  type WorkerEventEnvelope,
  type WorkerResponseEnvelope
} from '../protocol/envelope.ts'
import type { StartThreadInput } from '../protocol/thread.ts'

/**
 * Desktop worker 服务契约。
 */
export interface DesktopWorkerService {
  /** 可选：设置事件接收器。 */
  setEventSink?(sink: (event: WorkerEventEnvelope) => void): void
  /** 启动 thread。 */
  startThread(input: StartThreadInput): Promise<void>
  /** 处理命令 envelope。 */
  handle(envelope: WorkerCommandEnvelope): Promise<WorkerResponseEnvelope>
  /** 停止 worker。 */
  stop(reason: string): Promise<void>
}

/**
 * 未绑定具体 runtime 的 fail-first worker 服务实现。
 */
export class UnboundDesktopWorkerService implements DesktopWorkerService {
  private thread: StartThreadInput | undefined

  /**
   * 启动 thread，仅记录输入。
   * @param input - 启动 thread 的输入。
   */
  async startThread(input: StartThreadInput): Promise<void> {
    if (!input.threadId) {
      throw new Error('threadId is required')
    }
    this.thread = input
  }

  /**
   * 处理命令 envelope，仅支持 startThread 与 ping。
   * @param envelope - 命令 envelope。
   * @returns worker 响应。
   */
  async handle(envelope: WorkerCommandEnvelope): Promise<WorkerResponseEnvelope> {
    if (!this.thread && envelope.command.type !== 'worker.startThread') {
      return createWorkerErrorResponse(
        envelope.id,
        envelope.command.type,
        createDesktopError('invalid_state', 'worker has no bound thread', true)
      )
    }
    if (envelope.command.type === 'worker.startThread') {
      await this.startThread(envelope.command.input)
      return createWorkerResponse(envelope.id, envelope.command.type, { ok: true })
    }
    if (envelope.command.type === 'worker.ping') {
      return createWorkerResponse(envelope.id, envelope.command.type, { ok: true })
    }
    return createWorkerErrorResponse(
      envelope.id,
      envelope.command.type,
      createDesktopError(
        'runtime_error',
        'AgentSessionRuntime binding is required before this command',
        false
      )
    )
  }

  /**
   * 停止 worker，释放记录的 thread 输入。
   * @param _reason - 停止原因。
   */
  async stop(_reason: string): Promise<void> {
    this.thread = undefined
  }
}
