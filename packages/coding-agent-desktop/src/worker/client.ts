/**
 * 本文件定义 thread worker registry 依赖的 worker client 契约。
 */

import type { WorkerCommand, WorkerResponseEnvelope } from '../protocol/envelope.ts'
import type { ThreadId, WorkerId } from '../protocol/identity.ts'
import type { StartThreadInput } from '../protocol/thread.ts'
import type { WorkerSnapshot } from '../protocol/snapshot.ts'

/** Worker client 契约。 */
export interface WorkerClient {
  /** 绑定的 worker 标识。 */
  readonly workerId: WorkerId
  /** 当前已启动的 thread 标识（若尚未启动则为 undefined）。 */
  readonly threadId?: ThreadId
  /** 启动一个新 thread。 */
  startThread(input: StartThreadInput): Promise<void>
  /** 向 worker 发送命令并等待响应。 */
  send(command: WorkerCommand): Promise<WorkerResponseEnvelope>
  /** 获取 worker 当前快照。 */
  snapshot(): WorkerSnapshot
  /** 停止 worker 并给出原因。 */
  stop(reason: string): Promise<void>
}

/** 创建 WorkerClient 实例的工厂函数。 */
export type WorkerClientFactory = () => Promise<WorkerClient>
