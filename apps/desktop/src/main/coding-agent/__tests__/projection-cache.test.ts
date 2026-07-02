/**
 * 本文件测试 worker projection events 到临时 cache 的记录。
 */

import { describe, expect, it } from 'vitest'
import { CodingThreadStore } from '../thread-store'
import { cacheWorkerProjectionEvent } from '../projection-cache'

describe('cacheWorkerProjectionEvent', () => {
  it('忽略 canonical message_update，不派生 projection 状态', () => {
    const store = new CodingThreadStore(':memory:')

    cacheWorkerProjectionEvent(store, {
      kind: 'event',
      eventType: 'canonical',
      threadId: 'thread-a',
      event: {
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hello' }],
          api: 'responses',
          provider: 'openai',
          model: 'gpt-5',
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0
            }
          },
          stopReason: 'stop',
          timestamp: 1782844800000
        }
      }
    })

    expect(store.listToolCalls('thread-a')).toEqual([])
    expect(store.listDiagnostics({ threadId: 'thread-a' })).toEqual([])
    store.close()
  })

  it('缓存 approval、tool、file change 与 thread error projection', () => {
    const store = new CodingThreadStore(':memory:')

    cacheWorkerProjectionEvent(store, {
      kind: 'event',
      eventType: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'approval.requested',
        threadId: 'thread-a',
        approval: {
          approvalId: 'approval-a',
          threadId: 'thread-a',
          action: 'edit',
          risk: 'medium',
          scope: 'once',
          defaultAction: 'deny',
          createdAt: '2026-07-01T00:00:00.000Z'
        }
      }
    })
    cacheWorkerProjectionEvent(store, {
      kind: 'event',
      eventType: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'tool.started',
        threadId: 'thread-a',
        toolCall: {
          threadId: 'thread-a',
          toolCallId: 'tool-a',
          toolName: 'edit',
          status: 'succeeded',
          args: { path: 'README.md' },
          resultSummary: 'updated',
          startedAt: '2026-07-01T00:00:01.000Z',
          finishedAt: '2026-07-01T00:00:02.000Z'
        }
      }
    })
    cacheWorkerProjectionEvent(store, {
      kind: 'event',
      eventType: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'file.changed',
        threadId: 'thread-a',
        change: {
          threadId: 'thread-a',
          toolCallId: 'tool-a',
          path: 'README.md',
          changeType: 'updated',
          patch: '@@',
          createdAt: '2026-07-01T00:00:03.000Z'
        }
      }
    })
    cacheWorkerProjectionEvent(store, {
      kind: 'event',
      eventType: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'thread.error',
        threadId: 'thread-a',
        diagnostic: {
          id: 'diagnostic-a',
          source: 'worker',
          severity: 'warning',
          message: 'heads up',
          createdAt: '2026-07-01T00:00:04.000Z'
        }
      }
    })

    expect(store.listApprovals({ threadId: 'thread-a' })).toHaveLength(1)
    expect(store.listToolCalls('thread-a')).toMatchObject([
      {
        toolCallId: 'tool-a',
        toolName: 'edit',
        status: 'succeeded',
        args: { path: 'README.md' }
      }
    ])
    expect(store.listFileChanges('thread-a')).toMatchObject([
      {
        toolCallId: 'tool-a',
        path: 'README.md',
        changeType: 'updated',
        patch: '@@'
      }
    ])
    expect(store.listDiagnostics({ threadId: 'thread-a', source: 'worker' })).toMatchObject([
      {
        source: 'worker',
        severity: 'warning',
        message: 'heads up'
      }
    ])
    store.close()
  })

  it('cache 失败时写 diagnostics 且不抛出', () => {
    const store = {
      recordApprovalRequest: () => {
        throw new Error('projection write failed')
      },
      recordDiagnostic: (record: unknown) => {
        diagnostics.push(record)
      }
    }
    const diagnostics: unknown[] = []

    expect(() =>
      cacheWorkerProjectionEvent(store as unknown as CodingThreadStore, {
        kind: 'event',
        eventType: 'projection',
        threadId: 'thread-a',
        event: {
          type: 'approval.requested',
          threadId: 'thread-a',
          approval: {
            approvalId: 'approval-a',
            threadId: 'thread-a',
            action: 'edit',
            risk: 'medium',
            scope: 'once',
            defaultAction: 'deny',
            createdAt: '2026-07-01T00:00:00.000Z'
          }
        }
      })
    ).not.toThrow()
    expect(diagnostics).toMatchObject([
      {
        threadId: 'thread-a',
        source: 'projection_cache',
        severity: 'error',
        message: 'projection write failed'
      }
    ])
  })
})
