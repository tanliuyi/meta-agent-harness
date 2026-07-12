/**
 * 本文件测试 approval bridge 的 request/response 关联。
 */

import { describe, expect, it, vi } from 'vitest'
import { ApprovalBridge } from '../worker/approval-bridge.ts'
import type { WorkerEventEnvelope } from '../protocol/envelope.ts'

/** ApprovalBridge 测试套件。 */
describe('ApprovalBridge', () => {
  /** 验证 bridge 发出审批投影事件后能正确解析响应。 */
  it('发出 approval projection event 并解析 response', async () => {
    const events: WorkerEventEnvelope[] = []
    const bridge = new ApprovalBridge('thread-1', (event) => events.push(event))
    const pending = bridge.request({
      approvalId: 'approval-1',
      action: 'bash',
      risk: 'medium',
      scope: 'once',
      defaultAction: 'deny'
    })

    expect(bridge.listPending()).toEqual([
      expect.objectContaining({ approvalId: 'approval-1', threadId: 'thread-1', action: 'bash' })
    ])
    bridge.respond({ approvalId: 'approval-1', allow: true, scope: 'once' })

    await expect(pending).resolves.toEqual({ approvalId: 'approval-1', allow: true, scope: 'once' })
    expect(bridge.listPending()).toEqual([])
    expect(events[0]).toMatchObject({
      kind: 'event',
      eventType: 'projection',
      threadId: 'thread-1',
      event: {
        type: 'approval.requested',
        threadId: 'thread-1',
        approval: { approvalId: 'approval-1', action: 'bash' }
      }
    })
  })

  it('审批超时时发出 dismissed projection', async () => {
    vi.useFakeTimers()
    try {
      const events: WorkerEventEnvelope[] = []
      const bridge = new ApprovalBridge('thread-1', (event) => events.push(event))
      const pending = bridge.request({
        approvalId: 'approval-timeout',
        action: 'bash',
        risk: 'medium',
        scope: 'once',
        defaultAction: 'deny',
        timeoutMs: 10
      })

      const rejection = expect(pending).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(10)
      await rejection
      expect(events.at(-1)).toMatchObject({
        event: {
          type: 'approval.dismissed',
          approvalId: 'approval-timeout',
          reason: 'timeout'
        }
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejectAll 取消审批并发出 dismissed projection', async () => {
    const events: WorkerEventEnvelope[] = []
    const bridge = new ApprovalBridge('thread-1', (event) => events.push(event))
    const pending = bridge.request({
      approvalId: 'approval-stop',
      action: 'bash',
      risk: 'medium',
      scope: 'once',
      defaultAction: 'deny'
    })

    bridge.rejectAll('workerStopped')

    await expect(pending).rejects.toThrow('workerStopped')
    expect(events.at(-1)).toMatchObject({
      event: {
        type: 'approval.dismissed',
        approvalId: 'approval-stop',
        reason: 'workerStopped'
      }
    })
  })

  /** 验证对未知审批响应会 fail-first。 */
  it('未知 approval response fail-first', () => {
    const bridge = new ApprovalBridge('thread-1', () => {})

    expect(() => bridge.respond({ approvalId: 'missing', allow: false, scope: 'once' })).toThrow(
      'approval request not found'
    )
  })
})
