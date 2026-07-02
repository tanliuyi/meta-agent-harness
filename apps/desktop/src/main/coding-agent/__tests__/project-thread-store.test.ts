/**
 * 本文件测试 Project/Thread SQLite registry。
 */

import { mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { ProjectStore, getProjectStatus } from '../project-store'
import { CodingThreadStore } from '../thread-store'
import { ThreadManagerCore } from '../thread-manager-core'
import type { ThreadSnapshot, ThreadSummary } from '@shared/coding-agent/types'
import type { ThreadWorkerRegistry } from '../thread-worker-registry'

/** 创建临时目录。 */
function createTempDir(): string {
  return join(tmpdir(), `meta-agent-desktop-${crypto.randomUUID()}`)
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
    const snapshot: ThreadSnapshot = {
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

    store.saveThread(summaryA)
    store.saveThread(summaryB)
    store.saveSnapshot(snapshot)

    expect(store.listThreads({ projectId: 'project-a' })).toEqual([summaryA])
    expect(store.listThreads()).toEqual([summaryB, summaryA])
    expect(store.getSnapshot('thread-a')).toEqual(snapshot)
    store.close()
  })

  it('开发期遇到旧 cwd-only threads schema 时清空并重建 registry', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`
      create table threads (
        thread_id text primary key,
        summary_json text not null,
        updated_at text not null
      );
      insert into threads(thread_id, summary_json, updated_at)
        values ('legacy-thread', '{}', '2026-07-01T00:00:00.000Z');
    `)

    const store = new CodingThreadStore(db, { ownsDb: false })
    expect(store.listThreads()).toEqual([])

    const columns = db.prepare("select name from pragma_table_info('threads')").all() as Array<{
      name: string
    }>
    expect(columns.some((column) => column.name === 'project_id')).toBe(true)
    db.close()
  })

  it('保存和读取 projection/index 状态表', () => {
    const store = new CodingThreadStore(':memory:')

    store.saveMessageIndex({
      threadId: 'thread-a',
      sessionEntryId: 'entry-a',
      role: 'assistant',
      summary: '完成了一个变更',
      createdAt: '2026-07-01T00:00:00.000Z'
    })
    store.saveToolCall({
      threadId: 'thread-a',
      toolCallId: 'tool-a',
      toolName: 'apply_patch',
      status: 'finished',
      args: { file: 'README.md' },
      resultSummary: 'patched',
      startedAt: '2026-07-01T00:00:01.000Z',
      finishedAt: '2026-07-01T00:00:02.000Z'
    })
    store.saveFileChange({
      threadId: 'thread-a',
      toolCallId: 'tool-a',
      path: 'README.md',
      changeType: 'modify',
      patch: '@@',
      createdAt: '2026-07-01T00:00:03.000Z'
    })
    store.saveApprovalRequest({
      approvalId: 'approval-a',
      threadId: 'thread-a',
      status: 'pending',
      request: { action: 'shell' },
      createdAt: '2026-07-01T00:00:04.000Z'
    })
    store.resolveApproval('approval-a', { allow: true }, 'approved')
    store.saveWorkerRun({
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
    const diagnostic = store.saveDiagnostic({
      threadId: 'thread-a',
      source: 'worker',
      severity: 'error',
      message: 'worker crashed',
      details: { code: 'boom' },
      createdAt: '2026-07-01T00:00:07.000Z'
    })

    expect(store.listMessageIndex('thread-a')).toEqual([
      {
        threadId: 'thread-a',
        sessionEntryId: 'entry-a',
        role: 'assistant',
        summary: '完成了一个变更',
        createdAt: '2026-07-01T00:00:00.000Z'
      }
    ])
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
        request: { action: 'shell' },
        response: { allow: true }
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

  it('从 projection/index 表回填 snapshot', async () => {
    const db = new DatabaseSync(':memory:')
    const projectStore = new ProjectStore(db, { ownsDb: false })
    const store = new CodingThreadStore(db, { ownsDb: false })
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
    store.saveMessageIndex({
      threadId: 'thread-a',
      sessionEntryId: 'entry-a',
      role: 'assistant',
      summary: 'indexed message',
      createdAt: '2026-07-01T00:00:00.000Z'
    })
    store.saveToolCall({
      threadId: 'thread-a',
      toolCallId: 'tool-a',
      toolName: 'read_file',
      status: 'finished',
      startedAt: '2026-07-01T00:00:01.000Z'
    })
    store.saveFileChange({
      threadId: 'thread-a',
      path: 'src/index.ts',
      changeType: 'modify',
      createdAt: '2026-07-01T00:00:02.000Z'
    })
    store.saveApprovalRequest({
      approvalId: 'approval-a',
      threadId: 'thread-a',
      status: 'pending',
      request: { action: 'edit' },
      createdAt: '2026-07-01T00:00:03.000Z'
    })
    store.saveDiagnostic({
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
    expect(snapshot.messages).toHaveLength(1)
    expect(snapshot.messages[0]?.text).toBe('indexed message')
    expect(snapshot.toolCalls).toHaveLength(1)
    expect(snapshot.fileChanges).toHaveLength(1)
    expect(snapshot.approvals).toHaveLength(1)
    expect(snapshot.diagnostics).toHaveLength(1)
    db.close()
    rmSync(cwd, { recursive: true, force: true })
  })

  it('store 写入或索引读取失败时不阻塞内存 registry 与最小 snapshot', async () => {
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
        throw new Error('database is locked')
      },
      getSnapshot: () => undefined,
      listMessageIndex: () => {
        throw new Error('message index failed')
      },
      saveDiagnostic: () => undefined
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

  it('缺少 DB snapshot 时从 canonical JSONL session 重建最小 snapshot', async () => {
    const db = new DatabaseSync(':memory:')
    const projectStore = new ProjectStore(db, { ownsDb: false })
    const store = new CodingThreadStore(db, { ownsDb: false })
    const root = createTempDir()
    const cwd = join(root, 'repo')
    const sessionFile = join(root, 'session.jsonl')
    mkdirSync(cwd, { recursive: true })
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: 'message',
          id: 'entry-user',
          timestamp: '2026-07-01T00:00:00.000Z',
          message: { role: 'user', content: 'hello' }
        }),
        JSON.stringify({
          type: 'message',
          id: 'entry-assistant',
          timestamp: '2026-07-01T00:00:01.000Z',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'world' }]
          }
        }),
        JSON.stringify({
          type: 'thinking_level_change',
          id: 'entry-thinking',
          thinkingLevel: 'high'
        }),
        JSON.stringify({
          type: 'session_info',
          id: 'entry-info',
          name: 'JSONL session'
        })
      ].join('\n')
    )
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
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('desktop DB 删除后可重建 registry 并从 JSONL session 恢复最小 snapshot', async () => {
    const root = createTempDir()
    const cwd = join(root, 'repo')
    const sessionFile = join(root, 'session.jsonl')
    const dbFile = join(root, 'meta-agent.db')
    mkdirSync(cwd, { recursive: true })
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: 'message',
          id: 'entry-user',
          timestamp: '2026-07-01T00:00:00.000Z',
          message: { role: 'user', content: 'restore me' }
        }),
        JSON.stringify({
          type: 'session_info',
          id: 'entry-info',
          name: 'Restored session'
        })
      ].join('\n')
    )

    const oldDb = new DatabaseSync(dbFile)
    const oldProjectStore = new ProjectStore(oldDb, { ownsDb: false })
    const oldThreadStore = new CodingThreadStore(oldDb, { ownsDb: false })
    const oldProject = oldProjectStore.createProject({ path: cwd })
    oldThreadStore.saveThread({
      threadId: 'old-thread',
      projectId: oldProject.projectId,
      sessionFile,
      status: 'stopped',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })
    oldDb.close()
    unlinkSync(dbFile)

    const rebuiltDb = new DatabaseSync(dbFile)
    const projectStore = new ProjectStore(rebuiltDb, { ownsDb: false })
    const store = new CodingThreadStore(rebuiltDb, { ownsDb: false })
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
    expect(snapshot.messages).toMatchObject([{ id: 'entry-user', text: 'restore me' }])
    rebuiltDb.close()
    rmSync(root, { recursive: true, force: true })
  })
})

/** 创建无活跃 worker 的 registry stub。 */
function createIdleThreadWorkerRegistry(): ThreadWorkerRegistry {
  return {
    listLeases: () => []
  } as unknown as ThreadWorkerRegistry
}
