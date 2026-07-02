/**
 * 本文件测试 workspace-session 的 IPC event snapshot 投影。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { applyEventToSessions, type WorkspaceSession } from '../workspace-session'
import useWorkspaceProjectStore from '../workspace-project'
import useWorkspaceSessionStore from '../workspace-session'
import type { ThreadSnapshot } from '../../../../shared/coding-agent/types'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('applyEventToSessions', () => {
  it('将 canonical message_update 应用到 snapshot messages', () => {
    const sessions = createSessions()

    applyEventToSessions(sessions, {
      type: 'canonical',
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

    expect(sessions['thread-a']?.snapshot?.messages).toEqual([
      {
        id: 'entry-a',
        role: 'assistant',
        text: 'hello',
        createdAt: '2026-07-01T00:00:00.000Z'
      }
    ])
  })

  it('将缺少稳定 id 的流式 message_update 合并为同一条消息', () => {
    const sessions = createSessions()

    applyEventToSessions(sessions, {
      type: 'canonical',
      threadId: 'thread-a',
      event: {
        type: 'message_update',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '你好。' }]
        }
      }
    })
    applyEventToSessions(sessions, {
      type: 'canonical',
      threadId: 'thread-a',
      event: {
        type: 'message_update',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '你好。你想让我看代码' }]
        }
      }
    })
    applyEventToSessions(sessions, {
      type: 'canonical',
      threadId: 'thread-a',
      event: {
        type: 'message_update',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '你好。你想让我看代码、修 bug' }]
        }
      }
    })

    expect(sessions['thread-a']?.snapshot?.messages).toEqual([
      {
        id: 'message-0',
        role: 'assistant',
        text: '你好。你想让我看代码、修 bug',
        createdAt: undefined
      }
    ])
  })

  it('将 canonical message_end 中的 userMessage 应用到用户消息气泡', () => {
    const sessions = createSessions()

    applyEventToSessions(sessions, {
      type: 'canonical',
      threadId: 'thread-a',
      event: {
        type: 'message_end',
        message: {
          role: 'user',
          content: [{ type: 'text', text: '你好' }]
        }
      }
    })

    expect(sessions['thread-a']?.snapshot?.messages).toEqual([
      {
        id: 'message-0',
        role: 'user',
        text: '你好',
        createdAt: undefined
      }
    ])
  })

  it('根据 canonical turn lifecycle 更新运行状态', () => {
    const sessions = createSessions()

    applyEventToSessions(sessions, {
      type: 'canonical',
      threadId: 'thread-a',
      event: {
        type: 'turn_start'
      }
    })

    expect(sessions['thread-a']?.status).toBe('running')
    expect(sessions['thread-a']?.snapshot?.status).toBe('running')

    applyEventToSessions(sessions, {
      type: 'canonical',
      threadId: 'thread-a',
      event: {
        type: 'turn_end'
      }
    })

    expect(sessions['thread-a']?.status).toBe('idle')
    expect(sessions['thread-a']?.snapshot?.status).toBe('idle')
  })

  it('将 projection event 应用到 snapshot runtime projections', () => {
    const sessions = createSessions()

    applyEventToSessions(sessions, {
      type: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'queue.changed',
        steering: ['interrupt'],
        followUp: ['next']
      }
    })
    applyEventToSessions(sessions, {
      type: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'thinking.changed',
        level: 'high'
      }
    })
    applyEventToSessions(sessions, {
      type: 'projection',
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
    applyEventToSessions(sessions, {
      type: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'tool.call',
        toolCall: {
          toolCallId: 'tool-a',
          toolName: 'edit',
          status: 'running'
        }
      }
    })
    applyEventToSessions(sessions, {
      type: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'file.changed',
        fileChange: {
          path: 'README.md',
          changeType: 'updated'
        }
      }
    })
    applyEventToSessions(sessions, {
      type: 'projection',
      threadId: 'thread-a',
      event: {
        type: 'diagnostic',
        source: 'worker',
        severity: 'warning',
        message: 'heads up'
      }
    })

    const snapshot = sessions['thread-a']?.snapshot
    expect(snapshot?.queue).toEqual({ steering: ['interrupt'], followUp: ['next'] })
    expect(snapshot?.thinkingLevel).toBe('high')
    expect(snapshot?.approvals).toHaveLength(1)
    expect(snapshot?.toolCalls).toMatchObject([{ toolCallId: 'tool-a', status: 'running' }])
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
    await store.createThread('project-a')

    expect(listThreads).toHaveBeenCalledWith()
    expect(createThread).toHaveBeenCalledWith({ projectId: 'project-a' })
    expect(store.activeSessionId).toBe('thread-a')
    expect(store.sessionList.map((session) => session.threadId)).toEqual(['thread-a', 'thread-b'])
    expect(store.sessionsByProject['project-a']?.map((session) => session.threadId)).toEqual([
      'thread-a'
    ])
    expect(store.sessionsByProject['project-b']?.map((session) => session.threadId)).toEqual([
      'thread-b'
    ])
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

  it('收到新 threadSnapshot 事件时回填列表并选中新 thread', () => {
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
      snapshot,
      ui: {
        panelOpen: true,
        panelWidth: 300
      }
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
    snapshot,
    ui: {
      panelOpen: true,
      panelWidth: 300
    }
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
        getSnapshot: vi.fn(),
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
