/**
 * 本文件测试 workspace-session 的 IPC event snapshot 投影。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  applyEventToSessions,
  reconcileSessionTreeBranchesResult,
  type WorkspaceSession
} from '../workspace-session'
import useWorkspaceProjectStore from '../workspace-project'
import useWorkspaceSessionStore from '../workspace-session'
import { createComposerContentFromText } from '../workspace-session-composer'
import type {
  DesktopExtensionWebviewPanel,
  ExtensionUiRequest,
  LoadSessionTreeBranchesResult,
  SessionTreeBranchEntryRow,
  ThreadSnapshot
} from '@shared/coding-agent/types'
import type { Model } from '@earendil-works/pi-ai'
import type { AgentMessage } from '../../../../../../../packages/agent/src/types'

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warning: vi.fn()
}))

const routerMock = vi.hoisted(() => ({
  push: vi.fn()
}))

vi.mock('@renderer/composables/useToast', () => ({
  useToast: () => toastMock
}))

vi.mock('@renderer/router', () => ({
  default: routerMock
}))

const fixtureTimestamp = Date.parse('2026-07-01T00:00:00.000Z')

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

function createSessionTreeEntryRow(
  entryId: string,
  overrides: Partial<SessionTreeBranchEntryRow> = {}
): SessionTreeBranchEntryRow {
  return {
    kind: 'entry',
    id: entryId,
    entryId,
    parentId: null,
    type: 'message',
    timestamp: '2026-07-01T00:00:00.000Z',
    title: `user: ${entryId}`,
    depth: 0,
    visualDepth: 0,
    childCount: 0,
    leaf: true,
    branchPoint: false,
    current: false,
    ...overrides
  }
}

function expectLastSessionNotification(
  store: ReturnType<typeof useWorkspaceSessionStore>,
  message: string
): void {
  expect(store.activeSessionNotifications.at(-1)?.message).toBe(message)
}

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

  it('assistant error 中的 toolCall 不生成准备中的工具组', () => {
    const sessions = createSessions()

    applyEventToSessions(sessions, {
      type: 'message_update',
      threadId: 'thread-a',
      message: createAssistantErrorToolMessage(fixtureTimestamp),
      assistantMessageEvent: {
        type: 'toolcall_start',
        contentIndex: 1,
        partial: createAssistantErrorToolMessage(fixtureTimestamp)
      }
    })

    expect(sessions['thread-a']?.snapshot?.messages).toMatchObject([
      {
        role: 'system',
        text: '模型请求失败：stream_read_error',
        raw: {
          role: 'assistant',
          stopReason: 'error',
          content: [{ type: 'text', text: '准备编辑文件。' }]
        }
      }
    ])
    expect(sessions['thread-a']?.snapshot?.messages[0]?.toolCallIds).toBeUndefined()
    expect(sessions['thread-a']?.snapshot?.toolCalls).toEqual([])
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

  it('将 message_end 的 sessionEntryId 合并到 live 消息', () => {
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
    applyEventToSessions(sessions, {
      type: 'message_end',
      threadId: 'thread-a',
      sessionEntryId: 'entry-assistant',
      message: createAssistantMessage('hello', fixtureTimestamp)
    })

    expect(sessions['thread-a']?.snapshot?.messages).toMatchObject([
      {
        id: 'assistant-2026-07-01T00:00:00.000Z',
        role: 'assistant',
        text: 'hello',
        sessionEntryId: 'entry-assistant'
      }
    ])
  })

  it('仅在用户或 assistant 消息完成时刷新 session 活跃时间', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T00:00:05.000Z'))
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

    expect(sessions['thread-a']?.updatedAt).toBe('2026-07-01T00:00:00.000Z')

    applyEventToSessions(sessions, {
      type: 'message_end',
      threadId: 'thread-a',
      message: createAssistantMessage('hello', fixtureTimestamp)
    })

    expect(sessions['thread-a']?.updatedAt).toBe('2026-07-01T00:00:05.000Z')
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

    sessions['thread-a']!.status = 'running'
    sessions['thread-a']!.snapshot!.status = 'running'
    applyEventToSessions(sessions, {
      type: 'agent_end',
      threadId: 'thread-a',
      messages: [],
      willRetry: false
    })

    expect(sessions['thread-a']?.status).toBe('idle')
    expect(sessions['thread-a']?.snapshot?.status).toBe('idle')
  })

  it('没有加载 snapshot 的后台 session 也会消费 turn lifecycle 状态', () => {
    const sessions = createSessions()
    delete sessions['thread-a']!.snapshot
    sessions['thread-a']!.status = 'running'

    applyEventToSessions(sessions, {
      type: 'turn_end',
      threadId: 'thread-a',
      message: createAssistantMessage('done', fixtureTimestamp),
      toolResults: []
    })

    expect(sessions['thread-a']?.status).toBe('idle')
    expect(sessions['thread-a']?.snapshot).toBeUndefined()
  })

  it('worker crash lifecycle 会终止 running tool calls 并标记 session error', () => {
    const sessions = createSessions()
    sessions['thread-a']!.status = 'running'
    sessions['thread-a']!.snapshot!.status = 'running'
    sessions['thread-a']!.snapshot!.toolCalls = [
      {
        threadId: 'thread-a',
        toolCallId: 'tool-a',
        toolName: 'subagent',
        status: 'running',
        args: { agent: 'reviewer' }
      }
    ]

    applyEventToSessions(sessions, {
      type: 'threadWorker',
      threadId: 'thread-a',
      event: {
        type: 'worker.run.finished',
        workerId: 'worker-a',
        threadId: 'thread-a',
        reason: 'crash',
        startedAt: 100,
        exitedAt: 200,
        message: 'node sidecar exited: code=1 signal=null'
      }
    })

    expect(sessions['thread-a']?.status).toBe('error')
    expect(sessions['thread-a']?.snapshot?.status).toBe('error')
    expect(sessions['thread-a']?.snapshot?.toolCalls).toMatchObject([
      {
        toolCallId: 'tool-a',
        status: 'failed',
        resultSummary: 'node sidecar exited: code=1 signal=null'
      }
    ])
  })

  it('worker crash lifecycle 会覆盖先到达的泛化 projection tool 失败摘要', () => {
    const sessions = createSessions()
    sessions['thread-a']!.status = 'running'
    sessions['thread-a']!.snapshot!.status = 'running'
    sessions['thread-a']!.snapshot!.toolCalls = [
      {
        threadId: 'thread-a',
        toolCallId: 'tool-a',
        toolName: 'subagent',
        status: 'running',
        args: { agent: 'reviewer' }
      }
    ]

    applyEventToSessions(sessions, {
      type: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'thread.stateChanged',
        threadId: 'thread-a',
        status: 'error'
      }
    })
    applyEventToSessions(sessions, {
      type: 'threadWorker',
      threadId: 'thread-a',
      event: {
        type: 'worker.run.finished',
        workerId: 'worker-a',
        threadId: 'thread-a',
        reason: 'crash',
        startedAt: 100,
        exitedAt: 200,
        message: 'node sidecar exited: code=1 signal=null'
      }
    })

    expect(sessions['thread-a']?.snapshot?.toolCalls).toMatchObject([
      {
        toolCallId: 'tool-a',
        status: 'failed',
        resultSummary: 'node sidecar exited: code=1 signal=null'
      }
    ])
  })

  it('没有加载 snapshot 的后台 session 也会消费 thread.stateChanged 状态', () => {
    const sessions = createSessions()
    delete sessions['thread-a']!.snapshot
    sessions['thread-a']!.status = 'running'

    applyEventToSessions(sessions, {
      type: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'thread.stateChanged',
        threadId: 'thread-a',
        status: 'idle'
      }
    })

    expect(sessions['thread-a']?.status).toBe('idle')
    expect(sessions['thread-a']?.snapshot).toBeUndefined()
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

  it('启动路径可禁止恢复旧 active thread，避免未点开旧会话就刷新 snapshot', async () => {
    const thread = {
      threadId: 'thread-a',
      projectId: 'project-a',
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    }
    const sessionStorage = createMemorySessionStorage()
    sessionStorage.setItem('meta-agent.workspace-session.active-thread.main', 'thread-a')
    const listThreads = vi.fn().mockResolvedValue([thread])
    const getSnapshot = vi.fn()
    installCodingAgentApi({ listThreads, getSnapshot }, sessionStorage)
    const store = useWorkspaceSessionStore()

    await store.loadThreads(undefined, { deferActiveSnapshot: true, restoreActiveThread: false })

    expect(store.activeSessionId).toBeUndefined()
    expect(store.activeProjectId).toBeUndefined()
    expect(getSnapshot).not.toHaveBeenCalled()
  })

  it('deferActiveSnapshot 启动路径延后恢复 thread 的 snapshot 刷新', async () => {
    vi.useFakeTimers()
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
    sessionStorage.setItem('meta-agent.workspace-session.active-thread.main', 'thread-a')
    const listThreads = vi.fn().mockResolvedValue([thread])
    const getSnapshot = vi.fn().mockResolvedValue(snapshot)
    installCodingAgentApi({ listThreads, getSnapshot }, sessionStorage)
    const store = useWorkspaceSessionStore()

    await store.loadThreads(undefined, { deferActiveSnapshot: true })

    expect(store.activeSessionId).toBe('thread-a')
    expect(store.activeProjectId).toBe('project-a')
    expect(getSnapshot).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(899)
    expect(getSnapshot).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(getSnapshot).toHaveBeenCalledWith('thread-a')
    expect(store.activeSnapshot?.threadId).toBe('thread-a')
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

  it('按 thread 隔离并去重 Composer 文本引用', async () => {
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
    const quote = { id: 'quote-a', messageId: 'assistant-a', text: '引用正文' }
    store.addComposerQuote(quote)
    store.addComposerQuote({ ...quote, id: 'quote-duplicate' })
    await store.setActiveSessionId('thread-b')

    expect(store.draftQuotes).toEqual([])
    expect(store.getComposerQuotes('thread-a')).toEqual([quote])
  })

  it('同一个 Browser element ref 只保留一个 Composer chip', async () => {
    installCodingAgentApi({})
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')
    const element = {
      id: 'browser-element-a',
      kind: 'browser-element' as const,
      browserRef: 'ref-picked-1',
      tagName: 'button',
      label: 'Save',
      messageId: 'browser-element:ref-picked-1',
      text: '[Browser element ref-picked-1: <button> Save]'
    }

    store.addComposerQuote(element)
    store.addComposerQuote({
      ...element,
      id: 'browser-element-duplicate',
      label: 'Save changes',
      text: '[Browser element ref-picked-1: <button> Save changes]'
    })

    expect(store.draftQuotes).toEqual([
      {
        ...element,
        label: 'Save changes',
        text: '[Browser element ref-picked-1: <button> Save changes]'
      }
    ])
  })

  it('清空当前 Composer 图片草稿', async () => {
    installCodingAgentApi({})
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())

    await store.setActiveSessionId('thread-a')
    store.addComposerImages([
      {
        id: 'image-a',
        path: '/tmp/a.png',
        name: 'a.png',
        size: 3,
        type: 'image',
        mimeType: 'image/png',
        data: 'abc',
        hints: []
      },
      {
        id: 'image-b',
        path: '/tmp/b.png',
        name: 'b.png',
        size: 4,
        type: 'image',
        mimeType: 'image/png',
        data: 'def',
        hints: []
      }
    ])

    expect(store.draftImages).toHaveLength(2)

    store.clearComposerImages()

    expect(store.draftImages).toEqual([])
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
    expect(store.contexts['left-pane'].sessionPanels['thread-a']).toEqual({
      panelOpen: false,
      panelWidth: 300
    })
    expect(store.contexts['right-pane'].sessionPanels['thread-b']).toEqual({
      panelOpen: false,
      panelWidth: 420
    })
    expect(store.contexts['left-pane'].panel).toEqual({ panelOpen: false, panelWidth: 420 })
    expect(store.contexts['right-pane'].panel).toEqual({ panelOpen: false, panelWidth: 420 })
  })

  it('按 active session 隔离会话面板宽度与开启状态', async () => {
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
    store.setActiveSessionPanelWidth(360)
    store.setActiveSessionPanelOpen(false)

    await store.setActiveSessionId('thread-b')
    expect(store.activeSessionPanel).toEqual({ panelOpen: false, panelWidth: 420 })

    store.setActiveSessionPanelWidth(520)
    expect(store.activeSessionPanel).toEqual({ panelOpen: false, panelWidth: 520 })

    await store.setActiveSessionId('thread-a')
    expect(store.activeSessionPanel).toEqual({ panelOpen: false, panelWidth: 360 })

    await store.setActiveSessionId('thread-b')
    expect(store.activeSessionPanel).toEqual({ panelOpen: false, panelWidth: 520 })
  })

  it('会话面板宽度不限制最大值', async () => {
    const snapshot = createSnapshot()
    installCodingAgentApi({})
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(snapshot)

    await store.setActiveSessionId('thread-a')
    store.setActiveSessionPanelWidth(960)

    expect(store.activeSessionPanel).toEqual({ panelOpen: false, panelWidth: 960 })
  })

  it('renderer reload 后通过 localStorage 恢复会话面板宽度与开启状态', async () => {
    const snapshot = createSnapshot()
    const localStorage = createMemorySessionStorage()
    installCodingAgentApi({}, createMemorySessionStorage(), localStorage)
    let store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(snapshot)

    await store.setActiveSessionId('thread-a')
    store.setActiveSessionPanelWidth(560)
    store.setActiveSessionPanelOpen(true)

    setActivePinia(createPinia())
    installCodingAgentApi({}, createMemorySessionStorage(), localStorage)
    store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(snapshot)

    await store.setActiveSessionId('thread-a')

    expect(store.activeSessionPanel).toEqual({ panelOpen: true, panelWidth: 560 })
  })

  it('刷新 live snapshot 时恢复等待中的审批与扩展对话框', async () => {
    const snapshot = {
      ...createSnapshot(),
      approvals: [
        {
          approvalId: 'approval-live',
          threadId: 'thread-a',
          action: 'bash',
          risk: 'medium' as const,
          scope: 'once' as const,
          defaultAction: 'deny' as const,
          createdAt: '2026-07-10T00:00:00.000Z'
        }
      ],
      extensionDialogs: [
        {
          type: 'confirm' as const,
          id: 'dialog-live',
          title: 'Continue',
          message: 'Resume extension?'
        }
      ]
    }
    installCodingAgentApi({ getSnapshot: vi.fn().mockResolvedValue(snapshot) })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')

    await store.refreshSnapshot('thread-a')

    expect(Object.keys(store.activePendingApprovals)).toEqual(['approval-live'])
    expect(store.activeExtensionDialog?.id).toBe('dialog-live')
  })

  it('inactive recovery snapshot 替换事件期 pending、streaming 与 tool/file projection', async () => {
    const liveSnapshot: ThreadSnapshot = {
      ...createSnapshot(),
      messages: [
        {
          id: 'old-message',
          role: 'assistant',
          text: 'streaming old state',
          raw: createAssistantMessage('streaming old state', fixtureTimestamp),
          createdAt: '2026-07-12T00:00:00.000Z'
        }
      ],
      toolCalls: [
        {
          threadId: 'thread-a',
          toolCallId: 'old-tool',
          toolName: 'bash',
          status: 'running',
          startedAt: '2026-07-12T00:00:00.000Z'
        }
      ],
      approvals: [
        {
          approvalId: 'stale-approval',
          threadId: 'thread-a',
          action: 'bash',
          risk: 'medium',
          scope: 'once',
          defaultAction: 'deny',
          createdAt: '2026-07-12T00:00:00.000Z'
        }
      ],
      extensionDialogs: [
        { type: 'confirm', id: 'stale-dialog', title: 'Continue', message: 'Continue?' }
      ]
    }
    const recoveredSnapshot: ThreadSnapshot = {
      ...createSnapshot(),
      messages: [
        {
          id: 'recovered-message',
          role: 'user',
          text: 'from JSONL',
          raw: { role: 'user', content: 'from JSONL', timestamp: fixtureTimestamp },
          createdAt: '2026-07-12T00:01:00.000Z'
        }
      ],
      toolCalls: [
        {
          threadId: 'thread-a',
          toolCallId: 'recovered-tool',
          toolName: 'edit',
          status: 'succeeded',
          startedAt: '2026-07-12T00:01:00.000Z'
        }
      ],
      fileChanges: [
        {
          threadId: 'thread-a',
          path: 'src/app.ts',
          changeType: 'updated',
          additions: 1,
          deletions: 1,
          createdAt: '2026-07-12T00:01:00.000Z'
        }
      ],
      approvals: [],
      extensionDialogs: []
    }
    const getSnapshot = vi
      .fn()
      .mockResolvedValueOnce(liveSnapshot)
      .mockResolvedValueOnce(recoveredSnapshot)
    installCodingAgentApi({ getSnapshot })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')
    store.runtimeByThreadId['thread-a']!.renderState['old-message'] = {
      revision: 2,
      renderState: 'streaming'
    }

    await store.refreshSnapshot('thread-a')

    expect(store.activeSnapshot?.messages.map((message) => message.id)).toEqual([
      'recovered-message'
    ])
    expect(store.activeSnapshot?.toolCalls.map((toolCall) => toolCall.toolCallId)).toEqual([
      'recovered-tool'
    ])
    expect(store.activeSnapshot?.fileChanges.map((change) => change.path)).toEqual(['src/app.ts'])
    expect(store.activePendingApprovals).toEqual({})
    expect(store.activeExtensionDialog).toBeUndefined()
    expect(store.runtimeByThreadId['thread-a']?.renderState['old-message']).toBeUndefined()
    expect(store.getMessageRenderState('thread-a', 'recovered-message')).toMatchObject({
      renderState: 'complete'
    })
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
    capturedEventListener?.({
      type: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'approval.dismissed',
        threadId: 'thread-a',
        approvalId: 'approval-a',
        reason: 'timeout'
      }
    })
    expect(store.activePendingApprovals).toEqual({})
    expect(store.activeEvents.map((event) => ('threadId' in event ? event.threadId : ''))).toEqual([
      'thread-a',
      'thread-a'
    ])

    await store.setActiveSessionId('thread-b')

    expect(Object.keys(store.activePendingApprovals)).toEqual(['approval-b'])
    expect(store.activeEvents.map((event) => ('threadId' in event ? event.threadId : ''))).toEqual([
      'thread-b'
    ])
  })

  it('响应审批时允许 UI 选择一次、线程或工作区作用域', async () => {
    const respondApproval = vi.fn().mockResolvedValue(undefined)
    installCodingAgentApi({ respondApproval })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')

    capturedEventListener?.(createApprovalRequestedEvent('thread-a', 'approval-a'))
    const approval = store.activePendingApprovals['approval-a']

    await store.respondApproval(approval, { allow: true, scope: 'workspace' })

    expect(respondApproval).toHaveBeenCalledWith({
      threadId: 'thread-a',
      response: {
        approvalId: 'approval-a',
        allow: true,
        scope: 'workspace',
        choice: undefined,
        reason: undefined
      }
    })
    expect(store.activePendingApprovals['approval-a']).toBeUndefined()
  })

  it('右侧栏运行态处理 active thread 的 extension UI 请求和状态投影', async () => {
    const respondUi = vi.fn().mockResolvedValue(undefined)
    const saveExtensionPanelState = vi.fn().mockResolvedValue(undefined)
    const disposeExtensionPanel = vi.fn().mockResolvedValue(undefined)
    installCodingAgentApi({ respondUi, saveExtensionPanelState, disposeExtensionPanel })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    store.sessions['thread-b'] = snapshotToWorkspaceSession({
      ...createSnapshot(),
      threadId: 'thread-b'
    })
    await store.setActiveSessionId('thread-a')

    capturedEventListener?.(
      createExtensionUiRequestedEvent('thread-a', {
        type: 'input',
        id: 'ui-input',
        title: 'Name',
        placeholder: 'Project name'
      })
    )
    capturedEventListener?.(
      createExtensionUiRequestedEvent('thread-a', {
        type: 'setStatus',
        id: 'ui-status',
        statusKey: 'sync',
        statusText: 'Ready'
      })
    )
    capturedEventListener?.(
      createExtensionUiRequestedEvent('thread-a', {
        type: 'setEditorText',
        id: 'ui-editor-text',
        text: 'hello\nworld'
      })
    )
    capturedEventListener?.(
      createExtensionUiRequestedEvent('thread-a', {
        type: 'setWorkingMessage',
        id: 'ui-working-message',
        message: 'Indexing'
      })
    )
    capturedEventListener?.(
      createExtensionUiRequestedEvent('thread-a', {
        type: 'setWorkingVisible',
        id: 'ui-working-visible',
        visible: false
      })
    )
    capturedEventListener?.(
      createExtensionUiRequestedEvent('thread-a', {
        type: 'setWorkingIndicator',
        id: 'ui-working-indicator',
        options: { frames: ['-', '+'], intervalMs: 100 }
      })
    )
    capturedEventListener?.(
      createExtensionUiRequestedEvent('thread-a', {
        type: 'setHiddenThinkingLabel',
        id: 'ui-thinking-label',
        label: 'Hidden reasoning'
      })
    )
    capturedEventListener?.(
      createExtensionUiRequestedEvent('thread-a', {
        type: 'setToolsExpanded',
        id: 'ui-tools-expanded',
        expanded: true
      })
    )
    capturedEventListener?.(
      createExtensionUiRequestedEvent('thread-a', {
        type: 'notify',
        id: 'ui-notify',
        message: 'Extension finished',
        notifyType: 'warning'
      })
    )
    capturedEventListener?.(
      createExtensionUiRequestedEvent('thread-b', {
        type: 'confirm',
        id: 'ui-confirm',
        title: 'Other thread',
        message: 'Continue?'
      })
    )

    expect(store.activeExtensionDialogs.map((request) => request.id)).toEqual(['ui-input'])
    expect(store.activeExtensionDialog?.id).toBe('ui-input')
    expect(store.activeExtensionStatuses).toEqual({ sync: 'Ready' })
    expect(store.activeExtensionWorkingMessage).toBe('Indexing')
    expect(store.activeExtensionWorkingVisible).toBe(false)
    expect(store.activeExtensionWorkingIndicator).toEqual({ frames: ['-', '+'], intervalMs: 100 })
    expect(store.activeExtensionHiddenThinkingLabel).toBe('Hidden reasoning')
    expect(store.activeExtensionToolsExpanded).toBe(true)

    capturedEventListener?.({
      type: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'extensionUi.dismissed',
        threadId: 'thread-a',
        requestId: 'ui-input',
        reason: 'aborted'
      }
    })
    expect(store.activeExtensionDialogs).toEqual([])
    capturedEventListener?.(
      createExtensionUiRequestedEvent('thread-a', {
        type: 'input',
        id: 'ui-input',
        title: 'Project name',
        placeholder: 'Name'
      })
    )

    capturedEventListener?.(
      createExtensionPanelRegisteredEvent('thread-a', {
        id: 'deploy',
        title: 'Deploy',
        source: { type: 'html', html: '<h1>Deploy</h1>' }
      })
    )
    expect(store.activeExtensionPanels.deploy).toEqual({
      id: 'deploy',
      title: 'Deploy',
      source: { type: 'html', html: '<h1>Deploy</h1>' }
    })

    capturedEventListener?.({
      type: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'extensionPanel.message',
        threadId: 'thread-a',
        panelId: 'deploy',
        message: { type: 'state', status: 'running' }
      }
    })
    capturedEventListener?.({
      type: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'extensionPanel.message',
        threadId: 'thread-a',
        panelId: 'deploy',
        message: { type: 'state', status: 'queued' }
      }
    })
    expect(store.activeExtensionPanelMessages.deploy).toEqual({
      sequence: 2,
      message: { type: 'state', status: 'queued' },
      messages: [
        { sequence: 1, message: { type: 'state', status: 'running' } },
        { sequence: 2, message: { type: 'state', status: 'queued' } }
      ]
    })
    store.consumeExtensionPanelMessages('thread-a', 'deploy', 1)
    expect(store.activeExtensionPanelMessages.deploy.messages).toEqual([
      { sequence: 2, message: { type: 'state', status: 'queued' } }
    ])
    store.consumeExtensionPanelMessages('thread-a', 'deploy', 2)
    expect(store.activeExtensionPanelMessages.deploy.messages).toEqual([])
    expect(store.activeExtensionPanelMessages.deploy.message).toEqual({
      type: 'state',
      status: 'queued'
    })

    store.setExtensionPanelState('thread-a', 'deploy', { selectedDeploymentId: 'prod' })
    expect(store.activeExtensionPanelStates.deploy).toEqual({ selectedDeploymentId: 'prod' })
    expect(saveExtensionPanelState).toHaveBeenCalledWith({
      threadId: 'thread-a',
      panelId: 'deploy',
      state: { selectedDeploymentId: 'prod' }
    })

    capturedEventListener?.({
      type: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'extensionPanel.stateUpdated',
        threadId: 'thread-a',
        panelId: 'deploy',
        state: { selectedDeploymentId: 'staging' }
      }
    })
    expect(store.activeExtensionPanelStates.deploy).toEqual({ selectedDeploymentId: 'staging' })

    store.disposeExtensionPanel('thread-a', 'deploy')
    expect(disposeExtensionPanel).toHaveBeenCalledWith({
      threadId: 'thread-a',
      panelId: 'deploy',
      reason: 'userClosed'
    })
    expect(store.activeExtensionPanels.deploy).toBeUndefined()
    expect(store.activeExtensionPanelMessages.deploy).toBeUndefined()
    expect(store.activeExtensionPanelStates.deploy).toBeUndefined()

    capturedEventListener?.(
      createExtensionPanelRegisteredEvent('thread-a', {
        id: 'deploy',
        title: 'Deploy',
        source: { type: 'html', html: '<h1>Deploy</h1>' }
      })
    )

    capturedEventListener?.({
      type: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'extensionPanel.updated',
        threadId: 'thread-a',
        panelId: 'deploy',
        patch: { title: 'Deployments' }
      }
    })
    expect(store.activeExtensionPanels.deploy.title).toBe('Deployments')

    capturedEventListener?.({
      type: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'extensionPanel.removed',
        threadId: 'thread-a',
        panelId: 'deploy'
      }
    })
    expect(store.activeExtensionPanels.deploy).toBeUndefined()
    expect(store.activeExtensionPanelMessages.deploy).toBeUndefined()
    expect(store.activeExtensionPanelStates.deploy).toBeUndefined()

    expect(store.draftMessage).toEqual(createComposerContentWithHardBreak('hello', 'world'))
    expect(toastMock.warning).toHaveBeenCalledWith('扩展', 'Extension finished')

    const inputRequest = store.activeExtensionDialog
    expect(inputRequest?.type).toBe('input')
    if (!inputRequest) {
      throw new Error('expected active extension dialog')
    }
    await Promise.all([
      store.respondExtensionDialog(inputRequest, 'Meta Agent'),
      store.respondExtensionDialog(inputRequest, 'Duplicate while pending')
    ])

    expect(respondUi).toHaveBeenCalledWith({
      threadId: 'thread-a',
      response: { id: 'ui-input', value: 'Meta Agent' }
    })
    expect(respondUi).toHaveBeenCalledTimes(1)
    expect(store.activeExtensionDialogs).toEqual([])
    expect(store.activeExtensionDialog).toBeUndefined()

    await store.respondExtensionDialog(inputRequest, 'Duplicate after completion')
    expect(respondUi).toHaveBeenCalledTimes(1)
  })

  it('extension UI 只允许响应队首请求并共享请求草稿', async () => {
    const respondUi = vi.fn().mockResolvedValue(undefined)
    installCodingAgentApi({ respondUi })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')
    const first = {
      type: 'input' as const,
      id: 'ui-first',
      title: 'First',
      placeholder: 'Value'
    }
    const second = {
      type: 'confirm' as const,
      id: 'ui-second',
      title: 'Second',
      message: 'Continue?'
    }

    capturedEventListener?.(createExtensionUiRequestedEvent('thread-a', first))
    capturedEventListener?.(createExtensionUiRequestedEvent('thread-a', second))

    store.setExtensionDialogDraft(first, 'shared draft')
    expect(store.activeExtensionDialogDrafts[first.id]).toBe('shared draft')
    await expect(store.respondExtensionDialog(second, true)).resolves.toBe(false)
    expect(respondUi).not.toHaveBeenCalled()

    await expect(store.respondExtensionDialog(first, 'shared draft')).resolves.toBe(true)
    expect(store.activeExtensionDialog?.id).toBe(second.id)
    expect(store.activeExtensionDialogDrafts[first.id]).toBeUndefined()
    expect(respondUi).toHaveBeenCalledWith({
      threadId: 'thread-a',
      response: { id: first.id, value: 'shared draft' }
    })
  })

  it('extension UI 暴露提交状态并在 IPC 失败后保留可重试错误', async () => {
    let rejectResponse: ((error: Error) => void) | undefined
    const respondUi = vi.fn().mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectResponse = reject
        })
    )
    installCodingAgentApi({ respondUi })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')
    const request = {
      type: 'editor' as const,
      id: 'ui-editor',
      title: 'Edit',
      prefill: 'initial'
    }
    capturedEventListener?.(createExtensionUiRequestedEvent('thread-a', request))

    expect(store.activeExtensionDialogDrafts[request.id]).toBe('initial')
    store.setExtensionDialogDraft(request, 'updated')
    const responsePending = store.respondExtensionDialog(request, 'updated')
    expect(store.activeExtensionDialogResponding[request.id]).toBe(true)

    rejectResponse?.(new Error('transport offline'))
    await expect(responsePending).resolves.toBe(false)
    expect(store.activeExtensionDialog?.id).toBe(request.id)
    expect(store.activeExtensionDialogResponding[request.id]).toBeUndefined()
    expect(store.activeExtensionDialogErrors[request.id]).toContain('transport offline')

    respondUi.mockResolvedValueOnce(undefined)
    await expect(store.respondExtensionDialog(request, 'updated')).resolves.toBe(true)
    expect(store.activeExtensionDialog).toBeUndefined()
    expect(store.activeExtensionDialogDrafts[request.id]).toBeUndefined()
    expect(store.activeExtensionDialogErrors[request.id]).toBeUndefined()
  })

  it('长 extension notify 只在 toast 提示摘要并将完整内容放入右侧栏', async () => {
    installCodingAgentApi({})
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')
    const longMessage = [
      '同步完成，但有 3 个文件需要人工确认',
      'src/alpha.ts: 这一行包含很长的扩展输出，不能直接撑开 toast 或遮挡主界面。',
      'src/beta.ts: 保留完整内容给扩展面板查看。'
    ].join('\n')

    capturedEventListener?.(
      createExtensionUiRequestedEvent('thread-a', {
        type: 'notify',
        id: 'ui-notify-long',
        message: longMessage,
        notifyType: 'info'
      })
    )

    expect(store.activeExtensionNotifications).toEqual([longMessage])
    expect(toastMock.info).toHaveBeenCalledWith('扩展', '通知内容较长，已放入扩展面板')
    expectLastSessionNotification(store, '同步完成，但有 3 个文件需要人工确认')

    store.clearExtensionNotifications()

    expect(store.activeExtensionNotifications).toEqual([])
  })

  it('加载 command 后不再通过 runCommand 执行 skill', async () => {
    const getCommands = vi.fn().mockResolvedValue([
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
    ])
    const runCommand = vi.fn().mockResolvedValue(undefined)
    installCodingAgentApi({ getCommands, runCommand })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')

    await store.loadCommands()
    await store.runCommand('skill:test', 'with args')

    expect(getCommands).toHaveBeenCalledWith('thread-a')
    expect(store.activeCommands.map((command) => command.name)).toEqual(
      expect.arrayContaining(['reload', 'skill:test'])
    )
    expect(runCommand).not.toHaveBeenCalled()
    expect(store.activeSessionActionMessage).toBeUndefined()
    expect(toastMock.info).toHaveBeenCalledWith('请在输入框使用 $ 引用技能', 'skill:test')
  })

  it('运行 command 后使用 main 返回消息并按需刷新 snapshot', async () => {
    const updatedSnapshot = {
      ...createSnapshot(),
      title: 'Updated'
    }
    const getSnapshot = vi.fn().mockResolvedValue(updatedSnapshot)
    const runCommand = vi.fn().mockResolvedValue({
      message: '已克隆当前会话',
      refreshSnapshot: true
    })
    installCodingAgentApi({ getSnapshot, runCommand })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')

    await store.runCommand('clone')

    expect(runCommand).toHaveBeenCalledWith({
      threadId: 'thread-a',
      command: 'clone'
    })
    expect(getSnapshot).toHaveBeenCalledWith('thread-a')
    expect(store.sessions['thread-a']?.title).toBe('Updated')
    expectLastSessionNotification(store, '已克隆当前会话')
  })

  it('运行带详情的 command 后在当前 session 暴露详情并在后续命令清理', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({
        message: '已创建分享链接',
        details: {
          title: 'Share',
          body: 'https://pi.dev/session/#gist-123'
        }
      })
      .mockResolvedValueOnce({
        message: '已重载扩展与资源'
      })
    installCodingAgentApi({ runCommand })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')

    await store.runCommand('share')

    expectLastSessionNotification(store, '已创建分享链接')
    expect(store.activeSessionActionDetails).toEqual({
      title: 'Share',
      body: 'https://pi.dev/session/#gist-123'
    })

    await store.runCommand('reload')

    expectLastSessionNotification(store, '已重载扩展与资源')
    expect(store.activeSessionActionDetails).toBeUndefined()
  })

  it('运行 Desktop UI 类 built-in command 时不进入 preload runCommand', async () => {
    const runCommand = vi.fn().mockResolvedValue(undefined)
    installCodingAgentApi({ runCommand })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')

    await store.runCommand('/settings')

    expect(routerMock.push).toHaveBeenCalledWith('/settings/agent')
    expect(runCommand).not.toHaveBeenCalled()
    expectLastSessionNotification(store, '已打开 Agent 设置')
    expect(toastMock.info).toHaveBeenCalledWith('命令已完成', '已打开 Agent 设置')
  })

  it('运行 command 失败时使用 Toast，不写入 sidebar 错误状态', async () => {
    const runCommand = vi
      .fn()
      .mockRejectedValue(
        new Error('/share 需要设置 GITHUB_TOKEN 或 GH_TOKEN 以创建 secret GitHub gist')
      )
    installCodingAgentApi({ runCommand })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')

    await store.runCommand('share')

    expect(runCommand).toHaveBeenCalledWith({
      threadId: 'thread-a',
      command: 'share'
    })
    expect(toastMock.error).toHaveBeenCalledWith(
      '命令执行失败',
      '/share 需要设置 GITHUB_TOKEN 或 GH_TOKEN 以创建 secret GitHub gist'
    )
    expect(store.errorMessage).toBeUndefined()
    expect(store.activeSessionActionMessage).toBeUndefined()
  })

  it('运行无参数 tree/fork command 时打开 SessionPanel 而不是发送 prompt', async () => {
    const runCommand = vi.fn().mockResolvedValue(undefined)
    installCodingAgentApi({ runCommand })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession({
      ...createSnapshot(),
      currentEntryId: 'entry-current'
    })
    await store.setActiveSessionId('thread-a')
    store.setActiveSessionPanelOpen(false)

    await store.runCommand('tree')

    expect(runCommand).not.toHaveBeenCalled()
    expect(store.activeSessionPanel.panelOpen).toBe(true)
    expect(store.treeFocusRequest).toEqual({ entryId: 'entry-current', requestId: 1 })
    expectLastSessionNotification(store, '已打开 Session Tree')
  })

  it('带参数 model command 继续交给 main runtime command', async () => {
    const runCommand = vi.fn().mockResolvedValue({
      message: '已切换模型到 openai/gpt-5',
      refreshSnapshot: true
    })
    installCodingAgentApi({ runCommand })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')

    await store.runCommand('model', 'openai/gpt-5')

    expect(routerMock.push).not.toHaveBeenCalled()
    expect(runCommand).toHaveBeenCalledWith({
      threadId: 'thread-a',
      command: 'model',
      args: 'openai/gpt-5'
    })
    expectLastSessionNotification(store, '已切换模型到 openai/gpt-5')
  })

  it('新会话草稿态直接暴露 Desktop 内置 Browser 和 Hermes Memory panels', () => {
    const createThread = vi.fn()
    installCodingAgentApi({ createThread })
    const store = useWorkspaceSessionStore()

    store.startNewSession('project-a')

    expect(createThread).not.toHaveBeenCalled()
    expect(store.activeSessionId).toBeUndefined()
    expect(store.activeExtensionPanels['browser-preview']).toEqual({
      id: 'browser-preview',
      viewType: 'meta.browser-preview',
      title: 'Browser',
      icon: 'globe',
      order: 15,
      retainContextWhenHidden: true,
      source: { type: 'native', component: 'browser-preview' }
    })
    expect(store.activeExtensionPanels['hermes-memory']).toEqual({
      id: 'hermes-memory',
      viewType: 'pi.hermes-memory',
      title: '记忆',
      icon: 'brain',
      order: 35,
      source: { type: 'native', component: 'memory' }
    })
  })

  it('选择 Project 后自动发现新会话资源且不创建 thread', async () => {
    const snapshot = {
      ...createSnapshot(),
      threadId: 'thread-new'
    }
    const createThread = vi.fn().mockResolvedValue(snapshot)
    const getCommands = vi.fn().mockResolvedValue([])
    const getResourceSnapshot = vi.fn().mockResolvedValue({
      resources: {
        extensions: [],
        skills: [],
        prompts: [],
        themes: []
      },
      extensions: [
        {
          path: '/tmp/extension.ts',
          resolvedPath: '/tmp/extension.ts',
          enabled: true,
          sourceInfo: {
            path: '/tmp/extension.ts',
            source: 'test',
            scope: 'temporary',
            origin: 'top-level'
          },
          commands: [{ name: 'extension:test', description: 'Run extension command' }],
          tools: [],
          flags: []
        }
      ],
      skillCommands: [
        {
          name: 'skill:review',
          description: 'Review staged changes',
          source: 'skill',
          sourceInfo: {
            path: '/tmp/skills/review/SKILL.md',
            source: 'test',
            scope: 'temporary',
            origin: 'top-level',
            baseDir: '/tmp/skills/review'
          }
        }
      ],
      diagnostics: []
    })
    const runCommand = vi.fn().mockResolvedValue(undefined)
    installCodingAgentApi({ createThread, getCommands, getResourceSnapshot, runCommand })
    const projectStore = useWorkspaceProjectStore()
    projectStore.projects['project-a'] = {
      projectId: 'project-a',
      name: 'Project A',
      path: '/tmp/project-a',
      status: 'available',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      trust: {
        state: 'trusted',
        requiresTrust: true,
        savedPath: '/tmp/project-a'
      }
    }
    const store = useWorkspaceSessionStore()
    store.startNewSession('project-a')

    await vi.waitFor(() => {
      expect(store.activeCommandsLoaded).toBe(true)
    })

    expect(createThread).not.toHaveBeenCalled()
    expect(getCommands).not.toHaveBeenCalled()
    expect(getResourceSnapshot).toHaveBeenCalledWith({
      cwd: '/tmp/project-a',
      projectTrusted: true
    })
    expect(store.activeSessionId).toBeUndefined()
    expect(store.activeCommands.map((command) => command.name)).toEqual(
      expect.arrayContaining(['reload', 'extension:test', 'skill:review'])
    )
    expect(store.activeCommands.find((command) => command.name === 'skill:review')).toEqual(
      expect.objectContaining({
        description: 'Review staged changes',
        source: 'skill'
      })
    )
    expect(store.activeCommands.find((command) => command.name === 'reload')?.source).toBe(
      'builtin'
    )
    expect(store.activeCommandsLoaded).toBe(true)

    await store.runCommand('skill:test', 'with args')

    expect(createThread).not.toHaveBeenCalled()
    expect(store.activeSessionId).toBeUndefined()
    expect(runCommand).not.toHaveBeenCalled()
    expect(store.activeSessionActionMessage).toBeUndefined()
    expect(toastMock.info).toHaveBeenCalledWith('请在输入框使用 $ 引用技能', 'skill:test')
  })

  it('同步 editor text 并触发 extension shortcut', async () => {
    const syncExtensionEditorText = vi.fn().mockResolvedValue(undefined)
    const dispatchExtensionShortcut = vi.fn().mockResolvedValue(true)
    installCodingAgentApi({ syncExtensionEditorText, dispatchExtensionShortcut })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')

    await store.syncActiveEditorText('hello from composer')
    const handled = await store.dispatchExtensionShortcut('shift+ctrl+k')

    expect(syncExtensionEditorText).toHaveBeenCalledWith({
      threadId: 'thread-a',
      text: 'hello from composer'
    })
    expect(dispatchExtensionShortcut).toHaveBeenCalledWith({
      threadId: 'thread-a',
      shortcut: 'shift+ctrl+k'
    })
    expect(handled).toBe(true)
  })

  it('extension shortcut 未命中时不写入错误状态', async () => {
    const dispatchExtensionShortcut = vi.fn().mockResolvedValue(false)
    installCodingAgentApi({ dispatchExtensionShortcut })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')

    const handled = await store.dispatchExtensionShortcut('ctrl+c')

    expect(dispatchExtensionShortcut).toHaveBeenCalledWith({
      threadId: 'thread-a',
      shortcut: 'ctrl+c'
    })
    expect(handled).toBe(false)
    expect(store.errorMessage).toBeUndefined()
  })

  it('重载当前会话资源后刷新 command 缓存', async () => {
    const runCommand = vi.fn().mockResolvedValue(undefined)
    const getCommands = vi.fn().mockResolvedValue([
      {
        name: 'extension:hello',
        description: 'Hello',
        source: 'extension',
        sourceInfo: {
          path: '/tmp/hello.ts',
          source: 'test',
          scope: 'temporary',
          origin: 'top-level'
        }
      }
    ])
    installCodingAgentApi({ runCommand, getCommands })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')

    await store.reloadSessionResources()

    expect(runCommand).toHaveBeenCalledWith({ threadId: 'thread-a', command: 'reload' })
    expect(getCommands).toHaveBeenCalledWith('thread-a')
    expect(store.activeCommands.map((command) => command.name)).toEqual(
      expect.arrayContaining(['reload', 'extension:hello'])
    )
    expectLastSessionNotification(store, '已重载扩展与资源')
  })

  it('按需加载 command，进入会话本身不触发 commands API', async () => {
    const getCommands = vi.fn().mockResolvedValue([
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
    ])
    installCodingAgentApi({ getCommands })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())

    await store.setActiveSessionId('thread-a')

    expect(getCommands).not.toHaveBeenCalled()
    expect(store.activeCommandsLoaded).toBe(false)

    await store.ensureCommandsLoaded()

    expect(getCommands).toHaveBeenCalledTimes(1)
    expect(getCommands).toHaveBeenCalledWith('thread-a')
    expect(store.activeCommandsLoaded).toBe(true)
    expect(store.activeCommands.map((command) => command.name)).toEqual(
      expect.arrayContaining(['reload', 'skill:test'])
    )

    await store.ensureCommandsLoaded()

    expect(getCommands).toHaveBeenCalledTimes(1)
  })

  it('暴露 compact、export、clone 和创建分支 thread 操作', async () => {
    const compact = vi.fn().mockResolvedValue({ cancelled: false })
    const exportSession = vi.fn().mockResolvedValue({ path: '/tmp/session.html' })
    const revealResourcePath = vi.fn().mockResolvedValue(undefined)
    const clone = vi.fn().mockResolvedValue(createSnapshot())
    const forkSnapshot = {
      ...createSnapshot(),
      threadId: 'thread-b',
      sessionFile: '/tmp/fork-session.jsonl',
      title: '分支会话'
    }
    const forkThread = vi.fn().mockResolvedValue({ cancelled: false, snapshot: forkSnapshot })
    const getSnapshot = vi.fn().mockResolvedValue(createSnapshot())
    installCodingAgentApi({
      compact,
      exportSession,
      revealResourcePath,
      clone,
      forkThread,
      getSnapshot
    })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')

    await store.compactActive()
    await store.exportActiveSession()
    await store.openActiveExport()
    await store.revealActiveExport()
    expect(store.activeExportResult).toEqual({ path: '/tmp/session.html' })
    await store.cloneActiveSession()
    await store.forkActiveSession('assistant-a')

    expect(compact).toHaveBeenCalledWith({ threadId: 'thread-a', customInstructions: undefined })
    expect(exportSession).toHaveBeenCalledWith({ threadId: 'thread-a' })
    expect(revealResourcePath).toHaveBeenNthCalledWith(1, {
      path: '/tmp/session.html',
      mode: 'open'
    })
    expect(revealResourcePath).toHaveBeenNthCalledWith(2, {
      path: '/tmp/session.html',
      mode: 'reveal'
    })
    expect(clone).toHaveBeenCalledWith('thread-a')
    expect(forkThread).toHaveBeenCalledWith({
      threadId: 'thread-a',
      entryId: 'assistant-a',
      position: 'at'
    })
    expect(store.activeSessionId).toBe('thread-b')
    expect(store.sessionsByProject['project-a']?.map((session) => session.threadId)).toEqual(
      expect.arrayContaining(['thread-a', 'thread-b'])
    )
    expectLastSessionNotification(store, '已创建分支会话')
  })

  it('取消 session tree 导航时保留当前 snapshot 与草稿', async () => {
    const initialSnapshot: ThreadSnapshot = {
      ...createSnapshot(),
      currentEntryId: 'entry-a',
      messages: [
        {
          id: 'message-a',
          role: 'user',
          text: 'before',
          raw: { role: 'user', content: 'before', timestamp: fixtureTimestamp }
        }
      ]
    }
    const navigateTree = vi.fn().mockResolvedValue({
      cancelled: true,
      snapshot: {
        ...createSnapshot(),
        currentEntryId: 'entry-b',
        messages: [
          {
            id: 'message-b',
            role: 'assistant',
            text: 'should not apply'
          }
        ]
      }
    })
    installCodingAgentApi({ getSnapshot: vi.fn().mockResolvedValue(initialSnapshot), navigateTree })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(initialSnapshot)
    await store.setActiveSessionId('thread-a')
    store.draftMessage = createComposerContent('keep draft')

    await store.navigateActiveSessionTree('entry-b')

    expect(navigateTree).toHaveBeenCalledWith({
      threadId: 'thread-a',
      entryId: 'entry-b',
      summarize: false
    })
    expect(store.activeSnapshot?.currentEntryId).toBe('entry-a')
    expect(store.activeSnapshot?.messages).toEqual(initialSnapshot.messages)
    expect(store.draftMessage).toEqual(createComposerContent('keep draft'))
    expect(store.activeSessionActionMessage).toBe('Tree 导航已取消')
  })

  it('从 user message 导航时将原始 prompt 恢复为 Composer 结构化引用', async () => {
    const initialSnapshot: ThreadSnapshot = {
      ...createSnapshot(),
      cwd: 'H:\\repo',
      currentEntryId: 'entry-a'
    }
    const movedSnapshot: ThreadSnapshot = {
      ...createSnapshot(),
      cwd: 'H:\\repo',
      currentEntryId: 'entry-b'
    }
    const editorText =
      '<file name="H:\\repo\\src\\App.vue" data-meta-agent-context="true">\nsource\n</file>\n' +
      '<file name="H:\\repo\\notes.docx" data-meta-agent-context="true">[Skipped: 不是支持的文本或图片文件.]</file>\n' +
      '<quoted_context data-meta-agent-context="true">\n' +
      '<quote message_id="assistant-a" session_entry_id="assistant-entry-a">\n引用正文\n</quote>\n' +
      '</quoted_context>\n\n' +
      '<skill name="review" location="H:\\skills\\review\\SKILL.md" data-meta-agent-context="true">\n' +
      'References are relative to H:\\skills\\review.\n\n# Review\n</skill>\n\n' +
      '请用 $skill:review 检查 @src/App.vue'
    const navigateTree = vi.fn().mockResolvedValue({ snapshot: movedSnapshot, editorText })
    installCodingAgentApi({ getSnapshot: vi.fn().mockResolvedValue(initialSnapshot), navigateTree })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(initialSnapshot)
    await store.setActiveSessionId('thread-a')
    store.addComposerImages([
      {
        id: 'stale-image',
        type: 'image',
        mimeType: 'image/png',
        data: 'stale',
        name: 'stale.png',
        size: 5,
        hints: []
      }
    ])
    store.addComposerFiles([
      { id: 'stale-file', path: 'H:\\stale.txt', name: 'stale.txt', size: 5 }
    ])
    store.addComposerQuote({ id: 'stale-quote', messageId: 'stale', text: 'stale' })

    await store.navigateActiveSessionTree('entry-b')

    expect(store.getComposerImages()).toEqual([])
    expect(store.draftMessage).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '请用 ' },
            {
              type: 'skillReference',
              attrs: {
                name: 'skill:review',
                label: 'skill:review',
                path: 'H:\\skills\\review\\SKILL.md',
                baseDir: 'H:\\skills\\review'
              }
            },
            { type: 'text', text: ' 检查 ' },
            {
              type: 'fileReference',
              attrs: { fileArg: 'src/App.vue', label: 'App.vue' }
            }
          ]
        }
      ]
    })
    expect(store.getComposerFiles()).toEqual([
      expect.objectContaining({ path: 'H:\\repo\\notes.docx', name: 'notes.docx' })
    ])
    expect(store.getComposerQuotes()).toEqual([
      expect.objectContaining({
        messageId: 'assistant-a',
        sessionEntryId: 'assistant-entry-a',
        text: '引用正文'
      })
    ])
  })

  it('tree 导航不把未标记的用户 XML 提升为本地附件', async () => {
    const initialSnapshot: ThreadSnapshot = {
      ...createSnapshot(),
      cwd: 'H:\\repo',
      currentEntryId: 'entry-a'
    }
    const editorText =
      '<file name="config.txt">sample</file>\n' +
      '<skill name="review" location="H:\\secrets\\token.txt">body</skill>\n' +
      '解释这个 XML'
    const navigateTree = vi.fn().mockResolvedValue({
      snapshot: { ...initialSnapshot, currentEntryId: 'entry-b' },
      editorText
    })
    installCodingAgentApi({ getSnapshot: vi.fn().mockResolvedValue(initialSnapshot), navigateTree })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(initialSnapshot)
    await store.setActiveSessionId('thread-a')

    await store.navigateActiveSessionTree('entry-b')

    expect(store.getComposerFiles()).toEqual([])
    expect(store.getComposerQuotes()).toEqual([])
    expect(store.draftMessage).toEqual(createComposerContentFromText(editorText))
  })

  it('tree 导航按 cwd 解析文件引用，不用路径后缀误绑定附件', async () => {
    const initialSnapshot: ThreadSnapshot = {
      ...createSnapshot(),
      cwd: 'H:\\repo',
      currentEntryId: 'entry-a'
    }
    const editorText =
      '<file name="H:\\external\\src\\App.vue" data-meta-agent-context="true">external</file>\n' +
      '<file name="H:\\repo\\src\\App.vue" data-meta-agent-context="true">project</file>\n' +
      '检查 @src/App.vue'
    const navigateTree = vi.fn().mockResolvedValue({
      snapshot: { ...initialSnapshot, currentEntryId: 'entry-b' },
      editorText
    })
    installCodingAgentApi({ getSnapshot: vi.fn().mockResolvedValue(initialSnapshot), navigateTree })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(initialSnapshot)
    await store.setActiveSessionId('thread-a')

    await store.navigateActiveSessionTree('entry-b')

    expect(store.getComposerFiles()).toEqual([
      expect.objectContaining({ path: 'H:\\external\\src\\App.vue' })
    ])
    expect(store.draftMessage).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '检查 ' },
            {
              type: 'fileReference',
              attrs: { fileArg: 'src/App.vue', label: 'App.vue' }
            }
          ]
        }
      ]
    })
  })

  it('异步 tree 导航返回时只恢复发起导航的 thread 草稿', async () => {
    const snapshotA: ThreadSnapshot = {
      ...createSnapshot(),
      threadId: 'thread-a',
      currentEntryId: 'entry-a'
    }
    const snapshotB: ThreadSnapshot = {
      ...createSnapshot(),
      threadId: 'thread-b',
      currentEntryId: 'entry-b'
    }
    let resolveNavigation!: (value: { snapshot: ThreadSnapshot; editorText: string }) => void
    const navigateTree = vi.fn(
      () =>
        new Promise<{ snapshot: ThreadSnapshot; editorText: string }>((resolve) => {
          resolveNavigation = resolve
        })
    )
    installCodingAgentApi({ getSnapshot: vi.fn(), navigateTree })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(snapshotA)
    store.sessions['thread-b'] = snapshotToWorkspaceSession(snapshotB)
    await store.setActiveSessionId('thread-a')

    const pendingNavigation = store.navigateActiveSessionTree('entry-target')
    await store.setActiveSessionId('thread-b')
    store.draftMessage = createComposerContent('thread b draft')
    resolveNavigation({
      snapshot: { ...snapshotA, currentEntryId: 'entry-target' },
      editorText: 'restored a'
    })
    await pendingNavigation

    expect(store.activeSessionId).toBe('thread-b')
    expect(store.draftMessage).toEqual(createComposerContent('thread b draft'))
    await store.setActiveSessionId('thread-a')
    expect(store.draftMessage).toEqual(createComposerContent('restored a'))
  })

  it('session tree 导航成功后记录 previous leaf 并可返回', async () => {
    const initialSnapshot: ThreadSnapshot = {
      ...createSnapshot(),
      currentEntryId: 'entry-a'
    }
    const movedSnapshot: ThreadSnapshot = {
      ...createSnapshot(),
      currentEntryId: 'entry-b'
    }
    const restoredSnapshot: ThreadSnapshot = {
      ...createSnapshot(),
      currentEntryId: 'entry-a'
    }
    const navigateTree = vi
      .fn()
      .mockResolvedValueOnce({ snapshot: movedSnapshot })
      .mockResolvedValueOnce({ snapshot: restoredSnapshot })
    installCodingAgentApi({ getSnapshot: vi.fn().mockResolvedValue(initialSnapshot), navigateTree })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(initialSnapshot)
    await store.setActiveSessionId('thread-a')

    await store.navigateActiveSessionTree('entry-b')

    expect(store.activePreviousLeafEntryId).toBe('entry-a')
    expect(store.activeSnapshot?.currentEntryId).toBe('entry-b')

    await store.navigateBackToPreviousLeaf()

    expect(navigateTree).toHaveBeenNthCalledWith(2, {
      threadId: 'thread-a',
      entryId: 'entry-a',
      summarize: false
    })
    expect(store.activePreviousLeafEntryId).toBeUndefined()
    expect(store.activeSnapshot?.currentEntryId).toBe('entry-a')
    expect(store.activeSessionActionMessage).toBe('已返回之前位置')
  })

  it('session tree 导航成功后立即移除新 leaf 之后的消息', async () => {
    const messages: ThreadSnapshot['messages'] = [
      {
        id: 'message-a',
        role: 'user',
        text: 'first',
        sessionEntryId: 'entry-a',
        raw: { role: 'user', content: 'first', timestamp: fixtureTimestamp }
      },
      {
        id: 'message-b',
        role: 'assistant',
        text: 'second',
        sessionEntryId: 'entry-b',
        raw: createAssistantMessage('second', fixtureTimestamp)
      },
      {
        id: 'message-c',
        role: 'user',
        text: 'third',
        sessionEntryId: 'entry-c',
        raw: { role: 'user', content: 'third', timestamp: fixtureTimestamp + 1 }
      },
      {
        id: 'message-d',
        role: 'assistant',
        text: 'fourth',
        sessionEntryId: 'entry-d',
        raw: createAssistantMessage('fourth', fixtureTimestamp + 2)
      }
    ]
    const initialSnapshot: ThreadSnapshot = {
      ...createSnapshot(),
      currentEntryId: 'entry-d',
      messages
    }
    const movedSnapshot: ThreadSnapshot = {
      ...initialSnapshot,
      currentEntryId: 'entry-b',
      messages: messages.slice(0, 2)
    }
    const navigateTree = vi.fn().mockResolvedValue({ snapshot: movedSnapshot })
    installCodingAgentApi({ getSnapshot: vi.fn().mockResolvedValue(initialSnapshot), navigateTree })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(initialSnapshot)
    await store.setActiveSessionId('thread-a')

    await store.navigateActiveSessionTree('entry-b')

    expect(store.activeSnapshot?.messages.map((message) => message.id)).toEqual([
      'message-a',
      'message-b'
    ])
  })

  it('session tree 导航丢弃导航前尚未 flush 的旧分支消息事件', async () => {
    const frameCallbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const initialSnapshot: ThreadSnapshot = {
      ...createSnapshot(),
      currentEntryId: 'entry-old',
      messages: [
        {
          id: 'message-a',
          role: 'user',
          text: 'first',
          sessionEntryId: 'entry-a',
          raw: { role: 'user', content: 'first', timestamp: fixtureTimestamp }
        }
      ]
    }
    const movedSnapshot: ThreadSnapshot = {
      ...initialSnapshot,
      currentEntryId: 'entry-a'
    }
    installCodingAgentApi({
      getSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
      navigateTree: vi.fn().mockResolvedValue({ snapshot: movedSnapshot })
    })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(initialSnapshot)
    await store.setActiveSessionId('thread-a')

    capturedEventListener?.({
      type: 'message_end',
      threadId: 'thread-a',
      sessionEntryId: 'entry-old',
      message: createAssistantMessage('old branch tail', fixtureTimestamp)
    })
    await store.navigateActiveSessionTree('entry-a')
    for (const callback of frameCallbacks) callback(0)

    expect(store.activeSnapshot?.messages.map((message) => message.id)).toEqual(['message-a'])
  })

  it('Tree 刷新只替换发生变化的 entry row', () => {
    const stableRow = createSessionTreeEntryRow('entry-a')
    const changedRow = createSessionTreeEntryRow('entry-b', { current: true })
    const previous: LoadSessionTreeBranchesResult = {
      rows: [stableRow, changedRow],
      totalEntries: 2,
      visibleEntries: 2,
      currentEntryId: 'entry-b'
    }
    const nextChangedRow = { ...changedRow, current: false }
    const next: LoadSessionTreeBranchesResult = {
      rows: [{ ...stableRow }, nextChangedRow],
      totalEntries: 2,
      visibleEntries: 2,
      currentEntryId: null
    }

    const reconciled = reconcileSessionTreeBranchesResult(previous, next)

    expect(reconciled).not.toBe(previous)
    expect(reconciled.rows[0]).toBe(stableRow)
    expect(reconciled.rows[1]).toBe(nextChangedRow)
  })

  it('Tree 内容未变化时复用完整结果', () => {
    const stableRow = createSessionTreeEntryRow('entry-a', { current: true })
    const previous: LoadSessionTreeBranchesResult = {
      rows: [stableRow],
      totalEntries: 1,
      visibleEntries: 1,
      currentEntryId: 'entry-a'
    }
    const next: LoadSessionTreeBranchesResult = {
      ...previous,
      rows: [{ ...stableRow }]
    }

    expect(reconcileSessionTreeBranchesResult(previous, next)).toBe(previous)
  })

  it('加载 main 派生的扁平 branch rows', async () => {
    const branchResult = {
      rows: [
        {
          kind: 'entry' as const,
          id: 'entry-a',
          entryId: 'entry-a',
          parentId: null,
          type: 'message',
          timestamp: '2026-07-01T00:00:00.000Z',
          title: 'user: start',
          summary: 'start',
          depth: 0,
          visualDepth: 0,
          childCount: 0,
          leaf: true,
          branchPoint: false,
          current: true
        }
      ],
      totalEntries: 3,
      visibleEntries: 1,
      currentEntryId: 'entry-a'
    }
    const loadSessionTreeBranches = vi.fn().mockResolvedValue(branchResult)
    installCodingAgentApi({
      getSnapshot: vi.fn().mockResolvedValue(createSnapshot()),
      loadSessionTreeBranches
    })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')

    await store.loadActiveSessionTreeBranches({
      query: 'start',
      filter: 'user'
    })

    expect(loadSessionTreeBranches).toHaveBeenCalledWith({
      threadId: 'thread-a',
      query: 'start',
      filter: 'user'
    })
    expect(store.activeSessionTreeBranches).toEqual(branchResult)
    expect(store.activeSessionTreeBranchesLoading).toBe(false)
    expect(store.activeSessionTreeBranchesError).toBeUndefined()
  })

  it('branch rows 加载失败时清空旧结果，避免展示过期数据', async () => {
    const branchResult = {
      rows: [
        {
          kind: 'entry' as const,
          id: 'entry-a',
          entryId: 'entry-a',
          parentId: null,
          type: 'message',
          timestamp: '2026-07-01T00:00:00.000Z',
          title: 'user: start',
          summary: 'start',
          depth: 0,
          visualDepth: 0,
          childCount: 0,
          leaf: true,
          branchPoint: false,
          current: true
        }
      ],
      totalEntries: 1,
      visibleEntries: 1,
      currentEntryId: 'entry-a'
    }
    const loadSessionTreeBranches = vi
      .fn()
      .mockResolvedValueOnce(branchResult)
      .mockRejectedValueOnce(new Error('session missing'))
    installCodingAgentApi({
      getSnapshot: vi.fn().mockResolvedValue(createSnapshot()),
      loadSessionTreeBranches
    })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')

    await store.loadActiveSessionTreeBranches({ query: 'start' })
    expect(store.activeSessionTreeBranches).toEqual(branchResult)

    await store.loadActiveSessionTreeBranches({ query: 'missing' })

    expect(store.activeSessionTreeBranches).toBeUndefined()
    expect(store.activeSessionTreeBranchesLoading).toBe(false)
    expect(store.activeSessionTreeBranchesError).toBe('session missing')
  })

  it('message_end 后递增 branch rows 版本以触发 Tree tab 重新加载', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const branchResult = {
      rows: [
        {
          kind: 'entry' as const,
          id: 'entry-a',
          entryId: 'entry-a',
          parentId: null,
          type: 'message',
          timestamp: '2026-07-01T00:00:00.000Z',
          title: 'user: start',
          summary: 'start',
          depth: 0,
          visualDepth: 0,
          childCount: 0,
          leaf: true,
          branchPoint: false,
          current: true
        }
      ],
      totalEntries: 1,
      visibleEntries: 1,
      currentEntryId: 'entry-a'
    }
    installCodingAgentApi({
      getSnapshot: vi.fn().mockResolvedValue(createSnapshot()),
      loadSessionTreeBranches: vi.fn().mockResolvedValue(branchResult)
    })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')

    await store.loadActiveSessionTreeBranches()
    expect(store.activeSessionTreeBranchesState?.revision).toBe(0)

    capturedEventListener?.({
      type: 'message_end',
      threadId: 'thread-a',
      sessionEntryId: 'entry-b',
      message: createAssistantMessage('done', fixtureTimestamp)
    })

    expect(store.activeSessionTreeBranchesState?.revision).toBe(1)
  })

  it('branch rows 失效后丢弃相同查询条件的旧响应', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const staleBranchResult = {
      rows: [
        {
          kind: 'entry' as const,
          id: 'entry-a',
          entryId: 'entry-a',
          parentId: null,
          type: 'message',
          timestamp: '2026-07-01T00:00:00.000Z',
          title: 'user: stale',
          summary: 'stale',
          depth: 0,
          visualDepth: 0,
          childCount: 0,
          leaf: true,
          branchPoint: false,
          current: true
        }
      ],
      totalEntries: 1,
      visibleEntries: 1,
      currentEntryId: 'entry-a'
    }
    const freshBranchResult = {
      rows: [
        {
          kind: 'entry' as const,
          id: 'entry-b',
          entryId: 'entry-b',
          parentId: 'entry-a',
          type: 'message',
          timestamp: '2026-07-01T00:00:05.000Z',
          title: 'assistant: fresh',
          summary: 'fresh',
          depth: 1,
          visualDepth: 1,
          childCount: 0,
          leaf: true,
          branchPoint: false,
          current: true
        }
      ],
      totalEntries: 2,
      visibleEntries: 2,
      currentEntryId: 'entry-b'
    }
    let resolveStaleResponse: (value: typeof staleBranchResult) => void = () => {}
    const staleResponse = new Promise<typeof staleBranchResult>((resolve) => {
      resolveStaleResponse = resolve
    })
    const loadSessionTreeBranches = vi
      .fn()
      .mockReturnValueOnce(staleResponse)
      .mockResolvedValueOnce(freshBranchResult)
    installCodingAgentApi({
      getSnapshot: vi.fn().mockResolvedValue(createSnapshot()),
      loadSessionTreeBranches
    })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')

    const staleLoad = store.loadActiveSessionTreeBranches()
    capturedEventListener?.({
      type: 'message_end',
      threadId: 'thread-a',
      sessionEntryId: 'entry-b',
      message: createAssistantMessage('done', fixtureTimestamp)
    })
    await store.loadActiveSessionTreeBranches()
    expect(store.activeSessionTreeBranches).toEqual(freshBranchResult)

    resolveStaleResponse(staleBranchResult)
    await staleLoad

    expect(store.activeSessionTreeBranches).toEqual(freshBranchResult)
  })

  it('打开 fork 来源时优先切换到已有 parent thread', async () => {
    installCodingAgentApi({ getSnapshot: vi.fn().mockResolvedValue(createSnapshot()) })
    const store = useWorkspaceSessionStore()
    const parentSnapshot: ThreadSnapshot = {
      ...createSnapshot(),
      threadId: 'thread-parent',
      title: '来源会话',
      sessionFile: '/tmp/parent.jsonl'
    }
    const childSnapshot: ThreadSnapshot = {
      ...createSnapshot(),
      threadId: 'thread-child',
      title: '分支会话',
      sessionFile: '/tmp/child.jsonl',
      lineage: {
        parentSessionFile: '/tmp/parent.jsonl',
        parentThreadId: 'thread-parent',
        parentThreadTitle: '来源会话'
      }
    }
    store.sessions['thread-parent'] = snapshotToWorkspaceSession(parentSnapshot)
    store.sessions['thread-child'] = snapshotToWorkspaceSession(childSnapshot)
    await store.setActiveSessionId('thread-child')

    await store.openParentSession()

    expect(store.activeSessionId).toBe('thread-parent')
    expectLastSessionNotification(store, '已打开来源对话')
  })

  it('打开 fork 来源时可从 parentSessionFile 恢复 sidebar thread', async () => {
    const parentSnapshot: ThreadSnapshot = {
      ...createSnapshot(),
      threadId: 'thread-restored',
      title: '恢复的来源',
      sessionFile: '/tmp/parent.jsonl'
    }
    const createThread = vi.fn().mockResolvedValue(parentSnapshot)
    installCodingAgentApi({
      createThread,
      getSnapshot: vi.fn().mockResolvedValue(createSnapshot())
    })
    const store = useWorkspaceSessionStore()
    const childSnapshot: ThreadSnapshot = {
      ...createSnapshot(),
      threadId: 'thread-child',
      title: '分支会话',
      sessionFile: '/tmp/child.jsonl',
      lineage: {
        parentSessionFile: '/tmp/parent.jsonl',
        parentSessionExists: true
      }
    }
    store.sessions['thread-child'] = snapshotToWorkspaceSession(childSnapshot)
    await store.setActiveSessionId('thread-child')

    await store.openParentSession()

    expect(createThread).toHaveBeenCalledWith({
      projectId: 'project-a',
      sessionFile: '/tmp/parent.jsonl'
    })
    expect(store.activeSessionId).toBe('thread-restored')
    expectLastSessionNotification(store, '已恢复来源对话')
  })

  it('从 parentSessionFile 恢复来源失败时不误报成功', async () => {
    const createThread = vi.fn().mockRejectedValue(new Error('restore failed'))
    installCodingAgentApi({
      createThread,
      getSnapshot: vi.fn().mockResolvedValue(createSnapshot())
    })
    const store = useWorkspaceSessionStore()
    const childSnapshot: ThreadSnapshot = {
      ...createSnapshot(),
      threadId: 'thread-child',
      title: '分支会话',
      sessionFile: '/tmp/child.jsonl',
      lineage: {
        parentSessionFile: '/tmp/parent.jsonl',
        parentSessionExists: true
      }
    }
    store.sessions['thread-child'] = snapshotToWorkspaceSession(childSnapshot)
    await store.setActiveSessionId('thread-child')

    await store.openParentSession()

    expect(createThread).toHaveBeenCalledWith({
      projectId: 'project-a',
      sessionFile: '/tmp/parent.jsonl'
    })
    expect(store.activeSessionId).toBe('thread-child')
    expect(store.activeSessionActionMessage).toBeUndefined()
    expect(store.errorMessage).toBe('来源对话不可用')
  })

  it('打开已归档 fork 来源时先恢复 parent thread', async () => {
    const parentSnapshot: ThreadSnapshot = {
      ...createSnapshot(),
      threadId: 'thread-parent',
      title: '来源会话',
      sessionFile: '/tmp/parent.jsonl'
    }
    const childSnapshot: ThreadSnapshot = {
      ...createSnapshot(),
      threadId: 'thread-child',
      title: '分支会话',
      sessionFile: '/tmp/child.jsonl',
      lineage: {
        parentSessionFile: '/tmp/parent.jsonl',
        parentThreadId: 'thread-parent',
        parentThreadTitle: '来源会话',
        parentThreadArchivedAt: '2026-07-01T00:00:00.000Z'
      }
    }
    const restoreThread = vi.fn().mockResolvedValue(undefined)
    const listThreads = vi
      .fn()
      .mockResolvedValue([
        snapshotToWorkspaceSession(childSnapshot),
        snapshotToWorkspaceSession(parentSnapshot)
      ])
    installCodingAgentApi({
      createThread: vi.fn(),
      getSnapshot: vi.fn().mockResolvedValue(childSnapshot),
      listThreads,
      restoreThread
    })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-child'] = snapshotToWorkspaceSession(childSnapshot)
    await store.setActiveSessionId('thread-child')

    await store.openParentSession()

    expect(restoreThread).toHaveBeenCalledWith('thread-parent')
    expect(window.api.codingAgent.createThread).not.toHaveBeenCalled()
    expect(store.activeSessionId).toBe('thread-parent')
    expectLastSessionNotification(store, '已恢复并打开来源对话')
  })

  it('消费 compaction 事件并刷新持久化后的 snapshot', async () => {
    const initialSnapshot = createSnapshot()
    const compactedSnapshot: ThreadSnapshot = {
      ...createSnapshot(),
      messages: [
        {
          id: 'message-compaction',
          role: 'system',
          text: 'compressed summary',
          raw: { role: 'compactionSummary', summary: 'compressed summary' } as never,
          systemEvent: { kind: 'compaction', title: '上下文已压缩' }
        }
      ]
    }
    const getSnapshot = vi.fn().mockResolvedValue(compactedSnapshot)
    installCodingAgentApi({ getSnapshot })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(initialSnapshot)
    const beforeSession = store.sessions['thread-a']
    await store.setActiveSessionId('thread-a')
    getSnapshot.mockClear()

    capturedEventListener?.({
      type: 'compaction_start',
      threadId: 'thread-a',
      reason: 'manual'
    })

    expect(store.activeCompactionState).toMatchObject({
      reason: 'manual',
      running: true
    })
    expect(store.activeSession?.status).toBe('running')
    expect(store.activeSnapshot?.status).toBe('running')
    expectLastSessionNotification(store, '正在压缩上下文')

    capturedEventListener?.({
      type: 'compaction_end',
      threadId: 'thread-a',
      reason: 'manual',
      result: {
        summary: 'compressed',
        firstKeptEntryId: 'message-a',
        tokensBefore: 120000,
        estimatedTokensAfter: 16000
      },
      aborted: false,
      willRetry: false
    })

    expect(store.activeCompactionState).toMatchObject({
      reason: 'manual',
      running: false,
      aborted: false
    })
    expect(store.activeSession?.status).toBe('idle')
    expect(store.activeSnapshot?.status).toBe('idle')
    expectLastSessionNotification(store, '上下文已压缩')
    expect(getSnapshot).toHaveBeenCalledWith('thread-a')
    expect(store.sessions['thread-a']).not.toBe(beforeSession)
    expect(store.activeSnapshot?.messages).toMatchObject([
      {
        role: 'system',
        text: 'compressed summary',
        systemEvent: { kind: 'compaction' }
      }
    ])
  })

  it('自动压缩结束后需要重试时保持 running 并刷新 snapshot', async () => {
    const initialSnapshot = createSnapshot()
    const compactedSnapshot: ThreadSnapshot = {
      ...createSnapshot(),
      status: 'running',
      messages: [
        ...initialSnapshot.messages,
        {
          id: 'message-compaction',
          role: 'system',
          text: 'compressed summary',
          raw: { role: 'compactionSummary', summary: 'compressed summary' } as never,
          systemEvent: { kind: 'compaction', title: '上下文已压缩' }
        }
      ]
    }
    const getSnapshot = vi.fn().mockResolvedValue(compactedSnapshot)
    installCodingAgentApi({ getSnapshot })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(initialSnapshot)
    await store.setActiveSessionId('thread-a')
    getSnapshot.mockClear()

    capturedEventListener?.({
      type: 'compaction_start',
      threadId: 'thread-a',
      reason: 'overflow'
    })
    capturedEventListener?.({
      type: 'compaction_end',
      threadId: 'thread-a',
      reason: 'overflow',
      result: {
        summary: 'compressed',
        firstKeptEntryId: 'message-a',
        tokensBefore: 120000,
        estimatedTokensAfter: 16000
      },
      aborted: false,
      willRetry: true
    })

    expect(store.activeCompactionState).toMatchObject({
      reason: 'overflow',
      running: false,
      aborted: false,
      willRetry: true
    })
    expect(store.activeSession?.status).toBe('running')
    expect(store.activeSnapshot?.status).toBe('running')
    expect(getSnapshot).toHaveBeenCalledWith('thread-a')
    await vi.waitFor(() => {
      expect(store.activeSnapshot?.messages.at(-1)?.systemEvent?.kind).toBe('compaction')
    })
    expect(store.activeSession?.status).toBe('running')
  })

  it('暴露 new、import 和 switch session 操作', async () => {
    const newSnapshot = {
      ...createSnapshot(),
      sessionFile: '/tmp/new-session.jsonl'
    }
    const importedSnapshot = {
      ...createSnapshot(),
      sessionFile: '/tmp/imported.jsonl'
    }
    const switchedSnapshot = {
      ...createSnapshot(),
      sessionFile: '/tmp/existing.jsonl'
    }
    const newSession = vi.fn().mockResolvedValue(newSnapshot)
    const selectSessionFile = vi.fn().mockResolvedValue('/tmp/imported.jsonl')
    const importSession = vi.fn().mockResolvedValue(importedSnapshot)
    const switchSession = vi.fn().mockResolvedValue(switchedSnapshot)
    installCodingAgentApi({
      newSession,
      selectSessionFile,
      importSession,
      switchSession
    })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession({
      ...createSnapshot(),
      sessionFile: '/tmp/session.jsonl'
    })
    await store.setActiveSessionId('thread-a')

    await store.newActiveSession()
    expect(store.activePreviousSessionFile).toBe('/tmp/session.jsonl')
    await store.importActiveSessionFromPicker()
    await store.switchActiveSessionPath('/tmp/existing.jsonl')

    expect(newSession).toHaveBeenCalledWith({ threadId: 'thread-a', parentSession: undefined })
    expect(selectSessionFile).toHaveBeenCalledWith({ title: '导入 Pi Session' })
    expect(importSession).toHaveBeenCalledWith({
      threadId: 'thread-a',
      inputPath: '/tmp/imported.jsonl'
    })
    expect(switchSession).toHaveBeenCalledWith({
      threadId: 'thread-a',
      sessionPath: '/tmp/existing.jsonl'
    })
    expect(store.activeSnapshot?.sessionFile).toBe('/tmp/existing.jsonl')
    expect(store.activePreviousSessionFile).toBe('/tmp/imported.jsonl')
    expectLastSessionNotification(store, '已切换到 /tmp/existing.jsonl')
  })

  it('暴露模型、thinking 和 runtime control 操作', async () => {
    const cycledSnapshot = {
      ...createSnapshot(),
      model: {
        provider: 'openai',
        id: 'gpt-5',
        displayName: 'GPT-5'
      },
      thinkingLevel: 'high' as const
    }
    const cycleModel = vi.fn().mockResolvedValue({
      model: {
        provider: 'openai',
        id: 'gpt-5',
        displayName: 'GPT-5'
      },
      thinkingLevel: 'high',
      isScoped: false
    })
    const cycleThinkingLevel = vi.fn().mockResolvedValue({ level: 'high' })
    const setAutoCompaction = vi.fn().mockResolvedValue(undefined)
    const setAutoRetry = vi.fn().mockResolvedValue(undefined)
    const abortRetry = vi.fn().mockResolvedValue(undefined)
    const getSnapshot = vi.fn().mockResolvedValue(cycledSnapshot)
    installCodingAgentApi({
      cycleModel,
      cycleThinkingLevel,
      setAutoCompaction,
      setAutoRetry,
      abortRetry,
      getSnapshot
    })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')

    await store.cycleActiveModel()
    await store.cycleActiveThinkingLevel()
    await store.setActiveAutoCompaction(false)
    await store.setActiveAutoRetry(false)
    await store.abortActiveRetry()

    expect(cycleModel).toHaveBeenCalledWith('thread-a')
    expect(cycleThinkingLevel).toHaveBeenCalledWith('thread-a')
    expect(setAutoCompaction).toHaveBeenCalledWith({ threadId: 'thread-a', enabled: false })
    expect(setAutoRetry).toHaveBeenCalledWith({ threadId: 'thread-a', enabled: false })
    expect(abortRetry).toHaveBeenCalledWith('thread-a')
    expect(store.activeSnapshot?.model?.displayName).toBe('GPT-5')
    expect(store.activeSnapshot?.thinkingLevel).toBe('high')
    expectLastSessionNotification(store, '已中止自动重试')
  })

  it('投影 auto retry 事件到当前 runtime 状态', async () => {
    installCodingAgentApi({})
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')

    capturedEventListener?.({
      type: 'auto_retry_start',
      threadId: 'thread-a',
      attempt: 2,
      maxAttempts: 4,
      delayMs: 1500,
      errorMessage: 'provider overloaded'
    })

    expect(store.activeRetryState).toMatchObject({
      attempt: 2,
      maxAttempts: 4,
      delayMs: 1500,
      errorMessage: 'provider overloaded'
    })
    expect(store.activeSession?.status).toBe('running')
    expect(store.activeSnapshot?.status).toBe('running')

    capturedEventListener?.({
      type: 'auto_retry_end',
      threadId: 'thread-a',
      success: false,
      attempt: 2,
      finalError: 'cancelled'
    })

    expect(store.activeRetryState).toBeUndefined()
    expect(store.activeSession?.status).toBe('idle')
    expect(store.activeSnapshot?.status).toBe('idle')
    expectLastSessionNotification(store, '自动重试结束：cancelled')
  })

  it('自动重试等待后成功响应时保持 running 并在完成后回到 idle', async () => {
    installCodingAgentApi({})
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(createSnapshot())
    await store.setActiveSessionId('thread-a')

    capturedEventListener?.({
      type: 'auto_retry_start',
      threadId: 'thread-a',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2000,
      errorMessage: 'OpenAI API error (502): upstream failed'
    })

    expect(store.activeRetryState).toMatchObject({ attempt: 1, maxAttempts: 3, delayMs: 2000 })
    expect(store.activeSession?.status).toBe('running')
    expect(store.activeSnapshot?.status).toBe('running')

    capturedEventListener?.({
      type: 'message_end',
      threadId: 'thread-a',
      message: createAssistantMessage('retry recovered', fixtureTimestamp)
    })

    expect(store.activeSession?.status).toBe('running')
    expect(store.activeSnapshot?.status).toBe('running')
    expect(store.activeSnapshot?.messages).toMatchObject([
      {
        role: 'assistant',
        text: 'retry recovered',
        raw: { stopReason: 'stop' }
      }
    ])

    capturedEventListener?.({
      type: 'agent_end',
      threadId: 'thread-a',
      messages: [],
      willRetry: false
    })
    capturedEventListener?.({
      type: 'auto_retry_end',
      threadId: 'thread-a',
      success: true,
      attempt: 1
    })

    expect(store.activeRetryState).toBeUndefined()
    expect(store.activeSession?.status).toBe('idle')
    expect(store.activeSnapshot?.status).toBe('idle')
    expectLastSessionNotification(store, '自动重试已恢复')
    expect(store.activeSnapshot?.messages.at(-1)).toMatchObject({
      role: 'assistant',
      text: 'retry recovered'
    })
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

  it('允许发送只有文本引用的 Composer 草稿并在成功后清空', async () => {
    const snapshot = createSnapshot()
    const prompt = vi.fn().mockResolvedValue(undefined)
    installCodingAgentApi({ prompt })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(snapshot)
    await store.setActiveSessionId('thread-a')
    store.addComposerQuote({
      id: 'quote-a',
      messageId: 'assistant-a',
      sessionEntryId: 'entry-a',
      text: '引用正文'
    })

    await store.sendPrompt()

    expect(prompt).toHaveBeenCalledWith({
      threadId: 'thread-a',
      message: '请基于引用内容回答',
      quoteContexts: [
        {
          messageId: 'assistant-a',
          sessionEntryId: 'entry-a',
          text: '引用正文'
        }
      ]
    })
    expect(store.draftQuotes).toEqual([])
    expect(store.hasDraftMessage).toBe(false)
  })

  it('将 Browser element chip 作为结构化引用 context 发送', async () => {
    const snapshot = createSnapshot()
    const prompt = vi.fn().mockResolvedValue(undefined)
    installCodingAgentApi({ prompt })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(snapshot)
    await store.setActiveSessionId('thread-a')
    store.addComposerQuote({
      id: 'browser-element-a',
      kind: 'browser-element',
      browserRef: 'ref-picked-1',
      tagName: 'button',
      label: 'Save',
      messageId: 'browser-element:ref-picked-1',
      text: '[Browser element ref-picked-1: <button> Save]'
    })

    await store.sendPrompt()

    expect(prompt).toHaveBeenCalledWith({
      threadId: 'thread-a',
      message: '请基于引用内容回答',
      quoteContexts: [
        {
          messageId: 'browser-element:ref-picked-1',
          text: '[Browser element ref-picked-1: <button> Save]'
        }
      ]
    })
    expect(store.draftQuotes).toEqual([])
  })

  it('发送文本引用失败时保留引用草稿', async () => {
    const snapshot = createSnapshot()
    const prompt = vi.fn().mockRejectedValue(new Error('network down'))
    installCodingAgentApi({ prompt })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(snapshot)
    await store.setActiveSessionId('thread-a')
    store.addComposerQuote({
      id: 'quote-a',
      messageId: 'assistant-a',
      text: '引用正文'
    })

    await store.sendPrompt()

    expect(store.errorMessage).toBe('network down')
    expect(store.draftQuotes).toEqual([
      {
        id: 'quote-a',
        messageId: 'assistant-a',
        text: '引用正文'
      }
    ])
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

  it('发送 Composer skill chip 时保留 $skill 引用语义', async () => {
    const snapshot = createSnapshot()
    const prompt = vi.fn().mockResolvedValue(undefined)
    installCodingAgentApi({ prompt })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(snapshot)
    await store.setActiveSessionId('thread-a')
    store.draftMessage = createComposerContentWithSkillReference('请用 ', 'skill:review', ' 检查 ')

    await store.sendPrompt()

    expect(prompt).toHaveBeenCalledWith({
      threadId: 'thread-a',
      message: '请用 $skill:review 检查 @src/App.vue',
      fileArgs: ['src/App.vue'],
      skillReferences: [
        {
          name: 'skill:review',
          path: 'H:\\skills\\review\\SKILL.md',
          baseDir: 'H:\\skills\\review'
        }
      ]
    })
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
    store.addComposerQuote({ id: 'quote-a', messageId: 'assistant-a', text: '引用正文' })

    await store.sendPrompt()

    expect(steer).toHaveBeenCalledWith({
      threadId: 'thread-a',
      message: 'adjust course',
      quoteContexts: [{ messageId: 'assistant-a', text: '引用正文' }]
    })
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
    store.addComposerQuote({ id: 'quote-a', messageId: 'assistant-a', text: '引用正文' })

    await store.sendPrompt(store.defaultSessionContextId, 'followUp')

    expect(followUp).toHaveBeenCalledWith({
      threadId: 'thread-a',
      message: 'after this',
      quoteContexts: [{ messageId: 'assistant-a', text: '引用正文' }]
    })
    expect(steer).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
    expect(store.hasDraftMessage).toBe(false)
  })

  it('按 session 保留运行中消息交付方式', async () => {
    const snapshotA = {
      ...createSnapshot(),
      status: 'running' as const
    }
    const snapshotB = {
      ...createSnapshot(),
      threadId: 'thread-b',
      projectId: 'project-b',
      cwd: '/tmp/project-b',
      status: 'running' as const
    }
    const getSnapshot = vi.fn((threadId: string) =>
      Promise.resolve(threadId === 'thread-b' ? snapshotB : snapshotA)
    )
    installCodingAgentApi({ getSnapshot })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(snapshotA)
    store.sessions['thread-b'] = snapshotToWorkspaceSession(snapshotB)

    await store.setActiveSessionId('thread-a')
    store.runningDelivery = 'followUp'
    await store.setActiveSessionId('thread-b')

    expect(store.runningDelivery).toBe('steer')

    store.runningDelivery = 'steer'
    await store.setActiveSessionId('thread-a')

    expect(store.runningDelivery).toBe('followUp')
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
    store.setActiveSessionPanelOpen(true)
    store.setActiveSessionPanelWidth(560)
    store.draftMessage = createComposerContent('first prompt')

    await store.sendPrompt()

    expect(createThread).toHaveBeenCalledWith({ projectId: 'project-a' })
    expect(setThreadTitle).toHaveBeenCalledWith({ threadId: 'thread-new', title: 'first prompt' })
    expect(prompt).toHaveBeenCalledWith({ threadId: 'thread-new', message: 'first prompt' })
    expect(store.sessions['thread-new']?.title).toBe('first prompt')
    expect(store.activeSessionId).toBe('thread-new')
    expect(store.activeProjectId).toBe('project-a')
    expect(store.hasDraftMessage).toBe(false)
    expect(store.activeSessionPanel).toEqual({ panelOpen: true, panelWidth: 560 })
  })

  it('新 thread 创建后原子转移并清空全部 orphan 草稿状态', async () => {
    const snapshot = {
      ...createSnapshot(),
      threadId: 'thread-new',
      projectId: 'project-a',
      thinkingLevel: 'high' as const
    }
    const createThread = vi.fn().mockResolvedValue(snapshot)
    const prompt = vi.fn().mockRejectedValue(new Error('network down'))
    installCodingAgentApi({ createThread, prompt })
    const store = useWorkspaceSessionStore()
    store.startNewSession('project-a')
    store.draftMessage = createComposerContent('first prompt')
    store.addComposerQuote({ id: 'quote-a', messageId: 'assistant-a', text: '引用正文' })
    store.runningDelivery = 'followUp'
    store.setActiveSessionPanelOpen(true)
    store.setActiveSessionPanelWidth(560)
    await store.setActiveModel('openai', 'gpt-5')
    await store.setActiveThinkingLevel('high')

    await store.sendPrompt()

    expect(createThread).toHaveBeenCalledWith({
      projectId: 'project-a',
      initialModel: { provider: 'openai', modelId: 'gpt-5' },
      thinkingLevel: 'high'
    })
    expect(store.activeSessionId).toBe('thread-new')
    expect(store.getComposerDraft('thread-new')).toEqual(createComposerContent('first prompt'))
    expect(store.getComposerQuotes('thread-new')).toHaveLength(1)
    expect(store.runningDelivery).toBe('followUp')
    expect(store.activeSessionPanel).toEqual({ panelOpen: true, panelWidth: 560 })

    store.startNewSession('project-a')

    expect(store.hasDraftMessage).toBe(false)
    expect(store.draftQuotes).toEqual([])
    expect(store.runningDelivery).toBe('steer')
    expect(store.activeSessionPanel).toEqual({ panelOpen: false, panelWidth: 420 })
    expect(store.orphanModel).toBeUndefined()
    expect(store.orphanThinkingLevel).toBeUndefined()
  })

  it('新会话草稿首次发送 pending 时忽略重复提交', async () => {
    const snapshot = {
      ...createSnapshot(),
      threadId: 'thread-new',
      projectId: 'project-a'
    }
    let resolveCreateThread: ((snapshot: ThreadSnapshot) => void) | undefined
    const createThread = vi.fn(
      () =>
        new Promise<ThreadSnapshot>((resolve) => {
          resolveCreateThread = resolve
        })
    )
    const prompt = vi.fn().mockResolvedValue(undefined)
    const setThreadTitle = vi.fn().mockResolvedValue({
      ...snapshotToWorkspaceSession(snapshot),
      title: 'first prompt'
    })
    installCodingAgentApi({ createThread, prompt, setThreadTitle })
    const store = useWorkspaceSessionStore()
    store.startNewSession('project-a')
    store.draftMessage = createComposerContent('first prompt')

    const firstSubmit = store.sendPrompt()
    const secondSubmit = store.sendPrompt()

    expect(store.isSendingPrompt).toBe(true)
    expect(createThread).toHaveBeenCalledTimes(1)

    resolveCreateThread?.(snapshot)
    await Promise.all([firstSubmit, secondSubmit])

    expect(createThread).toHaveBeenCalledTimes(1)
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(prompt).toHaveBeenCalledWith({ threadId: 'thread-new', message: 'first prompt' })
    expect(store.isSendingPrompt).toBe(false)
    expect(store.hasDraftMessage).toBe(false)
  })

  it('新会话草稿首次发送前把暂存 thinking level 传给初始 thread', async () => {
    const snapshot = {
      ...createSnapshot(),
      threadId: 'thread-new',
      projectId: 'project-a',
      thinkingLevel: 'high' as const
    }
    const createThread = vi.fn().mockResolvedValue(snapshot)
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
    installCodingAgentApi({ createThread, prompt, setThreadTitle })
    const store = useWorkspaceSessionStore()
    store.startNewSession('project-a')
    await store.setActiveThinkingLevel('high')
    store.draftMessage = createComposerContent('first prompt')

    await store.sendPrompt()

    expect(createThread).toHaveBeenCalledWith({ projectId: 'project-a', thinkingLevel: 'high' })
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

  it('允许发送只有图片附件的 Composer 草稿', async () => {
    const snapshot = createSnapshot()
    const prompt = vi.fn().mockResolvedValue(undefined)
    installCodingAgentApi({ prompt })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(snapshot)
    await store.setActiveSessionId('thread-a')
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
      message: '请分析这些图片',
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

  it('允许发送只有文件路径附件的 Composer 草稿', async () => {
    const snapshot = createSnapshot()
    const prompt = vi.fn().mockResolvedValue(undefined)
    installCodingAgentApi({ prompt })
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = snapshotToWorkspaceSession(snapshot)
    await store.setActiveSessionId('thread-a')
    store.addComposerFiles([
      {
        id: 'file-a',
        path: 'E:\\Temp\\只看气温系统需求变更文档_v1.3.docx',
        name: '只看气温系统需求变更文档_v1.3.docx',
        size: 1024
      }
    ])

    await store.sendPrompt()

    expect(prompt).toHaveBeenCalledWith({
      threadId: 'thread-a',
      message: '请处理这些文件',
      fileArgs: ['E:\\Temp\\只看气温系统需求变更文档_v1.3.docx']
    })
    expect(store.draftFiles).toEqual([])
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

  it('同一 message token 批次在一帧内同时提交 snapshot 和 revision', () => {
    const frameCallbacks = new Map<number, FrameRequestCallback>()
    let nextFrameId = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      nextFrameId += 1
      frameCallbacks.set(nextFrameId, callback)
      return nextFrameId
    })
    const cancelAnimationFrame = vi.fn((frameId: number) => {
      frameCallbacks.delete(frameId)
    })
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)
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
      message: createAssistantMessage('hello', fixtureTimestamp),
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'hello',
        partial: createAssistantMessage('hello', fixtureTimestamp)
      }
    })

    expect(frameCallbacks.size).toBe(1)
    const [messageFrameId, messageFrame] = [...frameCallbacks.entries()][0] ?? []
    expect(messageFrame).toBeDefined()
    frameCallbacks.delete(messageFrameId as number)
    messageFrame?.(0)

    const messageId = 'assistant-2026-07-01T00:00:00.000Z'
    expect(store.activeSnapshot?.messages.at(-1)).toMatchObject({ id: messageId, text: 'hello' })
    expect(store.getMessageRenderState('thread-a', messageId)).toEqual({
      revision: 1,
      renderState: 'streaming'
    })
    expect(frameCallbacks.size).toBe(0)
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1)
  })

  it('切换到 live session 刷新 snapshot 时保留流式 assistant 消息', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const persistedUser = {
      id: 'message-0',
      role: 'user' as const,
      text: 'stream a long answer',
      raw: { role: 'user', content: 'stream a long answer' } as never,
      createdAt: '2026-07-01T00:00:00.000Z'
    }
    const getSnapshot = vi.fn().mockResolvedValue({
      ...createSnapshot(),
      // Registry metadata can lag canonical live events during the switch.
      status: 'idle',
      messages: [persistedUser]
    })
    installCodingAgentApi({ getSnapshot })
    const store = useWorkspaceSessionStore()

    capturedEventListener?.({
      type: 'threadSnapshot',
      threadId: 'thread-a',
      snapshot: {
        ...createSnapshot(),
        status: 'running',
        messages: [persistedUser]
      }
    })
    capturedEventListener?.({
      type: 'message_update',
      threadId: 'thread-a',
      message: createAssistantMessage('partial live tokens', fixtureTimestamp + 1),
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'partial live tokens',
        partial: createAssistantMessage('partial live tokens', fixtureTimestamp + 1)
      }
    })

    const streamingMessage = store.sessions['thread-a']?.snapshot?.messages.at(-1)
    expect(streamingMessage).toMatchObject({
      role: 'assistant',
      text: 'partial live tokens'
    })
    expect(store.getMessageRenderState('thread-a', streamingMessage!.id).renderState).toBe(
      'streaming'
    )

    await store.setActiveSessionId('thread-a')

    expect(getSnapshot).toHaveBeenCalledWith('thread-a')
    expect(store.activeSnapshot?.messages).toHaveLength(2)
    expect(store.activeSnapshot?.messages.at(-1)).toBe(streamingMessage)
    expect(store.getMessageRenderState('thread-a', streamingMessage!.id).renderState).toBe(
      'streaming'
    )
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
function createModel(id: string): Model<'openai-responses'> {
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

function createAssistantErrorToolMessage(
  timestamp: number
): Extract<AgentMessage, { role: 'assistant' }> {
  return {
    ...createAssistantMessage('', timestamp),
    content: [
      { type: 'text' as const, text: '准备编辑文件。' },
      {
        type: 'toolCall' as const,
        id: 'tool-edit',
        name: 'edit',
        arguments: { path: 'src/app.ts' }
      }
    ],
    stopReason: 'error' as const,
    errorMessage: 'stream_read_error'
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
 * 创建包含 skillReference 与 fileReference 的 Composer fixture。
 * @param before - skill 前文本。
 * @param skillName - skill command 名称。
 * @param after - skill 与 file chip 之间的文本。
 * @returns Tiptap JSON 内容。
 */
function createComposerContentWithSkillReference(
  before: string,
  skillName: string,
  after: string
): {
  type: 'doc'
  content: Array<{
    type: 'paragraph'
    content: Array<
      | { type: 'text'; text: string }
      | {
          type: 'skillReference'
          attrs: { name: string; label: string; path: string; baseDir: string }
        }
      | { type: 'fileReference'; attrs: { fileArg: string; label: string } }
    >
  }>
} {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: before },
          {
            type: 'skillReference',
            attrs: {
              name: skillName,
              label: skillName,
              path: 'H:\\skills\\review\\SKILL.md',
              baseDir: 'H:\\skills\\review'
            }
          },
          { type: 'text', text: after },
          {
            type: 'fileReference',
            attrs: { fileArg: 'src/App.vue', label: 'src/App.vue' }
          }
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
 * 创建 extension UI requested IPC event fixture。
 * @param threadId - thread ID。
 * @param request - extension UI 请求。
 * @returns IPC event。
 */
function createExtensionUiRequestedEvent(
  threadId: string,
  request: ExtensionUiRequest
): Parameters<Parameters<typeof window.api.codingAgent.onEvent>[0]>[0] {
  return {
    type: 'projection',
    threadId,
    event: {
      type: 'extensionUi.requested',
      threadId,
      request
    }
  }
}

function createExtensionPanelRegisteredEvent(
  threadId: string,
  panel: DesktopExtensionWebviewPanel
): Parameters<Parameters<typeof window.api.codingAgent.onEvent>[0]>[0] {
  return {
    type: 'projection',
    threadId,
    event: {
      type: 'extensionPanel.registered',
      threadId,
      panel
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
  sessionStorage = createMemorySessionStorage(),
  localStorage = createMemorySessionStorage()
): void {
  capturedEventListener = undefined
  vi.stubGlobal('window', {
    localStorage,
    sessionStorage,
    api: {
      codingAgent: {
        listThreads: vi.fn().mockResolvedValue([]),
        archiveThread: vi.fn().mockResolvedValue(undefined),
        restoreThread: vi.fn().mockResolvedValue(undefined),
        createThread: vi.fn(),
        getSnapshot: vi.fn().mockResolvedValue(createSnapshot()),
        saveExtensionPanelState: vi.fn().mockResolvedValue(undefined),
        disposeExtensionPanel: vi.fn().mockResolvedValue(undefined),
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
