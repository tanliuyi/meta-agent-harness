/**
 * 定义 desktop 状态层的 thread metadata 接口。
 */

import type { ThreadId } from '../protocol/identity.ts'
import type { ThreadSummary } from '../protocol/thread.ts'

/**
 * Thread metadata 存储接口。
 * Snapshot 不是持久化格式；conversation 恢复必须来自 Pi JSONL session。
 */
export interface ThreadStore {
  /** 保存 thread 摘要。 */
  saveThread(summary: ThreadSummary): void
  /** 获取指定 thread 摘要。 */
  getThread(threadId: ThreadId): ThreadSummary | undefined
  /** 列出所有 thread 摘要。 */
  listThreads(): ThreadSummary[]
  /** 删除指定 thread metadata。 */
  deleteThread(threadId: ThreadId): void
}
