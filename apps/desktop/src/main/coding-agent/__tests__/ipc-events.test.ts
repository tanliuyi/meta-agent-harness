/**
 * 本文件测试 main IPC event 转换与窗口路由。
 */

import { describe, expect, it } from 'vitest'
import { codingAgentChannels } from '@shared/coding-agent/channels'
import { publishCodingAgentEvent, toCodingAgentIpcEvent } from '../ipc'
import type { CodingAgentIpcEvent } from '@shared/coding-agent/types'

describe('coding agent IPC events', () => {
  it('将 worker agent/projection envelope 转成 renderer IPC event', () => {
    expect(
      toCodingAgentIpcEvent({
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
    ).toEqual({
      type: 'message_end',
      threadId: 'thread-a',
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
    })

    expect(
      toCodingAgentIpcEvent({
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
    ).toEqual({
      type: 'projection',
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
  })

  it('只向未销毁的订阅窗口发布事件', () => {
    const sent: Array<{ channel: string; event: CodingAgentIpcEvent }> = []
    const subscribers = new Set([
      {
        isDestroyed: () => false,
        send: (channel: string, event: CodingAgentIpcEvent) => sent.push({ channel, event })
      },
      {
        isDestroyed: () => true,
        send: (channel: string, event: CodingAgentIpcEvent) => sent.push({ channel, event })
      }
    ])
    const event: CodingAgentIpcEvent = {
      type: 'project',
      event: {
        type: 'project.opened',
        project: {
          projectId: 'project-a',
          name: 'Project A',
          path: '/tmp/project-a',
          status: 'available',
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z'
        }
      }
    }

    publishCodingAgentEvent(subscribers, event)

    expect(sent).toEqual([{ channel: codingAgentChannels.event, event }])
  })
})
