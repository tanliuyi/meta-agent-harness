/**
 * 本文件测试 desktop runtime controls 对 Pi command list 的补齐。
 */

import { describe, expect, it, vi } from 'vitest'
import {
  dispatchExtensionShortcut,
  getCommands,
  respondApproval,
  respondUi,
  sendExtensionPanelLifecycleEvent,
  sendExtensionPanelMessage
} from '../thread-runtime-controls'
import { ThreadManagerCore } from '../thread-manager-core'

describe('thread-runtime-controls', () => {
  it('getCommands 合并 agent 内建 slash commands 和 worker 资源命令', async () => {
    const core = {
      sendData: vi.fn().mockResolvedValue({
        commands: [
          {
            name: 'skill:test',
            description: 'Run test skill',
            source: 'skill',
            sourceInfo: {
              path: '/tmp/skill',
              source: 'test',
              scope: 'temporary',
              origin: 'top-level'
            }
          }
        ]
      })
    } as unknown as ThreadManagerCore

    const commands = await getCommands(core, 'thread-a')

    expect(core.sendData).toHaveBeenCalledWith('thread-a', { type: 'get_commands' })
    expect(commands.map((command) => command.name)).toEqual(
      expect.arrayContaining(['reload', 'skill:test'])
    )
    expect(commands.map((command) => command.name)).not.toEqual(
      expect.arrayContaining([
        'changelog',
        'hotkeys',
        'new',
        'settings',
        'model',
        'scoped-models',
        'export',
        'import',
        'share',
        'copy',
        'fork',
        'clone',
        'tree',
        'trust',
        'login',
        'logout',
        'resume',
        'quit'
      ])
    )
    expect(commands.find((command) => command.name === 'reload')?.source).toBe('builtin')
  })

  it('dispatchExtensionShortcut 在 desktop 端不向 worker 派发快捷键', async () => {
    const core = {
      sendData: vi.fn()
    } as unknown as ThreadManagerCore

    const handled = await dispatchExtensionShortcut(core, {
      threadId: 'thread-a',
      shortcut: 'ctrl+k'
    })

    expect(core.sendData).not.toHaveBeenCalled()
    expect(handled).toBe(false)
  })

  it('panel mutation 消息向 renderer 传播未绑定 thread 错误', async () => {
    const core = {
      sendOk: vi.fn().mockRejectedValue(new Error('worker has no bound thread'))
    } as unknown as ThreadManagerCore

    await expect(
      sendExtensionPanelMessage(core, {
        threadId: 'thread-a',
        panelId: 'memory',
        message: { type: 'hermes.add' }
      })
    ).rejects.toThrow('worker has no bound thread')
  })

  it('optional panel lifecycle 命令仍忽略未绑定 thread 错误', async () => {
    const core = {
      sendOk: vi.fn().mockRejectedValue(new Error('worker has no bound thread'))
    } as unknown as ThreadManagerCore

    await expect(
      sendExtensionPanelLifecycleEvent(core, {
        threadId: 'thread-a',
        event: { type: 'viewStateChanged', panelId: 'memory', visible: true, active: true }
      })
    ).resolves.toBeUndefined()
  })

  it('UI 响应使用可解除 lifecycle 等待的交互通道', async () => {
    const sendInteractionResponse = vi.fn().mockResolvedValue(undefined)
    const core = { sendInteractionResponse } as unknown as ThreadManagerCore
    const response = { id: 'dialog-a', confirmed: true }

    await respondUi(core, { threadId: 'thread-a', response })

    expect(sendInteractionResponse).toHaveBeenCalledWith('thread-a', {
      type: 'ui.respond',
      response
    })
  })

  it('worker 接受审批响应后同步解决 projection store 中的 pending 记录', async () => {
    const resolveApproval = vi.fn()
    const core = {
      sendInteractionResponse: vi.fn().mockResolvedValue(undefined),
      getStore: () => ({ resolveApproval })
    } as unknown as ThreadManagerCore
    const response = {
      approvalId: 'approval-a',
      allow: true,
      scope: 'workspace' as const
    }

    await respondApproval(core, { threadId: 'thread-a', response })

    expect(core.sendInteractionResponse).toHaveBeenCalledWith('thread-a', {
      type: 'approval.respond',
      response
    })
    expect(resolveApproval).toHaveBeenCalledWith('approval-a', response)
  })

  it('worker 拒绝审批响应时保留 projection store 的 pending 记录', async () => {
    const resolveApproval = vi.fn()
    const core = {
      sendInteractionResponse: vi.fn().mockRejectedValue(new Error('worker rejected response')),
      getStore: () => ({ resolveApproval })
    } as unknown as ThreadManagerCore

    await expect(
      respondApproval(core, {
        threadId: 'thread-a',
        response: { approvalId: 'approval-a', allow: false, scope: 'once' }
      })
    ).rejects.toThrow('worker rejected response')
    expect(resolveApproval).not.toHaveBeenCalled()
  })

  it('交互响应不等待 thread lifecycle 队列', async () => {
    const send = vi.fn().mockResolvedValue({
      kind: 'response',
      id: 'ui-response',
      command: 'ui.respond',
      success: true
    })
    const core = new ThreadManagerCore({ send } as never)
    core.saveThread({
      threadId: 'thread-a',
      projectId: 'project-a',
      status: 'idle',
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z'
    })
    let releaseLifecycle: (() => void) | undefined
    const lifecyclePending = new Promise<void>((resolve) => {
      releaseLifecycle = resolve
    })
    const lifecycleTask = core.runThreadWorkerLifecycle('thread-a', () => lifecyclePending)

    await core.sendInteractionResponse('thread-a', {
      type: 'ui.respond',
      response: { id: 'dialog-a', confirmed: true }
    })

    expect(send).toHaveBeenCalledWith('thread-a', {
      type: 'ui.respond',
      response: { id: 'dialog-a', confirmed: true }
    })
    releaseLifecycle?.()
    await lifecycleTask
  })
})
