/**
 * 本文件定义 thread worker registry 分配给 thread 的 lease。
 */

import type { CwdPath, SessionFile, ThreadId, WorkerId } from '../protocol/identity.ts'

/** Thread worker registry 中分配给 thread 的 lease 信息。 */
export interface WorkerLease {
  /** 被租借的 worker 标识。 */
  workerId: WorkerId
  /** 关联的 thread 标识。 */
  threadId: ThreadId
  /** 当前工作目录路径。 */
  cwd: CwdPath
  /** 会话文件（可选）。 */
  sessionFile?: SessionFile
  /** lease 获取时间戳（毫秒）。 */
  acquiredAt: number
  /** 最近一次活跃时间戳（毫秒）。 */
  lastActiveAt: number
}
