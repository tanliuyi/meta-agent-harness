/**
 * 本文件测试 desktop thread metadata store。
 */

import { describe, expect, it } from 'vitest'
import { MemoryThreadStore } from '../storage/memory-thread-store.ts'
import type { ThreadSummary } from '../protocol/thread.ts'

/** MemoryThreadStore 测试套件。 */
describe('MemoryThreadStore', () => {
  /** 验证保存 thread summary 后能正确读取。 */
  it('保存 thread summary', () => {
    const store = new MemoryThreadStore()
    const summary: ThreadSummary = {
      threadId: 'thread-1',
      cwd: 'H:/repo',
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    }

    store.saveThread(summary)

    expect(store.getThread('thread-1')).toEqual(summary)
    expect(store.listThreads()).toEqual([summary])
  })

  /** 验证删除 thread。 */
  it('删除 thread metadata', () => {
    const store = new MemoryThreadStore()
    store.saveThread({
      threadId: 'thread-1',
      cwd: 'H:/repo',
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })

    store.deleteThread('thread-1')

    expect(store.getThread('thread-1')).toBeUndefined()
  })
})
