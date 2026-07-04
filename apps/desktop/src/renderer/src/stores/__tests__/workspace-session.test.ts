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

  it('保留 assistant thinking/text，但不把 toolCall block 暴露给消息展示', () => {
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
        toolCallIds: ['tool-a'],
        raw: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '需要先定位入口。' },
            { type: 'text', text: '我会先检查文件。' }
          ]
        },
        createdAt: '2026-07-01T00:00:00.000Z'
      }
    ])
  })

  it('保留只有 toolCall 的 assistant message，但 raw content 不重复展示 toolCall', () => {
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
        toolCallIds: ['tool-a'],
        raw: {
          role: 'assistant',
          content: []
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

  it('根据后端真实 model、thinking 与 queue event 更新运行状态投影', () => {
    const sessions = createSessions()
    const model = createModel('gpt-5.1')

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
    applyEventToSessions(sessions, {
      type: 'model_changed',
      threadId: 'thread-a',
      model,
      source: 'set'
    })

    const snapshot = sessions['thread-a']?.snapshot
    expect(snapshot?.queue).toEqual({ steering: ['interrupt'], followUp: ['next'] })
    expect(snapshot?.thinkingLevel).toBe('high')
    expect(snapshot?.model).toEqual(model)
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
          diff: '-1 old\n+1 new',
          patch: '@@',
          additions: 1,
          deletions: 1,
          firstChangedLine: 1,
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
    expect(snapshot?.fileChanges).toMatchObject([
      {
        path: 'README.md',
        changeType: 'updated',
        diff: '-1 old\n+1 new',
        patch: '@@',
        additions: 1,
        deletions: 1,
        firstChangedLine: 1
      }
    ])
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

  it('加载 threads 时按本地 active project 进入已选 Project 的新会话草稿态', async () => {
    const listThreads = vi.fn().mockResolvedValue([
      {
        threadId: 'thread-old',
        projectId: 'project-a',
        status: 'idle',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      },
      {
        threadId: 'thread-new',
        projectId: 'project-a',
        status: 'idle',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:02.000Z'
      },
      {
        threadId: 'thread-other',
        projectId: 'project-b',
        status: 'idle',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:03.000Z'
      }
    ])
    const getSnapshot = vi.fn()
    installCodingAgentApi({ listThreads, getSnapshot })
    const projectStore = useWorkspaceProjectStore()
    projectStore.setActiveProjectId('project-a')
    const store = useWorkspaceSessionStore()

    await store.loadThreads()

    expect(store.activeProjectId).toBe('project-a')
    expect(store.activeSessionId).toBeUndefined()
    expect(store.isNewSessionActive).toBe(true)
    expect(getSnapshot).not.toHaveBeenCalled()
  })

  it('renderer reload 后通过 sessionStorage 恢复当前选中的 thread', async () => {
    const thread = {
      threadId: 'thread-a',
      projectId: 'project-a',
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    }
    const snapshot = {
      ...createSnapshot(),
      threadId: 'thread-a',
      projectId: 'project-a'
    }
    const sessionStorage = createMemorySessionStorage()
    const listThreads = vi.fn().mockResolvedValue([thread])
    const getSnapshot = vi.fn().mockResolvedValue(snapshot)
    installCodingAgentApi({ listThreads, getSnapshot }, sessionStorage)
    let store = useWorkspaceSessionStore()

    await store.loadThreads()
    await store.setActiveSessionId('thread-a')

    expect(sessionStorage.getItem('meta-agent.workspace-session.active-thread.main')).toBe(
      'thread-a'
    )

    setActivePinia(createPinia())
    getSnapshot.mockClear()
    installCodingAgentApi({ listThreads, getSnapshot }, sessionStorage)
    store = useWorkspaceSessionStore()

    await store.loadThreads()

    expect(store.activeSessionId).toBe('thread-a')
    expect(store.activeProjectId).toBe('project-a')
    expect(getSnapshot).toHaveBeenCalledWith('thread-a')
  })

  it('active project 没有 thread 时进入该 project 的新会话草稿态', async () => {
    const listThreads = vi.fn().mockResolvedValue([
      {
        threadId: 'thread-other',
        projectId: 'project-b',
        status: 'idle',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      }
    ])
    const getSnapshot = vi.fn()
    installCodingAgentApi({ listThreads, getSnapshot })
    const projectStore = useWorkspaceProjectStore()
    projectStore.setActiveProjectId('project-a')
    const store = useWorkspaceSessionStore()

    await store.loadThreads()

    expect(store.activeProjectId).toBe('project-a')
    expect(store.activeSessionId).toBeUndefined()
    expect(store.isNewSessionActive).toBe(true)
    expect(getSnapshot).not.toHaveBeenCalled()
  })

  it('归档当前活跃 thread 后从列表移除并切到同 Project 剩余 thread', async () => {
    const threadA = {
      threadId: 'thread-a',
      projectId: 'project-a',
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    }
    const threadB = {
      threadId: 'thread-b',
      projectId: 'project-a',
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:01.000Z'
    }
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce([threadA, threadB])
      .mockResolvedValueOnce([threadB])
    const archiveThread = vi.fn().mockResolvedValue(undefined)
    const getSnapshot = vi.fn().mockImplementation((threadId: string) =>
      Promise.resolve({
        ...createSnapshot(),
        threadId
      })
    )
    installCodingAgentApi({ archiveThread, listThreads, getSnapshot })
    const store = useWorkspaceSessionStore()

    await store.loadThreads()
    await store.setActiveSessionId('thread-a')
    await store.archiveThread('thread-a')

    expect(archiveThread).toHaveBeenCalledWith('thread-a')
    expect(store.activeSessionId).toBe('thread-b')
    expect(store.sessions['thread-a']).toBeUndefined()
    expect(store.sessionList.map((session) => session.threadId)).toEqual(['thread-b'])
    expect(store.sessionsByProject['project-a']?.map((session) => session.threadId)).toEqual([
      'thread-b'
    ])
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
    expect(projectStore.activeProjectId).toBe('project-b')
  })

  it('切换 Project 时选中该 Project 最近更新的 thread', async () => {
    const snapshotB = {
      ...createSnapshot(),
      threadId: 'thread-b',
      projectId: 'project-b',
      cwd: '/tmp/project-b'
    }
    const getSnapshot = vi.fn().mockResolvedValue(snapshotB)
    installCodingAgentApi({ getSnapshot })
    const projectStore = useWorkspaceProjectStore()
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = {
      ...snapshotToWorkspaceSession(createSnapshot()),
      updatedAt: '2026-07-01T00:00:02.000Z'
    }
    store.sessions['thread-b'] = {
      ...snapshotToWorkspaceSession(snapshotB),
      updatedAt: '2026-07-01T00:00:03.000Z'
    }

    await store.setActiveProjectId('project-b')

    expect(projectStore.activeProjectId).toBe('project-b')
    expect(store.activeSessionId).toBe('thread-b')
    expect(getSnapshot).toHaveBeenCalledWith('thread-b')
  })

  it('切换到没有 thread 的 Project 时清空当前窗口保存的 active thread', async () => {
    const sessionStorage = createMemorySessionStorage()
    const getSnapshot = vi.fn().mockResolvedValue(createSnapshot())
    installCodingAgentApi({ getSnapshot }, sessionStorage)
    const projectStore = useWorkspaceProjectStore()
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())

    await store.setActiveSessionId('thread-a')
    await store.setActiveProjectId('project-empty')

    expect(projectStore.activeProjectId).toBe('project-empty')
    expect(store.activeSessionId).toBeUndefined()
    expect(sessionStorage.getItem('meta-agent.workspace-session.active-thread.main')).toBeNull()
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

  it('运行中发送 Composer 草稿时默认复用 steer 链路入队', async () => {
    const snapshot = {
      ...createSnapshot(),
      status: 'running' as const
    }
    const prompt = vi.fn()
    const steer = vi.fn().mockResolvedValue(undefined)
    const followUp = vi.fn()
    const setThreadTitle = vi.fn()
    const getSnapshot = vi.fn().mockResolvedValue(snapshot)
    installCodingAgentApi({ prompt, steer, followUp, setThreadTitle, getSnapshot })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(snapshot)
    await store.setActiveSessionId('thread-a')
    store.draftMessage = createComposerContent('adjust course')

    await store.sendPrompt()

    expect(steer).toHaveBeenCalledWith({ threadId: 'thread-a', message: 'adjust course' })
    expect(followUp).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
    expect(setThreadTitle).not.toHaveBeenCalled()
    expect(store.hasDraftMessage).toBe(false)
  })

  it('运行中发送 Composer 草稿时可显式复用 followUp 链路入队', async () => {
    const snapshot = {
      ...createSnapshot(),
      status: 'running' as const
    }
    const prompt = vi.fn()
    const steer = vi.fn()
    const followUp = vi.fn().mockResolvedValue(undefined)
    const getSnapshot = vi.fn().mockResolvedValue(snapshot)
    installCodingAgentApi({ prompt, steer, followUp, getSnapshot })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(snapshot)
    await store.setActiveSessionId('thread-a')
    store.draftMessage = createComposerContent('after this')

    await store.sendPrompt(store.defaultSessionContextId, 'followUp')

    expect(followUp).toHaveBeenCalledWith({ threadId: 'thread-a', message: 'after this' })
    expect(steer).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
    expect(store.hasDraftMessage).toBe(false)
  })

  it('设置当前线程 thinking level 后刷新并使用后端真实值', async () => {
    const initialSnapshot = createSnapshot()
    const refreshedSnapshot = {
      ...initialSnapshot,
      thinkingLevel: 'high' as const
    }
    const setThinkingLevel = vi.fn().mockResolvedValue(undefined)
    const getSnapshot = vi.fn().mockResolvedValue(refreshedSnapshot)
    installCodingAgentApi({ setThinkingLevel, getSnapshot })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(initialSnapshot)
    await store.setActiveSessionId('thread-a')

    await store.setActiveThinkingLevel('high')

    expect(setThinkingLevel).toHaveBeenCalledWith({ threadId: 'thread-a', level: 'high' })
    expect(getSnapshot).toHaveBeenLastCalledWith('thread-a')
    expect(store.activeSnapshot?.thinkingLevel).toBe('high')
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

  it('新会话草稿首次发送前应用暂存 thinking level 并同步 snapshot', async () => {
    const snapshot = {
      ...createSnapshot(),
      threadId: 'thread-new',
      projectId: 'project-a'
    }
    const refreshedSnapshot = {
      ...snapshot,
      thinkingLevel: 'high' as const
    }
    const createThread = vi.fn().mockResolvedValue(snapshot)
    const setThinkingLevel = vi.fn().mockResolvedValue(undefined)
    const getSnapshot = vi.fn().mockResolvedValue(refreshedSnapshot)
    const prompt = vi.fn().mockResolvedValue(undefined)
    const setThreadTitle = vi.fn().mockResolvedValue({
      threadId: snapshot.threadId,
      projectId: snapshot.projectId,
      cwd: snapshot.cwd,
      status: snapshot.status,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      title: 'first prompt'
    })
    installCodingAgentApi({ createThread, setThinkingLevel, getSnapshot, prompt, setThreadTitle })
    const store = useWorkspaceSessionStore()
    store.startNewSession('project-a')
    await store.setActiveThinkingLevel('high')
    store.draftMessage = createComposerContent('first prompt')

    await store.sendPrompt()

    expect(createThread).toHaveBeenCalledWith({ projectId: 'project-a' })
    expect(setThinkingLevel).toHaveBeenCalledWith({ threadId: 'thread-new', level: 'high' })
    expect(getSnapshot).toHaveBeenCalledWith('thread-new')
    expect(prompt).toHaveBeenCalledWith({ threadId: 'thread-new', message: 'first prompt' })
    expect(store.sessions['thread-new']?.snapshot?.thinkingLevel).toBe('high')
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

  it('按 toolCallId 同步活跃工具索引以支持 renderer 原子更新', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    installCodingAgentApi({})
    const store = useWorkspaceSessionStore()

    capturedEventListener?.({
      type: 'threadSnapshot',
      threadId: 'thread-a',
      snapshot: createSnapshot()
    })
    capturedEventListener?.({
      type: 'tool_execution_start',
      threadId: 'thread-a',
      toolCallId: 'tool-a',
      toolName: 'bash',
      args: { command: 'pnpm test' }
    })

    expect(store.activeToolCallsById['tool-a']).toMatchObject({
      toolCallId: 'tool-a',
      status: 'running',
      args: { command: 'pnpm test' }
    })
    const initialStructure = store.activeToolCallStructures[0]

    capturedEventListener?.({
      type: 'tool_execution_update',
      threadId: 'thread-a',
      toolCallId: 'tool-a',
      toolName: 'bash',
      args: undefined,
      partialResult: { stdout: 'running' }
    })

    expect(store.activeToolCallsById['tool-a']).toMatchObject({
      partialResult: { stdout: 'running' }
    })
    expect(store.activeToolCallStructures[0]).toBe(initialStructure)

    capturedEventListener?.({
      type: 'tool_execution_end',
      threadId: 'thread-a',
      toolCallId: 'tool-a',
      toolName: 'bash',
      result: { content: 'ok' },
      isError: false
    })

    expect(store.activeToolCallsById['tool-a']).toMatchObject({
      status: 'succeeded',
      result: { content: 'ok' },
      resultSummary: 'ok'
    })
    expect(store.activeToolCallStructures[0]).not.toBe(initialStructure)
    expect(store.activeToolCallStructures[0]).toMatchObject({
      toolCallId: 'tool-a',
      startedAt: initialStructure.startedAt,
      finishedAt: expect.any(String)
    })
  })

  it('从具名 assistant toolCall message_update 第一时间同步工具结构', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    installCodingAgentApi({})
    const store = useWorkspaceSessionStore()

    capturedEventListener?.({
      type: 'threadSnapshot',
      threadId: 'thread-a',
      snapshot: createSnapshot()
    })
    capturedEventListener?.({
      type: 'message_update',
      threadId: 'thread-a',
      message: createAssistantToolOnlyMessage(fixtureTimestamp),
      assistantMessageEvent: {
        type: 'toolcall_start',
        contentIndex: 0,
        partial: createAssistantToolOnlyMessage(fixtureTimestamp)
      }
    })

    expect(store.activeToolCallStructures).toMatchObject([
      {
        toolCallId: 'tool-a',
        toolName: 'read',
        args: { path: 'README.md' }
      }
    ])
    expect(store.activeToolCallsById['tool-a']).toMatchObject({
      toolCallId: 'tool-a',
      toolName: 'read',
      status: 'queued'
    })
  })

  it('后续通用 tool execution event 不覆盖 assistant toolCall 的具名工具身份', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    installCodingAgentApi({})
    const store = useWorkspaceSessionStore()

    capturedEventListener?.({
      type: 'threadSnapshot',
      threadId: 'thread-a',
      snapshot: createSnapshot()
    })
    capturedEventListener?.({
      type: 'message_update',
      threadId: 'thread-a',
      message: createAssistantToolOnlyMessage(fixtureTimestamp),
      assistantMessageEvent: {
        type: 'toolcall_start',
        contentIndex: 0,
        partial: createAssistantToolOnlyMessage(fixtureTimestamp)
      }
    })
    capturedEventListener?.({
      type: 'tool_execution_end',
      threadId: 'thread-a',
      toolCallId: 'tool-a',
      toolName: 'tool',
      result: { content: 'ok' },
      isError: false
    })

    expect(store.activeToolCallsById['tool-a']).toMatchObject({
      toolCallId: 'tool-a',
      toolName: 'read',
      status: 'succeeded',
      result: { content: 'ok' }
    })
    expect(store.activeToolCallStructures[0]).toMatchObject({
      toolCallId: 'tool-a',
      toolName: 'read'
    })
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
 * 创建 Pi model fixture。
 * @param id - 模型 ID。
 * @returns model fixture。
 */
function createModel(id: string) {
  return {
    id,
    name: id,
    api: 'openai-responses' as const,
    provider: 'openai' as const,
    baseUrl: 'https://api.openai.com/v1',
    reasoning: true,
    input: ['text' as const],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0
    },
    contextWindow: 128000,
    maxTokens: 16384
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
function createAssistantMixedMessage(
  timestamp: number
): Extract<AgentMessage, { role: 'assistant' }> {
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
function createAssistantToolOnlyMessage(
  timestamp: number
): Extract<AgentMessage, { role: 'assistant' }> {
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
function installCodingAgentApi(
  overrides: Record<string, unknown>,
  sessionStorage = createMemorySessionStorage()
): void {
  capturedEventListener = undefined
  vi.stubGlobal('window', {
    sessionStorage,
    api: {
      codingAgent: {
        listThreads: vi.fn().mockResolvedValue([]),
        archiveThread: vi.fn().mockResolvedValue(undefined),
        restoreThread: vi.fn().mockResolvedValue(undefined),
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

/**
 * 创建测试用 sessionStorage。
 * @returns 内存 sessionStorage。
 */
function createMemorySessionStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key)
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    })
  }
}

let capturedEventListener:
  ((event: Parameters<Parameters<typeof window.api.codingAgent.onEvent>[0]>[0]) => void) | undefined
