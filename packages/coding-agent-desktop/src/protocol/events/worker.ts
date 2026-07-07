/**
 * 定义 worker lifecycle event。
 */

import type { DesktopError } from '../error.ts'
import type { ThreadId, WorkerId } from '../identity.ts'

/** Worker 生命周期事件联合类型。 */
export type WorkerLifecycleEvent =
  | {
      /** 事件类型：worker 已就绪。 */
      type: 'worker.ready'
      /** Worker ID。 */
      workerId: WorkerId
    }
  | {
      /** 事件类型：worker 已绑定到线程。 */
      type: 'worker.bound'
      /** Worker ID。 */
      workerId: WorkerId
      /** 绑定的线程 ID。 */
      threadId: ThreadId
    }
  | {
      /** 事件类型：worker 已释放。 */
      type: 'worker.released'
      /** Worker ID。 */
      workerId: WorkerId
      /** 释放的线程 ID。 */
      threadId: ThreadId
      /** 释放原因。 */
      reason: string
    }
  | {
      /** 事件类型：worker 已退出。 */
      type: 'worker.exited'
      /** Worker ID。 */
      workerId: WorkerId
      /** 关联线程 ID（可选）。 */
      threadId?: ThreadId
      /** 退出码（未正常退出时为 null）。 */
      exitCode: number | null
      /** 退出信号（正常退出时为 null）。 */
      signal: string | null
    }
  | {
      /** 事件类型：worker 已崩溃。 */
      type: 'worker.crashed'
      /** Worker ID。 */
      workerId: WorkerId
      /** 关联线程 ID（可选）。 */
      threadId?: ThreadId
      /** 错误信息。 */
      error: DesktopError
    }
  | {
      /** 事件类型：worker 协议错误。 */
      type: 'worker.protocolError'
      /** Worker ID。 */
      workerId: WorkerId
      /** 错误信息。 */
      error: DesktopError
    }
  | {
      /** 事件类型：worker 心跳丢失。 */
      type: 'worker.heartbeatMissed'
      /** Worker ID。 */
      workerId: WorkerId
    }
