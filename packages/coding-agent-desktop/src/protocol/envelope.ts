/**
 * 定义 worker transport 中传输的命令、响应和事件 envelope。
 */

import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { DesktopError } from './error.ts'
import type { RequestId, ThreadId } from './identity.ts'
import type { CanonicalAgentCommand } from './commands/canonical.ts'
import type { DesktopControlCommand } from './commands/control.ts'
import type { DesktopProjectionEvent } from './events/projection.ts'
import type { WorkerLifecycleEvent } from './events/worker.ts'

/** Worker 可接收的命令联合类型。 */
export type WorkerCommand = CanonicalAgentCommand | DesktopControlCommand

/** 命令 envelope。 */
export interface WorkerCommandEnvelope {
  /** Envelope 类型：命令。 */
  kind: 'command'
  /** 请求 ID。 */
  id: RequestId
  /** 命令内容。 */
  command: WorkerCommand
}

/** 响应 envelope。 */
export interface WorkerResponseEnvelope<T = unknown> {
  /** Envelope 类型：响应。 */
  kind: 'response'
  /** 请求 ID。 */
  id: RequestId
  /** 命令类型字符串。 */
  command: string
  /** 是否成功。 */
  success: boolean
  /** 响应数据（成功时）。 */
  data?: T
  /** 错误信息（失败时）。 */
  error?: DesktopError
}

/** 事件 envelope 联合类型。 */
export type WorkerEventEnvelope =
  | {
      /** Envelope 类型：事件。 */
      kind: 'event'
      /** 事件类型：canonical agent 事件。 */
      eventType: 'canonical'
      /** 关联线程 ID。 */
      threadId: ThreadId
      /** 原始 agent session 事件。 */
      event: AgentSessionEvent
    }
  | {
      /** Envelope 类型：事件。 */
      kind: 'event'
      /** 事件类型：桌面投影事件。 */
      eventType: 'projection'
      /** 关联线程 ID。 */
      threadId: ThreadId
      /** 桌面投影事件。 */
      event: DesktopProjectionEvent
    }
  | {
      /** Envelope 类型：事件。 */
      kind: 'event'
      /** 事件类型：worker 生命周期事件。 */
      eventType: 'worker'
      /** 关联线程 ID（可选）。 */
      threadId?: ThreadId
      /** Worker 生命周期事件。 */
      event: WorkerLifecycleEvent
    }

/** Worker transport 上所有 envelope 的联合类型。 */
export type WorkerEnvelope = WorkerCommandEnvelope | WorkerResponseEnvelope | WorkerEventEnvelope

/**
 * 创建成功响应 envelope。
 * @param id - 请求 ID。
 * @param command - 命令类型。
 * @param data - 响应数据。
 * @returns 成功响应 envelope。
 */
export function createWorkerResponse<T>(
  id: RequestId,
  command: string,
  data: T
): WorkerResponseEnvelope<T> {
  return { kind: 'response', id, command, success: true, data }
}

/**
 * 创建错误响应 envelope。
 * @param id - 请求 ID。
 * @param command - 命令类型。
 * @param error - 结构化错误对象。
 * @returns 错误响应 envelope。
 */
export function createWorkerErrorResponse(
  id: RequestId,
  command: string,
  error: DesktopError
): WorkerResponseEnvelope {
  return { kind: 'response', id, command, success: false, error }
}
