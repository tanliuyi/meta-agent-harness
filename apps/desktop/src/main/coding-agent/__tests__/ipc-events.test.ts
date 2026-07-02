/**
 * 本文件测试 main IPC event 转换与窗口路由。
 */

import { describe, expect, it } from 'vitest'
import { codingAgentChannels } from '../../../shared/coding-agent/channels'
import { publishCodingAgentEvent, toCodingAgentIpcEvent } from '../ipc'
import type { CodingAgentIpcEvent } from '../../../shared/coding-agent/types'

describe('coding agent IPC events', () => {
  it('将 worker canonical/projection envelope 转成 renderer IPC event', () => {
    expect(
      toCodingAgentIpcEvent({
        kind: 'event',
        eventType: 'canonical',
        threadId: 'thread-a',
        event: { type: 'message_update' }
      })
    ).toEqual({
      type: 'canonical',
      threadId: 'thread-a',
      event: { type: 'message_update' }
    })

    expect(
      toCodingAgentIpcEvent({
        kind: 'event',
        eventType: 'projection',
        threadId: 'thread-a',
        event: { type: 'approval.requested' }
      })
    ).toEqual({
      type: 'projection',
      threadId: 'thread-a',
      event: { type: 'approval.requested' }
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
      event: { type: 'project.opened', projectId: 'project-a' }
    }

    publishCodingAgentEvent(subscribers, event)

    expect(sent).toEqual([{ channel: codingAgentChannels.event, event }])
  })
})
