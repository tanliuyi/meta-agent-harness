/**
 * 本文件测试 main IPC event 转换与窗口路由。
 */

import { describe, expect, it, vi } from 'vitest'
import { codingAgentChannels } from '@shared/coding-agent/channels'
import {
  publishCodingAgentEvent,
  syncThreadStatusFromWorkerEvent,
  syncThreadStatusFromWorkerLifecycle,
  toCodingAgentIpcEvent
} from '../ipc'
import { normalizeAllowedExternalUrl } from '../external-url'
import type { CodingAgentIpcEvent } from '@shared/coding-agent/types'
import { ThreadManagerCore } from '../thread-manager-core'

describe('coding agent IPC events', () => {
  it('只允许安全外部 URL 协议', () => {
    expect(normalizeAllowedExternalUrl(' https://example.com/docs ')).toBe(
      'https://example.com/docs'
    )
    expect(normalizeAllowedExternalUrl('mailto:hello@example.com')).toBe('mailto:hello@example.com')
    expect(() => normalizeAllowedExternalUrl('file:///tmp/secret')).toThrow('not allowed')
    expect(() => normalizeAllowedExternalUrl('command:workbench.action.reloadWindow')).toThrow(
      'not allowed'
    )
    expect(() => normalizeAllowedExternalUrl('javascript:alert(1)')).toThrow('not allowed')
    expect(normalizeAllowedExternalUrl('vscode://file/project/main.ts', 'full')).toBe(
      'vscode://file/project/main.ts'
    )
    expect(normalizeAllowedExternalUrl('my-oauth://callback?code=1', 'full')).toBe(
      'my-oauth://callback?code=1'
    )
  })

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

  it('不把 desktop webview resource 注册事件转发给 renderer', () => {
    expect(
      toCodingAgentIpcEvent({
        kind: 'event',
        eventType: 'projection',
        threadId: 'thread-a',
        event: {
          type: 'extensionPanel.resourceRegistered',
          threadId: 'thread-a',
          resource: {
            token: 'resource-token',
            path: '/tmp/secret.svg',
            threadId: 'thread-a'
          }
        }
      })
    ).toBeUndefined()
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

  it('从 worker lifecycle 事件同步 thread metadata 状态', () => {
    const manager = {
      hasThread: vi.fn((threadId: string) => threadId === 'thread-a'),
      updateThread: vi.fn()
    }

    syncThreadStatusFromWorkerEvent(manager, {
      kind: 'event',
      eventType: 'canonical',
      threadId: 'thread-a',
      event: { type: 'turn_start' }
    })
    syncThreadStatusFromWorkerEvent(manager, {
      kind: 'event',
      eventType: 'canonical',
      threadId: 'thread-a',
      event: {
        type: 'turn_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
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
        },
        toolResults: []
      }
    })
    syncThreadStatusFromWorkerEvent(manager, {
      kind: 'event',
      eventType: 'canonical',
      threadId: 'thread-a',
      event: {
        type: 'agent_end',
        messages: [],
        willRetry: true
      }
    })
    syncThreadStatusFromWorkerEvent(manager, {
      kind: 'event',
      eventType: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'thread.stateChanged',
        threadId: 'thread-a',
        status: 'idle'
      }
    })

    expect(manager.updateThread).toHaveBeenNthCalledWith(1, 'thread-a', { status: 'running' })
    expect(manager.updateThread).toHaveBeenNthCalledWith(2, 'thread-a', { status: 'idle' })
    expect(manager.updateThread).toHaveBeenNthCalledWith(3, 'thread-a', { status: 'idle' })
    expect(manager.updateThread).toHaveBeenCalledTimes(3)
  })

  it('缓存 desktop extension panel projection，用于 renderer reload 后重放', () => {
    const manager = new ThreadManagerCore({} as never)

    manager.cacheExtensionPanelProjection({
      kind: 'event',
      eventType: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'extensionPanel.registered',
        threadId: 'thread-a',
        panel: {
          id: 'deploy',
          title: 'Deploy',
          source: { type: 'html', html: '<h1>Deploy</h1>' }
        }
      }
    })
    manager.cacheExtensionPanelProjection({
      kind: 'event',
      eventType: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'extensionPanel.updated',
        threadId: 'thread-a',
        panelId: 'deploy',
        patch: { title: 'Deployments', order: 10 }
      }
    })
    manager.cacheExtensionPanelState('thread-a', 'deploy', { selectedDeploymentId: 'prod' })

    expect(manager.getExtensionPanelReplayEvents()).toEqual([
      {
        type: 'projection',
        threadId: 'thread-a',
        event: {
          type: 'extensionPanel.registered',
          threadId: 'thread-a',
          panel: {
            id: 'deploy',
            title: 'Deployments',
            order: 10,
            source: { type: 'html', html: '<h1>Deploy</h1>' }
          }
        }
      },
      {
        type: 'projection',
        threadId: 'thread-a',
        event: {
          type: 'extensionPanel.stateUpdated',
          threadId: 'thread-a',
          panelId: 'deploy',
          state: { selectedDeploymentId: 'prod' }
        }
      }
    ])

    manager.cacheExtensionPanelProjection({
      kind: 'event',
      eventType: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'extensionPanel.removed',
        threadId: 'thread-a',
        panelId: 'deploy'
      }
    })

    manager.cacheExtensionPanelProjection({
      kind: 'event',
      eventType: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'extensionPanel.resourceRegistered',
        threadId: 'thread-a',
        resource: {
          token: 'resource-token',
          path: '/tmp/icon.svg',
          threadId: 'thread-a'
        }
      }
    })

    expect(manager.getExtensionPanelReplayEvents()).toEqual([])
    expect(manager.resolveExtensionWebviewResource('resource-token')).toEqual({
      token: 'resource-token',
      path: '/tmp/icon.svg',
      threadId: 'thread-a'
    })

    manager.clearExtensionPanelRuntime('thread-a')

    expect(manager.getExtensionPanelReplayEvents()).toEqual([])
    expect(manager.resolveExtensionWebviewResource('resource-token')).toBeUndefined()
  })

  it('dispose desktop extension panel 会清 replay cache 并通知已绑定 worker', async () => {
    const send = vi.fn().mockResolvedValue({ success: true })
    const manager = new ThreadManagerCore({
      listLeases: () => [{ threadId: 'thread-a' }],
      send
    } as never)

    manager.cacheExtensionPanelProjection({
      kind: 'event',
      eventType: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'extensionPanel.registered',
        threadId: 'thread-a',
        panel: {
          id: 'deploy',
          title: 'Deploy',
          source: { type: 'html', html: '<h1>Deploy</h1>' }
        }
      }
    })
    manager.cacheExtensionPanelState('thread-a', 'deploy', { selectedDeploymentId: 'prod' })

    await manager.disposeExtensionPanelRuntime('thread-a', 'deploy', 'userClosed')

    expect(manager.getExtensionPanelReplayEvents()).toEqual([])
    expect(send).toHaveBeenCalledWith('thread-a', {
      type: 'desktop.panelLifecycle',
      event: { type: 'disposed', panelId: 'deploy', reason: 'userClosed' }
    })
  })

  it('从 worker 结束 lifecycle 同步 thread metadata 状态', () => {
    const manager = {
      hasThread: vi.fn((threadId: string) => threadId === 'thread-a'),
      updateThread: vi.fn()
    }

    syncThreadStatusFromWorkerLifecycle(manager, {
      type: 'worker.run.finished',
      workerId: 'worker-a',
      threadId: 'thread-a',
      reason: 'stop',
      startedAt: 100,
      exitedAt: 200
    })
    syncThreadStatusFromWorkerLifecycle(manager, {
      type: 'worker.run.finished',
      workerId: 'worker-b',
      threadId: 'thread-a',
      reason: 'crash',
      startedAt: 300,
      exitedAt: 400
    })
    syncThreadStatusFromWorkerLifecycle(manager, {
      type: 'worker.run.finished',
      workerId: 'worker-c',
      threadId: 'thread-missing',
      reason: 'stop',
      startedAt: 500,
      exitedAt: 600
    })

    expect(manager.updateThread).toHaveBeenNthCalledWith(1, 'thread-a', { status: 'stopped' })
    expect(manager.updateThread).toHaveBeenNthCalledWith(2, 'thread-a', { status: 'error' })
    expect(manager.updateThread).toHaveBeenCalledTimes(2)
  })
})
