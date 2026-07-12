/**
 * 本文件测试 Project/Thread metadata registry。
 */

import { mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { ProjectStore, getProjectStatus } from '../project-store'
import { CodingThreadStore } from '../thread-store'
import { ThreadManagerCore } from '../thread-manager-core'
import { CodingThreadManager } from '../thread-manager'
import { buildSessionTreeBranches } from '../session-tree-branches'
import { SessionManager } from '@coding-agent-src/core/session-manager'
import type { ApprovalRequest, ThreadSummary } from '@shared/coding-agent/types'
import type { ModelSettingsService } from '../model-settings-service'
import type { ThreadWorkerRegistry } from '../thread-worker-registry'

/** 创建临时目录。 */
function createTempDir(): string {
  return join(tmpdir(), `meta-agent-desktop-${crypto.randomUUID()}`)
}

/** 创建 Pi-compatible approval request fixture。 */
function approvalRequest(action: string): ApprovalRequest {
  return {
    approvalId: 'approval-a',
    threadId: 'thread-a',
    action,
    risk: 'medium',
    scope: 'once',
    defaultAction: 'deny',
    createdAt: '2026-07-01T00:00:04.000Z'
  }
}

function createModelSettingsService(
  models: Array<{ provider: string; id: string; contextWindow: number }>
): ModelSettingsService {
  return {
    listModelRegistry: async () => ({
      models: models.map((model) => ({ ...model, status: 'available' as const })),
      providers: [],
      refreshedAt: '2026-07-01T00:00:00.000Z'
    })
  } as unknown as ModelSettingsService
}

describe('ProjectStore', () => {
  it('创建、打开 Project，并按路径复用记录', () => {
    const cwd = createTempDir()
    mkdirSync(cwd, { recursive: true })
    const store = new ProjectStore(':memory:')

    const project = store.createProject({ path: cwd })
    expect(project.path).toBe(cwd)
    expect(project.status).toBe('available')
    expect(store.findProjectByPath(cwd)?.projectId).toBe(project.projectId)

    const opened = store.openProject(project.projectId)
    expect(opened.projectId).toBe(project.projectId)
    expect(opened.lastOpenedAt).toBeDefined()

    const duplicate = store.createProject({ path: cwd })
    expect(duplicate.projectId).toBe(project.projectId)

    expect(store.listProjects().map((item) => item.projectId)).toEqual([project.projectId])
    store.close()
    rmSync(cwd, { recursive: true, force: true })
  })

  it('识别 missing 与 invalid Project 状态', () => {
    const cwd = createTempDir()
    const filePath = join(createTempDir(), 'file.txt')
    mkdirSync(join(filePath, '..'), { recursive: true })
    writeFileSync(filePath, 'not a directory')

    expect(getProjectStatus(cwd)).toBe('missing')
    expect(getProjectStatus(filePath)).toBe('invalid')
    rmSync(join(filePath, '..'), { recursive: true, force: true })
  })
})

describe('CodingThreadStore', () => {
  it('保存、过滤和读取 Project-aware thread registry', () => {
    const store = new CodingThreadStore(':memory:')
    const summaryA: ThreadSummary = {
      threadId: 'thread-a',
      projectId: 'project-a',
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    }
    const summaryB: ThreadSummary = {
      threadId: 'thread-b',
      projectId: 'project-b',
      status: 'stopped',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:01.000Z'
    }
    store.saveThread(summaryA)
    store.saveThread(summaryB)

    expect(store.listThreads({ projectId: 'project-a' })).toEqual([summaryA])
    expect(store.listThreads()).toEqual([summaryB, summaryA])
    store.close()
  })

  it('默认隐藏归档 thread，并支持只列出归档 thread', () => {
    const store = new CodingThreadStore(':memory:')
    const visibleThread: ThreadSummary = {
      threadId: 'thread-visible',
      projectId: 'project-a',
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:01.000Z'
    }
    const archivedThread: ThreadSummary = {
      threadId: 'thread-archived',
      projectId: 'project-a',
      status: 'stopped',
      archivedAt: '2026-07-01T00:00:02.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:02.000Z'
    }
    store.saveThread(visibleThread)
    store.saveThread(archivedThread)

    expect(store.listThreads()).toEqual([visibleThread])
    expect(store.listThreads({ projectId: 'project-a' })).toEqual([visibleThread])
    expect(store.listThreads({ archived: true })).toEqual([archivedThread])
    expect(store.listThreads({ projectId: 'project-a', archived: true })).toEqual([archivedThread])
    store.close()
  })

  it('使用轻量 metadata 文件保存和恢复 Project/Thread registry', () => {
    const root = createTempDir()
    const projectFile = join(root, 'projects.json')
    const threadFile = join(root, 'threads.json')
    const cwd = join(root, 'repo')
    mkdirSync(cwd, { recursive: true })

    const projectStore = new ProjectStore(projectFile)
    const threadStore = new CodingThreadStore(threadFile)
    const project = projectStore.createProject({ path: cwd })
    const thread: ThreadSummary = {
      threadId: 'thread-a',
      projectId: project.projectId,
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    }
    threadStore.saveThread(thread)
    projectStore.close()
    threadStore.close()

    const reopenedProjectStore = new ProjectStore(projectFile)
    const reopenedThreadStore = new CodingThreadStore(threadFile)
    expect(reopenedProjectStore.findProjectByPath(cwd)?.projectId).toBe(project.projectId)
    expect(reopenedThreadStore.listThreads()).toEqual([thread])
    reopenedProjectStore.close()
    reopenedThreadStore.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('应用重启后不会把持久化的 transient/error 状态恢复成活跃运行态', async () => {
    const root = createTempDir()
    const projectFile = join(root, 'projects.json')
    const threadFile = join(root, 'threads.json')
    const cwd = join(root, 'repo')
    mkdirSync(cwd, { recursive: true })

    const projectStore = new ProjectStore(projectFile)
    const threadStore = new CodingThreadStore(threadFile)
    const project = projectStore.createProject({ path: cwd })
    threadStore.saveThread({
      threadId: 'thread-running-before-restart',
      projectId: project.projectId,
      status: 'running',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })
    threadStore.saveThread({
      threadId: 'thread-error-before-restart',
      projectId: project.projectId,
      status: 'error',
      createdAt: '2026-07-01T00:00:01.000Z',
      updatedAt: '2026-07-01T00:00:01.000Z'
    })
    projectStore.close()
    threadStore.close()

    const reopenedProjectStore = new ProjectStore(projectFile)
    const reopenedThreadStore = new CodingThreadStore(threadFile)
    const manager = new ThreadManagerCore(
      createIdleThreadWorkerRegistry(),
      reopenedThreadStore,
      reopenedProjectStore
    )
    const snapshot = await manager.getSnapshot('thread-running-before-restart')

    expect(
      manager.listThreads().map((thread) => ({ threadId: thread.threadId, status: thread.status }))
    ).toEqual([
      { threadId: 'thread-error-before-restart', status: 'idle' },
      { threadId: 'thread-running-before-restart', status: 'idle' }
    ])
    expect(
      reopenedThreadStore
        .listThreads()
        .map((thread) => ({ threadId: thread.threadId, status: thread.status }))
    ).toEqual([
      { threadId: 'thread-error-before-restart', status: 'idle' },
      { threadId: 'thread-running-before-restart', status: 'idle' }
    ])
    expect(snapshot.status).toBe('idle')
    reopenedProjectStore.close()
    reopenedThreadStore.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('ThreadManagerCore listThreads 按 updatedAt 降序返回', () => {
    const projectStore = new ProjectStore(':memory:')
    const store = new CodingThreadStore(':memory:')
    const projectA = projectStore.createProject({ path: createTempDir() })
    const projectB = projectStore.createProject({ path: createTempDir() })
    const oldest: ThreadSummary = {
      threadId: 'thread-oldest',
      projectId: projectA.projectId,
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    }
    const newest: ThreadSummary = {
      threadId: 'thread-newest',
      projectId: projectA.projectId,
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:02.000Z'
    }
    const otherProject: ThreadSummary = {
      threadId: 'thread-other-project',
      projectId: projectB.projectId,
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:01.000Z'
    }

    const manager = new ThreadManagerCore(createIdleThreadWorkerRegistry(), store, projectStore)
    manager.saveThread(oldest)
    manager.saveThread(newest)
    manager.saveThread(otherProject)
    manager.updateThread('thread-oldest', { status: 'running' })

    expect(manager.listThreads().map((thread) => thread.threadId)).toEqual([
      'thread-newest',
      'thread-other-project',
      'thread-oldest'
    ])
    expect(
      manager.listThreads({ projectId: projectA.projectId }).map((thread) => thread.threadId)
    ).toEqual(['thread-newest', 'thread-oldest'])
    expect(manager.requireThread('thread-oldest').updatedAt).toBe('2026-07-01T00:00:00.000Z')

    manager.touchThreadActivity('thread-oldest', '2026-07-01T00:00:03.000Z')

    expect(manager.listThreads().map((thread) => thread.threadId)).toEqual([
      'thread-oldest',
      'thread-newest',
      'thread-other-project'
    ])

    store.close()
    projectStore.close()
  })

  it('ThreadManagerCore listThreads 默认过滤归档 thread', () => {
    const projectStore = new ProjectStore(':memory:')
    const store = new CodingThreadStore(':memory:')
    const project = projectStore.createProject({ path: createTempDir() })
    const visibleThread: ThreadSummary = {
      threadId: 'thread-visible',
      projectId: project.projectId,
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:01.000Z'
    }
    const archivedThread: ThreadSummary = {
      threadId: 'thread-archived',
      projectId: project.projectId,
      status: 'stopped',
      archivedAt: '2026-07-01T00:00:02.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:02.000Z'
    }

    const manager = new ThreadManagerCore(createIdleThreadWorkerRegistry(), store, projectStore)
    manager.saveThread(visibleThread)
    manager.saveThread(archivedThread)

    expect(manager.listThreads().map((thread) => thread.threadId)).toEqual(['thread-visible'])
    expect(manager.listThreads({ archived: true }).map((thread) => thread.threadId)).toEqual([
      'thread-archived'
    ])

    store.close()
    projectStore.close()
  })

  it('保存和读取临时 projection 状态', () => {
    const store = new CodingThreadStore(':memory:')

    store.recordToolCall({
      threadId: 'thread-a',
      toolCallId: 'tool-a',
      toolName: 'apply_patch',
      status: 'finished',
      args: { file: 'README.md' },
      resultSummary: 'patched',
      startedAt: '2026-07-01T00:00:01.000Z',
      finishedAt: '2026-07-01T00:00:02.000Z'
    })
    store.recordFileChange({
      threadId: 'thread-a',
      toolCallId: 'tool-a',
      path: 'README.md',
      changeType: 'modify',
      patch: '@@',
      createdAt: '2026-07-01T00:00:03.000Z'
    })
    store.recordApprovalRequest({
      approvalId: 'approval-a',
      threadId: 'thread-a',
      status: 'pending',
      request: approvalRequest('shell'),
      createdAt: '2026-07-01T00:00:04.000Z'
    })
    store.resolveApproval(
      'approval-a',
      { approvalId: 'approval-a', allow: true, scope: 'once' },
      'approved'
    )
    store.recordWorkerRun({
      workerId: 'worker-a',
      threadId: 'thread-a',
      status: 'running',
      pidHash: 'pid-hash',
      startedAt: '2026-07-01T00:00:05.000Z'
    })
    store.finishWorkerRun({
      workerId: 'worker-a',
      startedAt: '2026-07-01T00:00:05.000Z',
      status: 'exited',
      exitCode: 0,
      exitedAt: '2026-07-01T00:00:06.000Z'
    })
    const diagnostic = store.recordDiagnostic({
      threadId: 'thread-a',
      source: 'worker',
      severity: 'error',
      message: 'worker crashed',
      details: { code: 'boom' },
      createdAt: '2026-07-01T00:00:07.000Z'
    })

    expect(store.listToolCalls('thread-a')).toEqual([
      {
        threadId: 'thread-a',
        toolCallId: 'tool-a',
        toolName: 'apply_patch',
        status: 'finished',
        args: { file: 'README.md' },
        resultSummary: 'patched',
        startedAt: '2026-07-01T00:00:01.000Z',
        finishedAt: '2026-07-01T00:00:02.000Z'
      }
    ])
    expect(store.listFileChanges('thread-a')).toEqual([
      {
        threadId: 'thread-a',
        toolCallId: 'tool-a',
        path: 'README.md',
        changeType: 'modify',
        patch: '@@',
        createdAt: '2026-07-01T00:00:03.000Z'
      }
    ])
    expect(store.listApprovals({ threadId: 'thread-a' })).toMatchObject([
      {
        approvalId: 'approval-a',
        threadId: 'thread-a',
        status: 'approved',
        request: approvalRequest('shell'),
        response: { approvalId: 'approval-a', allow: true, scope: 'once' }
      }
    ])
    expect(store.listWorkerRuns({ threadId: 'thread-a' })).toMatchObject([
      {
        workerId: 'worker-a',
        threadId: 'thread-a',
        status: 'exited',
        pidHash: 'pid-hash',
        exitCode: 0
      }
    ])
    expect(store.listDiagnostics({ threadId: 'thread-a' })).toEqual([diagnostic])
    store.close()
  })

  it('不会从 projection cache 回填 durable snapshot 状态', async () => {
    const projectStore = new ProjectStore(':memory:')
    const store = new CodingThreadStore(':memory:')
    const cwd = createTempDir()
    mkdirSync(cwd, { recursive: true })
    const project = projectStore.createProject({ path: cwd })
    const thread: ThreadSummary = {
      threadId: 'thread-a',
      projectId: project.projectId,
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    }
    store.saveThread(thread)
    store.recordToolCall({
      threadId: 'thread-a',
      toolCallId: 'tool-a',
      toolName: 'read_file',
      status: 'finished',
      startedAt: '2026-07-01T00:00:01.000Z'
    })
    store.recordFileChange({
      threadId: 'thread-a',
      path: 'src/index.ts',
      changeType: 'modify',
      createdAt: '2026-07-01T00:00:02.000Z'
    })
    store.recordApprovalRequest({
      approvalId: 'approval-a',
      threadId: 'thread-a',
      status: 'pending',
      request: approvalRequest('edit'),
      createdAt: '2026-07-01T00:00:03.000Z'
    })
    store.recordDiagnostic({
      id: 'diagnostic-a',
      threadId: 'thread-a',
      source: 'store',
      severity: 'warning',
      message: 'indexed warning',
      createdAt: '2026-07-01T00:00:04.000Z'
    })

    const manager = new ThreadManagerCore(createIdleThreadWorkerRegistry(), store, projectStore)
    const snapshot = await manager.getSnapshot('thread-a')

    expect(snapshot.cwd).toBe(cwd)
    expect(snapshot.messages).toEqual([])
    expect(snapshot.toolCalls).toEqual([])
    expect(snapshot.fileChanges).toEqual([])
    expect(snapshot.approvals).toEqual([])
    expect(snapshot.diagnostics).toEqual([])
    store.close()
    projectStore.close()
    rmSync(cwd, { recursive: true, force: true })
  })

  it('metadata 写入或诊断记录失败时不阻塞内存 registry 与最小 snapshot', async () => {
    const cwd = createTempDir()
    mkdirSync(cwd, { recursive: true })
    const projectStore = new ProjectStore(':memory:')
    const project = projectStore.createProject({ path: cwd })
    const thread: ThreadSummary = {
      threadId: 'thread-a',
      projectId: project.projectId,
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    }
    const brokenStore = {
      listThreads: () => [],
      saveThread: () => {
        throw new Error('metadata write failed')
      },
      recordDiagnostic: () => undefined
    }
    const manager = new ThreadManagerCore(
      createIdleThreadWorkerRegistry(),
      brokenStore as unknown as CodingThreadStore,
      projectStore
    )

    manager.saveThread(thread)
    const snapshot = await manager.getSnapshot('thread-a')

    expect(manager.listThreads()).toEqual([thread])
    expect(snapshot).toMatchObject({
      threadId: 'thread-a',
      projectId: project.projectId,
      cwd,
      messages: []
    })
    projectStore.close()
    rmSync(cwd, { recursive: true, force: true })
  })

  it('running worker snapshot 使用 Pi live cwd 与 messages', async () => {
    const root = createTempDir()
    const projectCwd = join(root, 'project')
    const runtimeCwd = join(root, 'session-cwd')
    mkdirSync(projectCwd, { recursive: true })
    mkdirSync(runtimeCwd, { recursive: true })
    const projectStore = new ProjectStore(':memory:')
    const store = new CodingThreadStore(':memory:')
    const project = projectStore.createProject({ path: projectCwd })
    const thread: ThreadSummary = {
      threadId: 'thread-live',
      projectId: project.projectId,
      status: 'running',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    }
    store.saveThread(thread)
    const manager = new ThreadManagerCore(
      createLiveThreadWorkerRegistry(runtimeCwd),
      store,
      projectStore
    )
    const snapshot = await manager.getSnapshot('thread-live')

    expect(snapshot.cwd).toBe(runtimeCwd)
    expect(snapshot.status).toBe('idle')
    expect(snapshot.autoRetryEnabled).toBe(false)
    expect(snapshot.queue).toEqual({ steering: ['redirect'], followUp: ['verify'] })
    expect(snapshot.approvals).toEqual([
      expect.objectContaining({ approvalId: 'approval-live', threadId: 'thread-live' })
    ])
    expect(store.listThreads({ projectId: project.projectId })[0]?.status).toBe('idle')
    expect(
      snapshot.messages.map((message) => ({ role: message.role, text: message.text }))
    ).toEqual([
      { role: 'user', text: 'live user' },
      { role: 'assistant', text: 'live assistant' }
    ])
    store.close()
    projectStore.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('running worker snapshot 使用 live currentEntryId 重建当前 branch timeline', async () => {
    const root = createTempDir()
    const cwd = join(root, 'repo')
    const sessionDir = join(root, 'sessions')
    mkdirSync(cwd, { recursive: true })
    const sessionManager = SessionManager.create(cwd, sessionDir)
    sessionManager.appendMessage({ role: 'user', content: 'first', timestamp: 1 })
    const targetEntryId = sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'target' }],
      api: 'openai-responses',
      provider: 'openai',
      model: 'gpt-test',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'stop',
      timestamp: 2
    })
    sessionManager.appendMessage({ role: 'user', content: 'after target', timestamp: 3 })
    const sessionFile = sessionManager.getSessionFile()
    if (!sessionFile) {
      throw new Error('session file is required')
    }
    const projectStore = new ProjectStore(':memory:')
    const store = new CodingThreadStore(':memory:')
    const project = projectStore.createProject({ path: cwd })
    store.saveThread({
      threadId: 'thread-live-current-entry',
      projectId: project.projectId,
      sessionFile,
      status: 'running',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })
    const manager = new ThreadManagerCore(
      createLiveSessionStateRegistry('thread-live-current-entry', sessionFile, cwd, targetEntryId),
      store,
      projectStore
    )

    const snapshot = await manager.getSnapshot('thread-live-current-entry')

    expect(snapshot.currentEntryId).toBe(targetEntryId)
    expect(
      snapshot.messages.map((message) => ({ role: message.role, text: message.text }))
    ).toEqual([
      { role: 'user', text: 'first' },
      { role: 'assistant', text: 'target' }
    ])
    store.close()
    projectStore.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('running worker 返回空 messages 时从 sessionFile 保留历史消息', async () => {
    const root = createTempDir()
    const cwd = join(root, 'repo')
    const sessionDir = join(root, 'sessions')
    mkdirSync(cwd, { recursive: true })
    const sessionManager = SessionManager.create(cwd, sessionDir)
    sessionManager.appendMessage({ role: 'user', content: 'history user', timestamp: 1 })
    sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'history assistant' }],
      api: 'openai-responses',
      provider: 'openai',
      model: 'gpt-test',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'stop',
      timestamp: 2
    })
    const sessionFile = sessionManager.getSessionFile()
    if (!sessionFile) {
      throw new Error('session file is required')
    }
    const projectStore = new ProjectStore(':memory:')
    const store = new CodingThreadStore(':memory:')
    const project = projectStore.createProject({ path: cwd })
    store.saveThread({
      threadId: 'thread-live-empty',
      projectId: project.projectId,
      sessionFile,
      status: 'running',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })
    const manager = new ThreadManagerCore(
      createEmptyLiveProjectionRegistry('thread-live-empty', cwd),
      store,
      projectStore
    )

    const snapshot = await manager.getSnapshot('thread-live-empty')

    expect(snapshot.status).toBe('idle')
    expect(
      snapshot.messages.map((message) => ({ role: message.role, text: message.text }))
    ).toEqual([
      { role: 'user', text: 'history user' },
      { role: 'assistant', text: 'history assistant' }
    ])
    store.close()
    projectStore.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('compact 进行中 running worker snapshot 保留 JSONL 完整 timeline', async () => {
    const root = createTempDir()
    const cwd = join(root, 'repo')
    const sessionDir = join(root, 'sessions')
    mkdirSync(cwd, { recursive: true })
    const sessionManager = SessionManager.create(cwd, sessionDir)
    const firstMessageId = sessionManager.appendMessage({
      role: 'user',
      content: 'history user',
      timestamp: 1
    })
    sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'history assistant' }],
      api: 'openai-responses',
      provider: 'openai',
      model: 'gpt-test',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'stop',
      timestamp: 2
    })
    sessionManager.appendCompaction('compressed summary', firstMessageId, 120000)
    const sessionFile = sessionManager.getSessionFile()
    if (!sessionFile) {
      throw new Error('session file is required')
    }
    const projectStore = new ProjectStore(':memory:')
    const store = new CodingThreadStore(':memory:')
    const project = projectStore.createProject({ path: cwd })
    store.saveThread({
      threadId: 'thread-live-compacted',
      projectId: project.projectId,
      sessionFile,
      status: 'running',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })
    const manager = new ThreadManagerCore(
      createCompactedLiveProjectionRegistry('thread-live-compacted', sessionFile, cwd),
      store,
      projectStore
    )

    const snapshot = await manager.getSnapshot('thread-live-compacted')

    expect(
      snapshot.messages.map((message) => ({ role: message.role, text: message.text }))
    ).toEqual([
      { role: 'user', text: 'history user' },
      { role: 'assistant', text: 'history assistant' },
      { role: 'system', text: 'compressed summary' }
    ])
    store.close()
    projectStore.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('缺少 metadata snapshot 时从 canonical JSONL session 重建最小 snapshot', async () => {
    const projectStore = new ProjectStore(':memory:')
    const store = new CodingThreadStore(':memory:')
    const root = createTempDir()
    const cwd = join(root, 'repo')
    const sessionDir = join(root, 'sessions')
    mkdirSync(cwd, { recursive: true })
    const sessionManager = SessionManager.create(cwd, sessionDir)
    sessionManager.appendMessage({ role: 'user', content: 'hello', timestamp: 1 })
    sessionManager.appendMessage({
      role: 'assistant',
      content: [
        { type: 'text', text: 'world' },
        { type: 'toolCall', id: 'tool-read', name: 'read', arguments: { path: 'README.md' } }
      ],
      api: 'openai-responses',
      provider: 'openai',
      model: 'gpt-test',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'stop',
      timestamp: 2
    })
    sessionManager.appendMessage({
      role: 'toolResult',
      toolCallId: 'tool-read',
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
      timestamp: 3
    } as Parameters<typeof sessionManager.appendMessage>[0])
    sessionManager.appendThinkingLevelChange('high')
    sessionManager.appendSessionInfo('JSONL session')
    const sessionFile = sessionManager.getSessionFile()
    if (!sessionFile) {
      throw new Error('session file is required')
    }
    const project = projectStore.createProject({ path: cwd })
    const thread: ThreadSummary = {
      threadId: 'thread-jsonl',
      projectId: project.projectId,
      sessionFile,
      status: 'stopped',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    }
    store.saveThread(thread)

    const manager = new ThreadManagerCore(createIdleThreadWorkerRegistry(), store, projectStore)
    const snapshot = await manager.getSnapshot('thread-jsonl')

    expect(snapshot).toMatchObject({
      threadId: 'thread-jsonl',
      projectId: project.projectId,
      cwd,
      sessionFile,
      title: 'JSONL session',
      thinkingLevel: 'high'
    })
    expect(
      snapshot.messages.map((message) => ({ role: message.role, text: message.text }))
    ).toEqual([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'world' }
    ])
    expect(snapshot.messages.some((message) => message.role === 'tool')).toBe(false)
    expect(snapshot.messages[1]?.toolCallIds).toEqual(['tool-read'])
    expect(snapshot.toolCalls).toMatchObject([
      {
        toolCallId: 'tool-read',
        toolName: 'read',
        status: 'succeeded',
        args: { path: 'README.md' },
        resultSummary: 'ok'
      }
    ])
    expect(snapshot.toolCalls.some((toolCall) => toolCall.toolName === 'tool')).toBe(false)
    store.close()
    projectStore.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('inactive JSONL snapshot 从模型 registry 重建 context usage', async () => {
    const projectStore = new ProjectStore(':memory:')
    const store = new CodingThreadStore(':memory:')
    const root = createTempDir()
    const cwd = join(root, 'repo')
    const sessionDir = join(root, 'sessions')
    mkdirSync(cwd, { recursive: true })
    const sessionManager = SessionManager.create(cwd, sessionDir)
    sessionManager.appendMessage({ role: 'user', content: 'hello', timestamp: 1 })
    sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'world' }],
      api: 'openai-responses',
      provider: 'custom-provider',
      model: 'custom-model',
      usage: {
        input: 120000,
        output: 3000,
        cacheRead: 77000,
        cacheWrite: 0,
        totalTokens: 200000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'stop',
      timestamp: 2
    })
    const sessionFile = sessionManager.getSessionFile()
    if (!sessionFile) {
      throw new Error('session file is required')
    }
    const project = projectStore.createProject({ path: cwd })
    store.saveThread({
      threadId: 'thread-jsonl-context',
      projectId: project.projectId,
      sessionFile,
      status: 'stopped',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })

    const manager = new ThreadManagerCore(
      createIdleThreadWorkerRegistry(),
      store,
      projectStore,
      undefined,
      createModelSettingsService([
        { provider: 'custom-provider', id: 'custom-model', contextWindow: 256000 }
      ])
    )
    const snapshot = await manager.getSnapshot('thread-jsonl-context')

    expect(snapshot.model).toEqual({ provider: 'custom-provider', id: 'custom-model' })
    expect(snapshot.context).toEqual({ tokens: 200000, contextWindow: 256000, percent: 78 })
    store.close()
    projectStore.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('inactive compacted JSONL snapshot 在新 usage 前只保留 context window', async () => {
    const projectStore = new ProjectStore(':memory:')
    const store = new CodingThreadStore(':memory:')
    const root = createTempDir()
    const cwd = join(root, 'repo')
    const sessionDir = join(root, 'sessions')
    mkdirSync(cwd, { recursive: true })
    const sessionManager = SessionManager.create(cwd, sessionDir)
    const firstMessageId = sessionManager.appendMessage({
      role: 'user',
      content: 'hello',
      timestamp: 1
    })
    sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'world' }],
      api: 'openai-responses',
      provider: 'custom-provider',
      model: 'custom-model',
      usage: {
        input: 250000,
        output: 1000,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 251000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'stop',
      timestamp: 2
    })
    sessionManager.appendCompaction('compressed summary', firstMessageId, 251000)
    const sessionFile = sessionManager.getSessionFile()
    if (!sessionFile) {
      throw new Error('session file is required')
    }
    const project = projectStore.createProject({ path: cwd })
    store.saveThread({
      threadId: 'thread-jsonl-compacted-context',
      projectId: project.projectId,
      sessionFile,
      status: 'stopped',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })

    const manager = new ThreadManagerCore(
      createIdleThreadWorkerRegistry(),
      store,
      projectStore,
      undefined,
      createModelSettingsService([
        { provider: 'custom-provider', id: 'custom-model', contextWindow: 256000 }
      ])
    )
    const snapshot = await manager.getSnapshot('thread-jsonl-compacted-context')

    expect(snapshot.context).toEqual({ contextWindow: 256000 })
    store.close()
    projectStore.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('JSONL session header cwd 优先于 Project metadata cwd', async () => {
    const projectStore = new ProjectStore(':memory:')
    const store = new CodingThreadStore(':memory:')
    const root = createTempDir()
    const projectCwd = join(root, 'project')
    const sessionCwd = join(root, 'session-cwd')
    mkdirSync(projectCwd, { recursive: true })
    mkdirSync(sessionCwd, { recursive: true })
    const sessionManager = SessionManager.create(sessionCwd, join(root, 'sessions'))
    sessionManager.appendMessage({ role: 'user', content: 'from header cwd', timestamp: 1 })
    sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'assistant' }],
      api: 'openai-responses',
      provider: 'openai',
      model: 'gpt-test',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'stop',
      timestamp: 2
    })
    const sessionFile = sessionManager.getSessionFile()
    if (!sessionFile) {
      throw new Error('session file is required')
    }
    const project = projectStore.createProject({ path: projectCwd })
    store.saveThread({
      threadId: 'thread-header-cwd',
      projectId: project.projectId,
      sessionFile,
      status: 'stopped',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })

    const manager = new ThreadManagerCore(createIdleThreadWorkerRegistry(), store, projectStore)
    const snapshot = await manager.getSnapshot('thread-header-cwd')

    expect(snapshot.cwd).toBe(sessionCwd)
    store.close()
    projectStore.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('session lifecycle 后用 Pi runtime sessionFile 回写 thread metadata', async () => {
    const projectStore = new ProjectStore(':memory:')
    const store = new CodingThreadStore(':memory:')
    const root = createTempDir()
    const cwd = join(root, 'repo')
    mkdirSync(cwd, { recursive: true })
    const project = projectStore.createProject({ path: cwd })
    const oldSessionFile = join(root, 'old.jsonl')
    const newSessionFile = join(root, 'new.jsonl')
    store.saveThread({
      threadId: 'thread-sync-session',
      projectId: project.projectId,
      sessionFile: oldSessionFile,
      title: 'Old title',
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })
    const manager = new CodingThreadManager(
      createSessionSwitchRegistry(newSessionFile),
      store,
      projectStore
    )

    const snapshot = await manager.switchSession({
      threadId: 'thread-sync-session',
      sessionPath: newSessionFile
    })

    expect(snapshot.sessionFile).toBe(newSessionFile)
    expect(snapshot.title).toBe('New title')
    expect(manager.listThreads()[0]).toMatchObject({
      sessionFile: newSessionFile,
      title: 'New title'
    })
    expect(store.listThreads()[0]).toMatchObject({
      sessionFile: newSessionFile,
      title: 'New title'
    })
    store.close()
    projectStore.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('从 entry 分支时创建新的 thread 并保留源 thread sessionFile', async () => {
    const projectStore = new ProjectStore(':memory:')
    const store = new CodingThreadStore(':memory:')
    const root = createTempDir()
    const cwd = join(root, 'repo')
    mkdirSync(cwd, { recursive: true })
    const project = projectStore.createProject({ path: cwd })
    const sourceSessionFile = join(root, 'source.jsonl')
    const forkSessionFile = join(root, 'fork.jsonl')
    writeFileSync(
      sourceSessionFile,
      `${JSON.stringify({ type: 'session', id: 'source-session', timestamp: '2026-07-01T00:00:00.000Z', cwd })}\n`
    )
    writeFileSync(
      forkSessionFile,
      `${JSON.stringify({ type: 'session', id: 'fork-session', timestamp: '2026-07-01T00:00:01.000Z', cwd, parentSession: sourceSessionFile })}\n`
    )
    store.saveThread({
      threadId: 'thread-source',
      projectId: project.projectId,
      sessionFile: sourceSessionFile,
      title: 'Source',
      status: 'idle',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })
    const registry = createForkThreadRegistry(forkSessionFile, cwd)
    const manager = new CodingThreadManager(registry, store, projectStore)

    const result = await manager.forkThread({
      threadId: 'thread-source',
      entryId: 'entry-a',
      position: 'at'
    })

    expect(result.cancelled).toBe(false)
    expect(result.snapshot?.threadId).not.toBe('thread-source')
    expect(result.snapshot).toMatchObject({
      projectId: project.projectId,
      sessionFile: forkSessionFile,
      title: 'Source · 分支',
      lineage: {
        parentSessionFile: sourceSessionFile,
        parentThreadId: 'thread-source',
        parentThreadTitle: 'Source'
      }
    })
    expect(registry.commands).toContainEqual({
      threadId: 'thread-source',
      type: 'create_fork_session',
      entryId: 'entry-a',
      position: 'at'
    })
    expect(registry.acquires[0]).toMatchObject({
      sessionFile: forkSessionFile,
      title: 'Source · 分支'
    })
    expect(manager.requireThread('thread-source')).toMatchObject({
      sessionFile: sourceSessionFile,
      title: 'Source'
    })
    const projectThreads = manager.listThreads({ projectId: project.projectId })
    expect(projectThreads.map((thread) => thread.sessionFile)).toEqual(
      expect.arrayContaining([sourceSessionFile, forkSessionFile])
    )
    expect(
      projectThreads.find((thread) => thread.sessionFile === forkSessionFile)?.lineage
    ).toMatchObject({
      parentSessionFile: sourceSessionFile,
      parentThreadId: 'thread-source',
      parentThreadTitle: 'Source'
    })
    expect(
      store.listThreads().find((thread) => thread.sessionFile === forkSessionFile)?.lineage
    ).toBeUndefined()
    store.close()
    projectStore.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('desktop metadata 删除后可重建 registry 并从 JSONL session 恢复最小 snapshot', async () => {
    const root = createTempDir()
    const cwd = join(root, 'repo')
    const projectFile = join(root, 'projects.json')
    const threadFile = join(root, 'threads.json')
    mkdirSync(cwd, { recursive: true })
    const sessionManager = SessionManager.create(cwd, root, { id: 'session' })
    sessionManager.appendMessage({ role: 'user', content: 'restore me', timestamp: 1 })
    sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'restored assistant' }],
      api: 'openai-responses',
      provider: 'openai',
      model: 'gpt-test',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'stop',
      timestamp: 2
    })
    sessionManager.appendSessionInfo('Restored session')
    const sessionFile = sessionManager.getSessionFile()
    if (!sessionFile) {
      throw new Error('session file is required')
    }

    const oldProjectStore = new ProjectStore(projectFile)
    const oldThreadStore = new CodingThreadStore(threadFile)
    const oldProject = oldProjectStore.createProject({ path: cwd })
    oldThreadStore.saveThread({
      threadId: 'old-thread',
      projectId: oldProject.projectId,
      sessionFile,
      status: 'stopped',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })
    oldProjectStore.close()
    oldThreadStore.close()
    unlinkSync(projectFile)
    unlinkSync(threadFile)

    const projectStore = new ProjectStore(projectFile)
    const store = new CodingThreadStore(threadFile)
    const project = projectStore.createProject({ path: cwd })
    const thread: ThreadSummary = {
      threadId: 'rebuilt-thread',
      projectId: project.projectId,
      sessionFile,
      status: 'stopped',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    }
    store.saveThread(thread)

    const manager = new ThreadManagerCore(createIdleThreadWorkerRegistry(), store, projectStore)
    const snapshot = await manager.getSnapshot('rebuilt-thread')

    expect(snapshot).toMatchObject({
      threadId: 'rebuilt-thread',
      projectId: project.projectId,
      cwd,
      sessionFile,
      title: 'Restored session'
    })
    expect(
      snapshot.messages.map((message) => ({ role: message.role, text: message.text }))
    ).toEqual([
      { role: 'user', text: 'restore me' },
      { role: 'assistant', text: 'restored assistant' }
    ])
    store.close()
    projectStore.close()
    rmSync(root, { recursive: true, force: true })
  })
})

describe('loadSessionTreeBranches', () => {
  it('优先使用 live currentEntryId 标记当前 branch row', async () => {
    const root = createTempDir()
    const cwd = join(root, 'repo')
    const sessionDir = join(root, 'sessions')
    mkdirSync(cwd, { recursive: true })
    const projectStore = new ProjectStore(':memory:')
    const threadStore = new CodingThreadStore(':memory:')
    const project = projectStore.createProject({ path: cwd })
    const piSession = SessionManager.create(cwd, sessionDir)
    const liveCurrentEntryId = piSession.appendMessage({
      role: 'user',
      content: 'live current',
      timestamp: 1
    })
    piSession.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'persisted middle' }],
      api: 'openai-responses',
      provider: 'openai',
      model: 'gpt-test',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: 'stop',
      timestamp: 2
    })
    const persistedLeafEntryId = piSession.appendMessage({
      role: 'user',
      content: 'persisted leaf',
      timestamp: 3
    })
    const sessionFile = piSession.getSessionFile()
    if (!sessionFile) {
      throw new Error('session file is required')
    }
    threadStore.saveThread({
      threadId: 'thread-live-branches',
      projectId: project.projectId,
      sessionFile,
      status: 'idle',
      title: 'Live branches',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })
    const manager = new CodingThreadManager(
      createLiveSessionStateRegistry('thread-live-branches', sessionFile, cwd, liveCurrentEntryId),
      threadStore,
      projectStore
    )

    const result = await manager.loadSessionTreeBranches({
      threadId: 'thread-live-branches'
    })
    const entryRows = result.rows.filter((row) => row.kind === 'entry')

    expect(result.currentEntryId).toBe(liveCurrentEntryId)
    expect(entryRows.find((row) => row.entryId === liveCurrentEntryId)).toMatchObject({
      current: true
    })
    expect(entryRows.find((row) => row.entryId === persistedLeafEntryId)).toMatchObject({
      current: false
    })

    threadStore.close()
    projectStore.close()
    rmSync(root, { recursive: true, force: true })
  })
})

describe('buildSessionTreeBranches', () => {
  it('在 main 进程把完整 session tree 转为可过滤的 entry rows', async () => {
    const root = createTempDir()
    const cwd = join(root, 'repo')
    const sessionDir = join(root, 'sessions')
    mkdirSync(cwd, { recursive: true })
    const manager = SessionManager.create(cwd, sessionDir)
    const firstUserId = manager.appendMessage({ role: 'user', content: 'start', timestamp: 1 })
    const appendAssistant = (content: string, timestamp: number): string =>
      manager.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text: content }],
        api: 'openai-responses',
        provider: 'openai',
        model: 'gpt-test',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'stop',
        timestamp
      })
    const firstAssistantId = appendAssistant('answer', 2)
    let linearLeafId = firstAssistantId
    for (let index = 0; index < 6; index += 1) {
      linearLeafId =
        index % 2 === 0
          ? manager.appendMessage({
              role: 'user',
              content: `linear ${index}`,
              timestamp: 3 + index
            })
          : appendAssistant(`linear ${index}`, 3 + index)
    }
    manager.appendLabelChange(firstAssistantId, 'Decision point')
    manager.branch(firstAssistantId)
    const branchLeafId = manager.appendMessage({ role: 'user', content: 'branch', timestamp: 10 })
    const sessionFile = manager.getSessionFile()
    if (!sessionFile) {
      throw new Error('session file is required')
    }

    const result = await buildSessionTreeBranches(sessionFile)
    const entryRows = result.rows

    expect(result.totalEntries).toBeGreaterThan(8)
    expect(result.rows).toHaveLength(result.visibleEntries)
    expect(result.rows.every((row) => row.kind === 'entry')).toBe(true)
    expect(linearLeafId).toBeTruthy()
    expect(entryRows.map((row) => row.entryId)).toEqual(
      expect.arrayContaining([firstUserId, firstAssistantId, branchLeafId])
    )
    expect(entryRows.filter((row) => row.leaf).length).toBeGreaterThanOrEqual(2)
    expect(entryRows.find((row) => row.entryId === firstAssistantId)).toMatchObject({
      label: 'Decision point',
      branchPoint: true
    })
    expect(entryRows.find((row) => row.entryId === branchLeafId)).toMatchObject({
      current: true,
      leaf: true
    })
    expect(entryRows.find((row) => row.current)?.visualDepth).toBeLessThanOrEqual(2)

    const entriesResult = await buildSessionTreeBranches(sessionFile, {
      filter: 'all'
    })
    expect(entriesResult.rows.every((row) => row.kind === 'entry')).toBe(true)
    expect(entriesResult.rows).toHaveLength(entriesResult.visibleEntries)
    expect(entriesResult.visibleEntries).toBe(entriesResult.totalEntries)
    expect(Math.max(...entriesResult.rows.map((row) => row.visualDepth))).toBeLessThanOrEqual(1)

    const searchResult = await buildSessionTreeBranches(sessionFile, { query: 'linear 4' })
    expect(searchResult.rows).toEqual([
      expect.objectContaining({
        kind: 'entry',
        summary: expect.stringContaining('linear 4')
      })
    ])

    rmSync(root, { recursive: true, force: true })
  })
})

/** 创建无活跃 worker 的 registry stub。 */
function createIdleThreadWorkerRegistry(): ThreadWorkerRegistry {
  return {
    listLeases: () => []
  } as unknown as ThreadWorkerRegistry
}

/** 创建有活跃 worker 的 registry stub。 */
function createLiveThreadWorkerRegistry(cwd = '/tmp/live-cwd'): ThreadWorkerRegistry {
  return {
    listLeases: () => [{ threadId: 'thread-live' }],
    send: async (_threadId: string, command: { type: string }) => {
      if (command.type === 'get_state') {
        return {
          success: true,
          data: {
            cwd,
            sessionName: 'Live session',
            thinkingLevel: 'medium',
            isStreaming: false,
            isCompacting: false,
            autoRetryEnabled: false,
            queue: { steering: ['redirect'], followUp: ['verify'] },
            approvals: [
              {
                approvalId: 'approval-live',
                threadId: 'thread-live',
                action: 'edit',
                risk: 'high',
                scope: 'once',
                defaultAction: 'deny',
                createdAt: '2026-07-10T00:00:00.000Z'
              }
            ]
          }
        }
      }
      if (command.type === 'get_messages') {
        return {
          success: true,
          data: {
            messages: [
              { role: 'user', content: [{ type: 'text', text: 'live user' }] },
              { role: 'assistant', content: [{ type: 'text', text: 'live assistant' }] }
            ]
          }
        }
      }
      return {
        success: false,
        command: command.type,
        error: { code: 'invalid_command', message: command.type, recoverable: true }
      }
    }
  } as unknown as ThreadWorkerRegistry
}

/** 创建 live worker 存在但消息投影为空的 registry stub。 */
function createLiveSessionStateRegistry(
  threadId: string,
  sessionFile: string,
  cwd: string,
  currentEntryId: string | null
): ThreadWorkerRegistry {
  return {
    listLeases: () => [{ threadId }],
    send: async (_threadId: string, command: { type: string }) => {
      if (command.type === 'get_state') {
        return {
          success: true,
          data: {
            sessionFile,
            currentEntryId,
            cwd,
            thinkingLevel: 'medium',
            isStreaming: false,
            isCompacting: false
          }
        }
      }
      if (command.type === 'get_messages') {
        return {
          success: true,
          data: {
            messages: []
          }
        }
      }
      return {
        success: false,
        command: command.type,
        error: { code: 'invalid_command', message: command.type, recoverable: true }
      }
    }
  } as unknown as ThreadWorkerRegistry
}

function createEmptyLiveProjectionRegistry(threadId: string, cwd: string): ThreadWorkerRegistry {
  return {
    listLeases: () => [{ threadId }],
    send: async (_threadId: string, command: { type: string }) => {
      if (command.type === 'get_state') {
        return {
          success: true,
          data: {
            cwd,
            thinkingLevel: 'medium',
            isStreaming: false,
            isCompacting: false
          }
        }
      }
      if (command.type === 'get_messages') {
        return {
          success: true,
          data: {
            messages: []
          }
        }
      }
      return {
        success: false,
        command: command.type,
        error: { code: 'invalid_command', message: command.type, recoverable: true }
      }
    }
  } as unknown as ThreadWorkerRegistry
}

function createCompactedLiveProjectionRegistry(
  threadId: string,
  sessionFile: string,
  cwd: string
): ThreadWorkerRegistry {
  return {
    listLeases: () => [{ threadId }],
    send: async (_threadId: string, command: { type: string }) => {
      if (command.type === 'get_state') {
        return {
          success: true,
          data: {
            sessionFile,
            cwd,
            thinkingLevel: 'medium',
            isStreaming: false,
            isCompacting: true
          }
        }
      }
      if (command.type === 'get_messages') {
        return {
          success: true,
          data: {
            messages: [
              {
                role: 'compactionSummary',
                summary: 'compressed summary',
                tokensBefore: 120000,
                timestamp: 3
              }
            ]
          }
        }
      }
      return {
        success: false,
        command: command.type,
        error: { code: 'invalid_command', message: command.type, recoverable: true }
      }
    }
  } as unknown as ThreadWorkerRegistry
}

/** 创建分支 thread registry stub。 */
function createForkThreadRegistry(
  forkSessionFile: string,
  cwd: string
): ThreadWorkerRegistry & {
  commands: Array<Record<string, unknown>>
  acquires: Array<Record<string, unknown>>
} {
  const commands: Array<Record<string, unknown>> = []
  const acquires: Array<Record<string, unknown>> = []
  const sessionFilesByThreadId = new Map<string, string | undefined>()
  return {
    commands,
    acquires,
    listLeases: () => [{ threadId: 'thread-source' }],
    async acquireThreadWorker(input) {
      acquires.push(input as unknown as Record<string, unknown>)
      sessionFilesByThreadId.set(input.threadId, input.sessionFile)
      return {
        workerId: `worker-${input.threadId}`,
        threadId: input.threadId,
        cwd: input.cwd,
        sessionFile: input.sessionFile,
        acquiredAt: 1,
        lastActiveAt: 1,
        lastEventAt: 1
      }
    },
    async send(threadId: string, command: { type: string; entryId?: string; position?: string }) {
      commands.push({ threadId, ...command })
      if (command.type === 'create_fork_session') {
        return {
          success: true,
          command: command.type,
          data: {
            sessionFile: forkSessionFile,
            cancelled: false
          }
        }
      }
      if (command.type === 'get_state') {
        return {
          success: true,
          data: {
            sessionFile: sessionFilesByThreadId.get(threadId),
            cwd,
            sessionName: 'Source · 分支',
            thinkingLevel: 'medium',
            isStreaming: false,
            isCompacting: false
          }
        }
      }
      if (command.type === 'get_messages') {
        return {
          success: true,
          data: {
            messages: []
          }
        }
      }
      return {
        success: false,
        command: command.type,
        error: { code: 'invalid_command', message: command.type, recoverable: true }
      }
    }
  } as unknown as ThreadWorkerRegistry & {
    commands: Array<Record<string, unknown>>
    acquires: Array<Record<string, unknown>>
  }
}

/** 创建会话切换 registry stub。 */
function createSessionSwitchRegistry(sessionFile: string): ThreadWorkerRegistry {
  return {
    listLeases: () => [{ threadId: 'thread-sync-session' }],
    send: async (_threadId: string, command: { type: string }) => {
      if (command.type === 'switch_session') {
        return {
          success: true,
          command: command.type
        }
      }
      if (command.type === 'get_state') {
        return {
          success: true,
          data: {
            sessionFile,
            cwd: '/tmp/session-switch-cwd',
            sessionName: 'New title',
            thinkingLevel: 'medium'
          }
        }
      }
      if (command.type === 'get_messages') {
        return {
          success: true,
          data: {
            messages: []
          }
        }
      }
      return {
        success: false,
        command: command.type,
        error: { code: 'invalid_command', message: command.type, recoverable: true }
      }
    }
  } as unknown as ThreadWorkerRegistry
}
