/**
 * 本文件测试 workspace-session 的 IPC event snapshot 投影。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { applyEventToSessions, type WorkspaceSession } from '../workspace-session'
import useWorkspaceProjectStore from '../workspace-project'
import useWorkspaceSessionStore from '../workspace-session'
import type { ThreadSnapshot } from '@shared/coding-agent/types'
import type { AgentMessage } from '../../../../../../../packages/agent/src/types'

const fixtureTimestamp = Date.parse('2026-07-01T00:00:00.000Z')

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('applyEventToSessions', () => {
  it('将后端真实 message_update 应用到 snapshot messages', () => {
    const sessions = createSessions()

    applyEventToSessions(sessions, {
      type: 'message_update',
      threadId: 'thread-a',
      message: createAssistantMessage('hello', fixtureTimestamp),
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'hello',
        partial: createAssistantMessage('hello', fixtureTimestamp)
      }
    })

    expect(sessions['thread-a']?.snapshot?.messages).toMatchObject([
      {
        id: 'assistant-2026-07-01T00:00:00.000Z',
        role: 'assistant',
        text: 'hello',
        raw: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hello' }]
        },
        createdAt: '2026-07-01T00:00:00.000Z'
      }
    ])
  })

  it('将缺少稳定 id 的流式 message_update 合并为同一条消息', () => {
    const sessions = createSessions()

    applyEventToSessions(sessions, {
      type: 'message_update',
      threadId: 'thread-a',
      message: createAssistantMessage('你好。', fixtureTimestamp),
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: '你好。',
        partial: createAssistantMessage('你好。', fixtureTimestamp)
      }
    })
    applyEventToSessions(sessions, {
      type: 'message_update',
      threadId: 'thread-a',
      message: createAssistantMessage('你好。你想让我看代码', fixtureTimestamp),
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: '你好。你想让我看代码',
        partial: createAssistantMessage('你好。你想让我看代码', fixtureTimestamp)
      }
    })
    applyEventToSessions(sessions, {
      type: 'message_update',
      threadId: 'thread-a',
      message: createAssistantMessage('你好。你想让我看代码、修 bug', fixtureTimestamp),
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: '你好。你想让我看代码、修 bug',
        partial: createAssistantMessage('你好。你想让我看代码、修 bug', fixtureTimestamp)
      }
    })

    expect(sessions['thread-a']?.snapshot?.messages).toMatchObject([
      {
        id: 'assistant-2026-07-01T00:00:00.000Z',
        role: 'assistant',
        text: '你好。你想让我看代码、修 bug',
        raw: {
          role: 'assistant',
          content: [{ type: 'text', text: '你好。你想让我看代码、修 bug' }]
        },
        createdAt: '2026-07-01T00:00:00.000Z'
      }
    ])
  })

  it('忽略没有文本内容的后端真实 assistant message_update', () => {
    const sessions = createSessions()

    applyEventToSessions(sessions, {
      type: 'message_update',
      threadId: 'thread-a',
      message: createAssistantMessage('', fixtureTimestamp),
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: '',
        partial: createAssistantMessage('', fixtureTimestamp)
      }
    })

    expect(sessions['thread-a']?.snapshot?.messages).toEqual([])
  })

  it('消费后端真实 thinking_delta 并保留 thinking-only assistant message', () => {
    const sessions = createSessions()

    applyEventToSessions(sessions, {
      type: 'message_update',
      threadId: 'thread-a',
      message: createAssistantThinkingMessage('先读代码。', fixtureTimestamp),
      assistantMessageEvent: {
        type: 'thinking_delta',
        contentIndex: 0,
        delta: '先读代码。',
        partial: createAssistantThinkingMessage('先读代码。', fixtureTimestamp)
      }
    })

    expect(sessions['thread-a']?.snapshot?.messages).toMatchObject([
      {
        id: 'assistant-2026-07-01T00:00:00.000Z',
        role: 'assistant',
        raw: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: '先读代码。' }]
        },
        createdAt: '2026-07-01T00:00:00.000Z'
      }
    ])
    expect(sessions['thread-a']?.snapshot?.messages[0]?.text).toBeUndefined()
  })

  it('保留同时包含 thinking、text 与 toolCall 的 assistant message', () => {
    const sessions = createSessions()

    applyEventToSessions(sessions, {
      type: 'message_update',
      threadId: 'thread-a',
      message: createAssistantMixedMessage(fixtureTimestamp),
      assistantMessageEvent: {
        type: 'toolcall_start',
        contentIndex: 2,
        partial: createAssistantMixedMessage(fixtureTimestamp)
      }
    })

    expect(sessions['thread-a']?.snapshot?.messages).toMatchObject([
      {
        id: 'assistant-2026-07-01T00:00:00.000Z',
        role: 'assistant',
        text: '我会先检查文件。',
        raw: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '需要先定位入口。' },
            { type: 'text', text: '我会先检查文件。' },
            { type: 'toolCall', id: 'tool-a', name: 'read' }
          ]
        },
        createdAt: '2026-07-01T00:00:00.000Z'
      }
    ])
  })

  it('保留只有 toolCall 的 assistant message 供前端拆块渲染工具项', () => {
    const sessions = createSessions()

    applyEventToSessions(sessions, {
      type: 'message_update',
      threadId: 'thread-a',
      message: createAssistantToolOnlyMessage(fixtureTimestamp),
      assistantMessageEvent: {
        type: 'toolcall_start',
        contentIndex: 0,
        partial: createAssistantToolOnlyMessage(fixtureTimestamp)
      }
    })

    expect(sessions['thread-a']?.snapshot?.messages).toMatchObject([
      {
        id: 'assistant-2026-07-01T00:00:00.000Z',
        role: 'assistant',
        raw: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'tool-a', name: 'read' }]
        },
        createdAt: '2026-07-01T00:00:00.000Z'
      }
    ])
    expect(sessions['thread-a']?.snapshot?.messages[0]?.text).toBeUndefined()
  })

  it('将后端真实 message_end 中的 user message 应用到用户消息气泡', () => {
    const sessions = createSessions()

    applyEventToSessions(sessions, {
      type: 'message_end',
      threadId: 'thread-a',
      message: {
        role: 'user',
        content: [{ type: 'text', text: '你好' }],
        timestamp: fixtureTimestamp
      }
    })

    expect(sessions['thread-a']?.snapshot?.messages).toMatchObject([
      {
        id: 'user-2026-07-01T00:00:00.000Z',
        role: 'user',
        text: '你好',
        raw: {
          role: 'user',
          content: [{ type: 'text', text: '你好' }]
        },
        createdAt: '2026-07-01T00:00:00.000Z'
      }
    ])
  })

  it('保留后端真实 tool execution event 的结构化字段', () => {
    const sessions = createSessions()

    applyEventToSessions(sessions, {
      type: 'tool_execution_start',
      threadId: 'thread-a',
      toolCallId: 'tool-a',
      toolName: 'bash',
      args: { command: 'pnpm test' }
    })
    applyEventToSessions(sessions, {
      type: 'tool_execution_update',
      threadId: 'thread-a',
      toolCallId: 'tool-a',
      toolName: 'bash',
      args: { command: 'pnpm test' },
      partialResult: { stdout: 'running' }
    })
    applyEventToSessions(sessions, {
      type: 'tool_execution_end',
      threadId: 'thread-a',
      toolCallId: 'tool-a',
      toolName: 'bash',
      result: { content: 'ok' },
      isError: false
    })

    expect(sessions['thread-a']?.snapshot?.toolCalls).toMatchObject([
      {
        threadId: 'thread-a',
        toolCallId: 'tool-a',
        toolName: 'bash',
        args: { command: 'pnpm test' },
        status: 'succeeded',
        partialResult: { stdout: 'running' },
        result: { content: 'ok' },
        resultSummary: 'ok',
        rawEvent: {
          type: 'tool_execution_end',
          toolCallId: 'tool-a',
          toolName: 'bash',
          result: { content: 'ok' },
          isError: false
        }
      }
    ])
  })

  it('在 tool start 阶段创建工具项，并在 update 中只补齐收起态参数', () => {
    const sessions = createSessions()

    applyEventToSessions(sessions, {
      type: 'tool_execution_start',
      threadId: 'thread-a',
      toolCallId: 'tool-a',
      toolName: 'read',
      args: '{"pa'
    })

    expect(sessions['thread-a']?.snapshot?.toolCalls).toMatchObject([
      {
        toolCallId: 'tool-a',
        toolName: 'read',
        status: 'running'
      }
    ])

    applyEventToSessions(sessions, {
      type: 'tool_execution_update',
      threadId: 'thread-a',
      toolCallId: 'tool-a',
      toolName: 'read',
      args: '{"path":"src/main.ts"}',
      partialResult: { content: [{ type: 'text', text: 'loading' }] }
    })
    applyEventToSessions(sessions, {
      type: 'tool_execution_update',
      threadId: 'thread-a',
      toolCallId: 'tool-a',
      toolName: 'read',
      args: '{"path":"src/other.ts"}',
      partialResult: { content: [{ type: 'text', text: 'still loading' }] }
    })

    expect(sessions['thread-a']?.snapshot?.toolCalls).toMatchObject([
      {
        toolCallId: 'tool-a',
        toolName: 'read',
        status: 'running',
        args: { path: 'src/main.ts' },
        partialResult: { content: [{ type: 'text', text: 'still loading' }] }
      }
    ])
  })

  it('根据后端真实 turn lifecycle 更新运行状态', () => {
    const sessions = createSessions()

    applyEventToSessions(sessions, {
      type: 'turn_start',
      threadId: 'thread-a'
    })

    expect(sessions['thread-a']?.status).toBe('running')
    expect(sessions['thread-a']?.snapshot?.status).toBe('running')

    applyEventToSessions(sessions, {
      type: 'turn_end',
      threadId: 'thread-a',
      message: createAssistantMessage('done', fixtureTimestamp),
      toolResults: []
    })

    expect(sessions['thread-a']?.status).toBe('idle')
    expect(sessions['thread-a']?.snapshot?.status).toBe('idle')
  })

  it('根据后端真实 thinking 与 queue event 更新运行状态投影', () => {
    const sessions = createSessions()

    applyEventToSessions(sessions, {
      type: 'queue_update',
      threadId: 'thread-a',
      steering: ['interrupt'],
      followUp: ['next']
    })
    applyEventToSessions(sessions, {
      type: 'thinking_level_changed',
      threadId: 'thread-a',
      level: 'high'
    })

    const snapshot = sessions['thread-a']?.snapshot
    expect(snapshot?.queue).toEqual({ steering: ['interrupt'], followUp: ['next'] })
    expect(snapshot?.thinkingLevel).toBe('high')
  })

  it('将 projection event 应用到 snapshot runtime projections', () => {
    const sessions = createSessions()

    applyEventToSessions(sessions, {
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
    applyEventToSessions(sessions, {
      type: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'file.changed',
        threadId: 'thread-a',
        change: {
          threadId: 'thread-a',
          path: 'README.md',
          changeType: 'updated',
          createdAt: '2026-07-01T00:00:01.000Z'
        }
      }
    })
    applyEventToSessions(sessions, {
      type: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'thread.error',
        threadId: 'thread-a',
        diagnostic: {
          id: 'diagnostic-a',
          source: 'worker',
          severity: 'warning',
          message: 'heads up',
          createdAt: '2026-07-01T00:00:02.000Z'
        }
      }
    })

    const snapshot = sessions['thread-a']?.snapshot
    expect(snapshot?.queue).toEqual({ steering: [], followUp: [] })
    expect(snapshot?.thinkingLevel).toBe('off')
    expect(snapshot?.approvals).toHaveLength(1)
    expect(snapshot?.toolCalls).toEqual([])
    expect(snapshot?.fileChanges).toMatchObject([{ path: 'README.md', changeType: 'updated' }])
    expect(snapshot?.diagnostics).toMatchObject([{ source: 'worker', severity: 'warning' }])
  })
})

describe('workspace-session Project-first actions', () => {
  it('未传 projectId 时禁止创建 thread 且不调用 IPC', async () => {
    const createThread = vi.fn()
    installCodingAgentApi({ createThread })
    const store = useWorkspaceSessionStore()

    await store.createThread('')

    expect(createThread).not.toHaveBeenCalled()
    expect(store.errorMessage).toBe('请先打开 Project')
  })

  it('加载所有 project 的 thread，并用传入 projectId 创建 thread', async () => {
    const snapshot = createSnapshot()
    const listThreads = vi.fn().mockResolvedValue([
      {
        threadId: 'thread-a',
        projectId: 'project-a',
        status: 'idle',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      },
      {
        threadId: 'thread-b',
        projectId: 'project-b',
        status: 'idle',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      }
    ])
    const createThread = vi.fn().mockResolvedValue(snapshot)
    const getSnapshot = vi.fn().mockResolvedValue(snapshot)
    installCodingAgentApi({ listThreads, createThread, getSnapshot })

    const projectStore = useWorkspaceProjectStore()
    projectStore.projects['project-a'] = {
      projectId: 'project-a',
      name: 'Project A',
      path: '/tmp/project-a',
      status: 'available',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    }
    const store = useWorkspaceSessionStore()

    await store.loadThreads()
    expect(store.activeSessionId).toBeUndefined()

    await store.createThread('project-a')

    expect(listThreads).toHaveBeenCalledWith()
    expect(createThread).toHaveBeenCalledWith({ projectId: 'project-a' })
    expect(store.sessionList.map((session) => session.threadId)).toEqual(['thread-a', 'thread-b'])
    expect(store.sessionsByProject['project-a']?.map((session) => session.threadId)).toEqual([
      'thread-a'
    ])
    expect(store.sessionsByProject['project-b']?.map((session) => session.threadId)).toEqual([
      'thread-b'
    ])

    expect(store.activeSessionId).toBe('thread-a')
  })

  it('加载已有 threads 时不默认选中任意 thread', async () => {
    const listThreads = vi.fn().mockResolvedValue([
      {
        threadId: 'thread-a',
        projectId: 'project-a',
        status: 'idle',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      }
    ])
    const getSnapshot = vi.fn()
    installCodingAgentApi({ listThreads, getSnapshot })
    const store = useWorkspaceSessionStore()

    await store.loadThreads()

    expect(store.activeSessionId).toBeUndefined()
    expect(store.activeSnapshot).toBeUndefined()
    expect(getSnapshot).not.toHaveBeenCalled()
    expect(store.sessionList.map((session) => session.threadId)).toEqual(['thread-a'])
  })

  it('renderer 接住 updatedAt 排序，最近更新的 thread 在最上面', async () => {
    const listThreads = vi.fn().mockResolvedValue([
      {
        threadId: 'thread-oldest',
        projectId: 'project-a',
        status: 'idle',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      },
      {
        threadId: 'thread-other-project',
        projectId: 'project-b',
        status: 'idle',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:01.000Z'
      },
      {
        threadId: 'thread-newest',
        projectId: 'project-a',
        status: 'idle',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:02.000Z'
      }
    ])
    installCodingAgentApi({ listThreads })
    const store = useWorkspaceSessionStore()

    await store.loadThreads()

    expect(store.sessionList.map((session) => session.threadId)).toEqual([
      'thread-newest',
      'thread-other-project',
      'thread-oldest'
    ])
    expect(store.sessionsByProject['project-a']?.map((session) => session.threadId)).toEqual([
      'thread-newest',
      'thread-oldest'
    ])
  })

  it('点击 thread 刷新 snapshot 不会把它当作最近更新顶到最上面', async () => {
    const listThreads = vi.fn().mockResolvedValue([
      {
        threadId: 'thread-oldest',
        projectId: 'project-a',
        status: 'idle',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      },
      {
        threadId: 'thread-newest',
        projectId: 'project-a',
        status: 'idle',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:02.000Z'
      }
    ])
    const getSnapshot = vi.fn().mockResolvedValue({
      ...createSnapshot(),
      threadId: 'thread-oldest',
      projectId: 'project-a'
    })
    installCodingAgentApi({ listThreads, getSnapshot })
    const store = useWorkspaceSessionStore()

    await store.loadThreads()
    await store.setActiveSessionId('thread-oldest')

    expect(getSnapshot).toHaveBeenCalledWith('thread-oldest')
    expect(store.sessionList.map((session) => session.threadId)).toEqual([
      'thread-newest',
      'thread-oldest'
    ])
    expect(store.sessions['thread-oldest']?.updatedAt).toBe('2026-07-01T00:00:00.000Z')
  })

  it('切换 thread 时只切换 active session 并刷新 snapshot', async () => {
    const snapshotA = createSnapshot()
    const snapshotB = {
      ...createSnapshot(),
      threadId: 'thread-b',
      projectId: 'project-b',
      cwd: '/tmp/project-b'
    }
    const getSnapshot = vi.fn().mockImplementation((threadId: string) => {
      return Promise.resolve(threadId === 'thread-b' ? snapshotB : snapshotA)
    })
    installCodingAgentApi({ getSnapshot })
    const projectStore = useWorkspaceProjectStore()
    projectStore.projects['project-a'] = {
      projectId: 'project-a',
      name: 'Project A',
      path: '/tmp/project-a',
      status: 'available',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    }
    projectStore.projects['project-b'] = {
      projectId: 'project-b',
      name: 'Project B',
      path: '/tmp/project-b',
      status: 'available',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    }
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = {
      ...snapshotToWorkspaceSession(snapshotA)
    }
    store.sessions['thread-b'] = {
      ...snapshotToWorkspaceSession(snapshotB)
    }

    await store.setActiveSessionId('thread-b')

    expect(store.activeSessionId).toBe('thread-b')
    expect(store.activeSnapshot?.cwd).toBe('/tmp/project-b')
  })

  it('按 thread 隔离 Composer JSON 草稿', async () => {
    const snapshotA = createSnapshot()
    const snapshotB = {
      ...createSnapshot(),
      threadId: 'thread-b',
      projectId: 'project-b',
      cwd: '/tmp/project-b'
    }
    const getSnapshot = vi.fn().mockImplementation((threadId: string) => {
      return Promise.resolve(threadId === 'thread-b' ? snapshotB : snapshotA)
    })
    installCodingAgentApi({ getSnapshot })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(snapshotA)
    store.sessions['thread-b'] = snapshotToWorkspaceSession(snapshotB)

    await store.setActiveSessionId('thread-a')
    store.draftMessage = createComposerContent('thread a draft')
    await store.setActiveSessionId('thread-b')
    store.draftMessage = createComposerContent('thread b draft')
    await store.setActiveSessionId('thread-a')

    expect(store.draftMessage).toEqual(createComposerContent('thread a draft'))

    await store.setActiveSessionId('thread-b')

    expect(store.draftMessage).toEqual(createComposerContent('thread b draft'))
  })

  it('按选择时的 thread 写入 Composer 图片草稿', async () => {
    const snapshotA = createSnapshot()
    const snapshotB = {
      ...createSnapshot(),
      threadId: 'thread-b',
      projectId: 'project-b',
      cwd: '/tmp/project-b'
    }
    installCodingAgentApi({})
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(snapshotA)
    store.sessions['thread-b'] = snapshotToWorkspaceSession(snapshotB)

    await store.setActiveSessionId('thread-a')
    await store.setActiveSessionId('thread-b')
    store.addComposerImages(
      [
        {
          id: 'image-a',
          path: '/tmp/screenshot.png',
          name: 'screenshot.png',
          size: 3,
          type: 'image',
          mimeType: 'image/png',
          data: 'abc',
          hints: []
        }
      ],
      store.defaultSessionContextId,
      'thread-a'
    )

    expect(store.getComposerImages('thread-a')).toHaveLength(1)
    expect(store.getComposerImages('thread-b')).toHaveLength(0)
  })

  it('按 context 隔离 active thread、Composer 草稿与会话面板 UI', async () => {
    const snapshotA = createSnapshot()
    const snapshotB = {
      ...createSnapshot(),
      threadId: 'thread-b',
      projectId: 'project-b',
      cwd: '/tmp/project-b'
    }
    installCodingAgentApi({})
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(snapshotA)
    store.sessions['thread-b'] = snapshotToWorkspaceSession(snapshotB)

    await store.setActiveSessionId('thread-a', 'left-pane')
    await store.setActiveSessionId('thread-b', 'right-pane')
    store.getContextComposerDrafts('left-pane')['thread-a'] = createComposerContent('left draft')
    store.getContextComposerDrafts('right-pane')['thread-b'] = createComposerContent('right draft')
    store.setActiveSessionPanelWidth(260, 'left-pane')
    store.setActiveSessionPanelWidth(420, 'right-pane')
    store.setActiveSessionPanelOpen(false, 'right-pane')

    expect(store.getContextActiveThreadId('left-pane')).toBe('thread-a')
    expect(store.getContextActiveThreadId('right-pane')).toBe('thread-b')
    expect(store.getComposerDraft('thread-a', 'left-pane')).toEqual(
      createComposerContent('left draft')
    )
    expect(store.getComposerDraft('thread-b', 'right-pane')).toEqual(
      createComposerContent('right draft')
    )
    expect(store.contexts['left-pane'].panel).toEqual({ panelOpen: true, panelWidth: 260 })
    expect(store.contexts['right-pane'].panel).toEqual({ panelOpen: false, panelWidth: 420 })
  })

  it('右侧栏运行态只暴露 active thread 的审批与事件', async () => {
    const snapshotA = createSnapshot()
    const snapshotB = {
      ...createSnapshot(),
      threadId: 'thread-b',
      projectId: 'project-b',
      cwd: '/tmp/project-b'
    }
    installCodingAgentApi({})
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(snapshotA)
    store.sessions['thread-b'] = snapshotToWorkspaceSession(snapshotB)
    await store.setActiveSessionId('thread-a')

    capturedEventListener?.(createApprovalRequestedEvent('thread-a', 'approval-a'))
    capturedEventListener?.(createApprovalRequestedEvent('thread-b', 'approval-b'))

    expect(Object.keys(store.activePendingApprovals)).toEqual(['approval-a'])
    expect(store.activeEvents.map((event) => ('threadId' in event ? event.threadId : ''))).toEqual([
      'thread-a'
    ])

    await store.setActiveSessionId('thread-b')

    expect(Object.keys(store.activePendingApprovals)).toEqual(['approval-b'])
    expect(store.activeEvents.map((event) => ('threadId' in event ? event.threadId : ''))).toEqual([
      'thread-b'
    ])
  })

  it('发送成功后清空当前 thread 的 Composer JSON 草稿', async () => {
    const snapshot = createSnapshot()
    const prompt = vi.fn().mockResolvedValue(undefined)
    const setThreadTitle = vi.fn().mockResolvedValue({
      ...snapshotToWorkspaceSession(snapshot),
      title: 'send me'
    })
    installCodingAgentApi({ prompt, setThreadTitle })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(snapshot)
    await store.setActiveSessionId('thread-a')
    store.draftMessage = createComposerContent('send me')

    await store.sendPrompt()

    expect(setThreadTitle).toHaveBeenCalledWith({ threadId: 'thread-a', title: 'send me' })
    expect(prompt).toHaveBeenCalledWith({ threadId: 'thread-a', message: 'send me' })
    expect(store.sessions['thread-a']?.title).toBe('send me')
    expect(store.draftMessage).toEqual(createComposerContent(''))
    expect(store.hasDraftMessage).toBe(false)
  })

  it('发送 Composer JSON 草稿时保留 hardBreak 换行', async () => {
    const snapshot = createSnapshot()
    const prompt = vi.fn().mockResolvedValue(undefined)
    installCodingAgentApi({ prompt })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(snapshot)
    await store.setActiveSessionId('thread-a')
    store.draftMessage = createComposerContentWithHardBreak('hello', 'world')

    await store.sendPrompt()

    expect(prompt).toHaveBeenCalledWith({ threadId: 'thread-a', message: 'hello\nworld' })
  })

  it('新会话草稿首次发送时才创建 thread 并发送 prompt', async () => {
    const snapshot = {
      ...createSnapshot(),
      threadId: 'thread-new',
      projectId: 'project-a'
    }
    const createThread = vi.fn().mockResolvedValue(snapshot)
    const prompt = vi.fn().mockResolvedValue(undefined)
    const setThreadTitle = vi.fn().mockResolvedValue({
      ...snapshotToWorkspaceSession(snapshot),
      title: 'first prompt'
    })
    installCodingAgentApi({ createThread, prompt, setThreadTitle })
    const store = useWorkspaceSessionStore()
    store.startNewSession('project-a')
    store.draftMessage = createComposerContent('first prompt')

    await store.sendPrompt()

    expect(createThread).toHaveBeenCalledWith({ projectId: 'project-a' })
    expect(setThreadTitle).toHaveBeenCalledWith({ threadId: 'thread-new', title: 'first prompt' })
    expect(prompt).toHaveBeenCalledWith({ threadId: 'thread-new', message: 'first prompt' })
    expect(store.sessions['thread-new']?.title).toBe('first prompt')
    expect(store.activeSessionId).toBe('thread-new')
    expect(store.activeProjectId).toBe('project-a')
    expect(store.hasDraftMessage).toBe(false)
  })

  it('新会话草稿未发送时不创建 thread、不进入列表且保留草稿', async () => {
    const createThread = vi.fn()
    const prompt = vi.fn()
    installCodingAgentApi({ createThread, prompt })
    const store = useWorkspaceSessionStore()

    store.startNewSession('project-a')
    store.draftMessage = createComposerContent('draft before first send')

    expect(createThread).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
    expect(store.activeSessionId).toBeUndefined()
    expect(store.activeProjectId).toBe('project-a')
    expect(store.sessionList).toEqual([])
    expect(store.sessionsByProject['project-a']).toBeUndefined()
    expect(store.draftMessage).toEqual(createComposerContent('draft before first send'))
  })

  it('新会话草稿未选择 Project 时不创建 thread', async () => {
    const createThread = vi.fn()
    const prompt = vi.fn()
    installCodingAgentApi({ createThread, prompt })
    const store = useWorkspaceSessionStore()
    store.draftMessage = createComposerContent('first prompt')

    await store.sendPrompt()

    expect(createThread).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
    expect(store.errorMessage).toBe('请先选择 Project')
    expect(store.draftMessage).toEqual(createComposerContent('first prompt'))
  })

  it('发送 Composer 图片附件并在成功后清空图片草稿', async () => {
    const snapshot = createSnapshot()
    const prompt = vi.fn().mockResolvedValue(undefined)
    installCodingAgentApi({ prompt })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(snapshot)
    await store.setActiveSessionId('thread-a')
    store.draftMessage = createComposerContent('look')
    store.addComposerImages([
      {
        id: 'image-a',
        path: '/tmp/screenshot.png',
        name: 'screenshot.png',
        size: 3,
        type: 'image',
        mimeType: 'image/png',
        data: 'abc',
        hints: ['[Image resized to 2000x1000.]']
      }
    ])

    await store.sendPrompt()

    expect(prompt).toHaveBeenCalledWith({
      threadId: 'thread-a',
      message: 'look',
      imageFiles: [
        {
          path: '/tmp/screenshot.png',
          inlineFallback: {
            type: 'image',
            mimeType: 'image/png',
            data: 'abc'
          }
        }
      ]
    })
    expect(store.draftImages).toEqual([])
    expect(store.hasDraftMessage).toBe(false)
  })

  it('发送失败时保留当前 thread 的 Composer JSON 草稿', async () => {
    const snapshot = createSnapshot()
    const prompt = vi.fn().mockRejectedValue(new Error('network down'))
    installCodingAgentApi({ prompt })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(snapshot)
    await store.setActiveSessionId('thread-a')
    store.draftMessage = createComposerContent('retry me')

    await store.sendPrompt()

    expect(store.errorMessage).toBe('network down')
    expect(store.draftMessage).toEqual(createComposerContent('retry me'))
  })

  it('收到新 threadSnapshot 事件时仅在当前无 active 时选中新 thread', async () => {
    installCodingAgentApi({})
    const projectStore = useWorkspaceProjectStore()
    projectStore.projects['project-a'] = {
      projectId: 'project-a',
      name: 'Project A',
      path: '/tmp/project-a',
      status: 'available',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    }
    const store = useWorkspaceSessionStore()

    capturedEventListener?.({
      type: 'threadSnapshot',
      threadId: 'thread-new',
      snapshot: {
        ...createSnapshot(),
        threadId: 'thread-new'
      }
    })

    expect(store.activeSessionId).toBe('thread-new')
    expect(store.sessionList.map((session) => session.threadId)).toEqual(['thread-new'])
    expect(store.activeSnapshot?.threadId).toBe('thread-new')

    const snapshotExisting = {
      ...createSnapshot(),
      threadId: 'thread-existing'
    }
    store.sessions['thread-existing'] = snapshotToWorkspaceSession(snapshotExisting)
    await store.setActiveSessionId('thread-existing')

    capturedEventListener?.({
      type: 'threadSnapshot',
      threadId: 'thread-another',
      snapshot: {
        ...createSnapshot(),
        threadId: 'thread-another'
      }
    })

    expect(store.activeSessionId).toBe('thread-existing')
    expect(store.sessions['thread-another']).toBeDefined()
  })
})

/**
 * 创建测试 sessions。
 * @returns sessions。
 */
function createSessions(): Record<string, WorkspaceSession> {
  const snapshot = createSnapshot()
  return {
    'thread-a': {
      threadId: 'thread-a',
      projectId: 'project-a',
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      snapshot
    }
  }
}

/**
 * 创建测试 snapshot。
 * @returns snapshot。
 */
function createSnapshot(): ThreadSnapshot {
  return {
    threadId: 'thread-a',
    projectId: 'project-a',
    cwd: '/tmp/project-a',
    status: 'idle',
    thinkingLevel: 'off',
    messages: [],
    toolCalls: [],
    fileChanges: [],
    approvals: [],
    queue: { steering: [], followUp: [] },
    diagnostics: []
  }
}

/**
 * 创建 Pi assistant message fixture。
 * @param text - 文本。
 * @param timestamp - 时间戳。
 * @returns assistant message。
 */
function createAssistantMessage(
  text: string,
  timestamp: number
): Extract<AgentMessage, { role: 'assistant' }> {
  return {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text }],
    api: 'responses' as const,
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
    stopReason: 'stop' as const,
    timestamp
  }
}

/**
 * 创建包含 thinking block 的 Pi assistant message fixture。
 * @param thinking - thinking 文本。
 * @param timestamp - 时间戳。
 * @returns assistant message。
 */
function createAssistantThinkingMessage(
  thinking: string,
  timestamp: number
): Extract<AgentMessage, { role: 'assistant' }> {
  return {
    ...createAssistantMessage('', timestamp),
    content: [{ type: 'thinking' as const, thinking, thinkingSignature: '' }]
  }
}

/**
 * 创建同时包含 thinking、text 和 toolCall 的 assistant message fixture。
 * @param timestamp - 时间戳。
 * @returns assistant message。
 */
function createAssistantMixedMessage(timestamp: number): Extract<AgentMessage, { role: 'assistant' }> {
  return {
    ...createAssistantMessage('', timestamp),
    content: [
      { type: 'thinking' as const, thinking: '需要先定位入口。', thinkingSignature: '' },
      { type: 'text' as const, text: '我会先检查文件。' },
      { type: 'toolCall' as const, id: 'tool-a', name: 'read', arguments: { path: 'README.md' } }
    ]
  }
}

/**
 * 创建只包含 toolCall 的 assistant message fixture。
 * @param timestamp - 时间戳。
 * @returns assistant message。
 */
function createAssistantToolOnlyMessage(timestamp: number): Extract<AgentMessage, { role: 'assistant' }> {
  return {
    ...createAssistantMessage('', timestamp),
    content: [
      { type: 'toolCall' as const, id: 'tool-a', name: 'read', arguments: { path: 'README.md' } }
    ]
  }
}

/**
 * 创建 Composer Tiptap JSON fixture。
 * @param text - 段落文本。
 * @returns Tiptap JSON 内容。
 */
function createComposerContent(text: string): {
  type: 'doc'
  content: Array<{ type: 'paragraph'; content?: Array<{ type: 'text'; text: string }> }>
} {
  const paragraph: { type: 'paragraph'; content?: Array<{ type: 'text'; text: string }> } = {
    type: 'paragraph'
  }
  if (text) {
    paragraph.content = [{ type: 'text', text }]
  }
  return {
    type: 'doc',
    content: [paragraph]
  }
}

/**
 * 创建包含 hardBreak 的 Composer Tiptap JSON fixture。
 * @param before - 换行前文本。
 * @param after - 换行后文本。
 * @returns Tiptap JSON 内容。
 */
function createComposerContentWithHardBreak(
  before: string,
  after: string
): {
  type: 'doc'
  content: Array<{
    type: 'paragraph'
    content: Array<{ type: 'text'; text: string } | { type: 'hardBreak' }>
  }>
} {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: before },
          { type: 'hardBreak' },
          { type: 'text', text: after }
        ]
      }
    ]
  }
}

/**
 * 创建 approval requested IPC event fixture。
 * @param threadId - thread ID。
 * @param approvalId - approval ID。
 * @returns IPC event。
 */
function createApprovalRequestedEvent(
  threadId: string,
  approvalId: string
): Parameters<Parameters<typeof window.api.codingAgent.onEvent>[0]>[0] {
  return {
    type: 'projection',
    threadId,
    event: {
      type: 'approval.requested',
      threadId,
      approval: {
        approvalId,
        threadId,
        action: 'edit',
        risk: 'medium',
        scope: 'once',
        defaultAction: 'deny',
        createdAt: '2026-07-01T00:00:00.000Z'
      }
    }
  }
}

/**
 * 从 snapshot 创建测试 WorkspaceSession。
 * @param snapshot - snapshot。
 * @returns WorkspaceSession。
 */
function snapshotToWorkspaceSession(snapshot: ThreadSnapshot): WorkspaceSession {
  return {
    threadId: snapshot.threadId,
    projectId: snapshot.projectId,
    sessionFile: snapshot.sessionFile,
    title: snapshot.title,
    status: snapshot.status,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    snapshot
  }
}

/**
 * 安装测试用 codingAgent API。
 * @param overrides - 覆盖方法。
 */
function installCodingAgentApi(overrides: Record<string, unknown>): void {
  capturedEventListener = undefined
  vi.stubGlobal('window', {
    api: {
      codingAgent: {
        listThreads: vi.fn().mockResolvedValue([]),
        createThread: vi.fn(),
        getSnapshot: vi.fn().mockResolvedValue(createSnapshot()),
        setThreadTitle: vi.fn(async (input: { threadId: string; title: string }) => ({
          ...snapshotToWorkspaceSession(createSnapshot()),
          threadId: input.threadId,
          title: input.title
        })),
        onEvent: vi.fn((listener) => {
          capturedEventListener = listener
          return vi.fn()
        }),
        ...overrides
      }
    }
  })
}

let capturedEventListener:
  ((event: Parameters<Parameters<typeof window.api.codingAgent.onEvent>[0]>[0]) => void) | undefined
