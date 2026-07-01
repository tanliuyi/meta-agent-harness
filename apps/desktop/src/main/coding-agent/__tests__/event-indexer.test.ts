/**
 * 本文件测试 worker events 到 SQLite projection 表的索引。
 */

import { describe, expect, it } from 'vitest'
import { CodingThreadStore } from '../thread-store'
import { indexWorkerEvent } from '../event-indexer'

describe('indexWorkerEvent', () => {
  it('索引 canonical message_update', () => {
    const store = new CodingThreadStore(':memory:')

    indexWorkerEvent(store, {
      kind: 'event',
      eventType: 'canonical',
      threadId: 'thread-a',
      event: {
        type: 'message_update',
        entryId: 'entry-a',
        timestamp: '2026-07-01T00:00:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hello' }]
        }
      }
    })

    expect(store.listMessageIndex('thread-a')).toEqual([
      {
        threadId: 'thread-a',
        sessionEntryId: 'entry-a',
        role: 'assistant',
        summary: 'hello',
        createdAt: '2026-07-01T00:00:00.000Z'
      }
    ])
    store.close()
  })

  it('索引 approval、tool call、file change 与 diagnostic projection', () => {
    const store = new CodingThreadStore(':memory:')

    indexWorkerEvent(store, {
      kind: 'event',
      eventType: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'approval.requested',
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
    indexWorkerEvent(store, {
      kind: 'event',
      eventType: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'tool.call',
        toolCall: {
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
    indexWorkerEvent(store, {
      kind: 'event',
      eventType: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'file.changed',
        fileChange: {
          toolCallId: 'tool-a',
          path: 'README.md',
          changeType: 'updated',
          patch: '@@',
          createdAt: '2026-07-01T00:00:03.000Z'
        }
      }
    })
    indexWorkerEvent(store, {
      kind: 'event',
      eventType: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'diagnostic',
        source: 'worker',
        severity: 'warning',
        message: 'heads up',
        createdAt: '2026-07-01T00:00:04.000Z'
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

  it('索引失败时写 diagnostics 且不抛出', () => {
    const store = {
      saveApprovalRequest: () => {
        throw new Error('database is locked')
      },
      saveDiagnostic: (record: unknown) => {
        diagnostics.push(record)
      }
    }
    const diagnostics: unknown[] = []

    expect(() =>
      indexWorkerEvent(store as unknown as CodingThreadStore, {
        kind: 'event',
        eventType: 'projection',
        threadId: 'thread-a',
        event: {
          type: 'approval.requested',
          approval: {
            approvalId: 'approval-a'
          }
        }
      })
    ).not.toThrow()
    expect(diagnostics).toMatchObject([
      {
        threadId: 'thread-a',
        source: 'event_indexer',
        severity: 'error',
        message: 'database is locked'
      }
    ])
  })
})
