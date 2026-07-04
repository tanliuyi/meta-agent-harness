/**
 * 本文件测试 Project-first thread lifecycle。
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { ProjectStore } from '../project-store'
import { ProjectTrustService } from '../project-trust-service'
import { CodingThreadStore } from '../thread-store'
import { CodingThreadManager } from '../thread-manager'
import {
  resolveSessionCwd,
  SessionManager
} from '../../../../../../packages/coding-agent/src/core/session-manager'
import type { StartThreadInput, WorkerLease } from '../worker-types'
import type { ThreadWorkerRegistry } from '../thread-worker-registry'
import type { AgentMessage } from '@earendil-works/pi-agent-core'

describe('CodingThreadManager lifecycle', () => {
  it('新线程使用 Project.path，恢复 sessionFile 使用 Pi session header cwd', async () => {
    const root = createTempDir()
    const projectPath = join(root, 'repo')
    const sessionCwd = join(root, 'session-repo')
    mkdirSync(projectPath, { recursive: true })
    mkdirSync(sessionCwd, { recursive: true })
    const sessionManager = SessionManager.create(sessionCwd, join(root, 'sessions'))
    sessionManager.appendMessage({ role: 'user', content: 'from session', timestamp: 1 })
    sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'reply' }],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'claude-test',
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
    expect(resolveSessionCwd(sessionFile, projectPath)).toBe(sessionCwd)
    const projectStore = new ProjectStore(':memory:')
    const threadStore = new CodingThreadStore(':memory:')
    const registry = createRecordingRegistry()
    const manager = new CodingThreadManager(
      registry as unknown as ThreadWorkerRegistry,
      threadStore,
      projectStore,
      new ProjectTrustService(join(root, 'agent'))
    )
    const project = manager.createProject({ path: projectPath })

    const snapshot = await manager.createThread({
      threadId: 'thread-a',
      projectId: project.projectId,
      title: 'Thread A'
    })

    expect(snapshot.cwd).toBe(projectPath)
    expect(registry.acquires).toMatchObject([
      {
        threadId: 'thread-a',
        cwd: projectPath,
        title: 'Thread A'
      }
    ])

    await manager.stopThread('thread-a')
    await manager.restartThread('thread-a')

    expect(registry.acquires[1]).toMatchObject({
      threadId: 'thread-a',
      cwd: projectPath,
      title: 'Thread A'
    })

    const resumedSnapshot = await manager.createThread({
      threadId: 'thread-b',
      projectId: project.projectId,
      sessionFile,
      title: 'Thread B'
    })

    expect(resumedSnapshot.cwd).toBe(sessionCwd)
    expect(registry.acquires[2]).toMatchObject({
      threadId: 'thread-b',
      cwd: sessionCwd,
      sessionFile,
      title: 'Thread B'
    })

    await manager.stopThread('thread-b')
    await manager.restartThread('thread-b')

    expect(registry.acquires[3]).toMatchObject({
      threadId: 'thread-b',
      cwd: sessionCwd,
      sessionFile,
      title: 'Thread B'
    })

    threadStore.close()
    projectStore.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('createThread 使用 Project trust 状态启动 worker，不在 Thread 创建时弹 trust approve', async () => {
    const root = createTempDir()
    const projectPath = join(root, 'repo')
    mkdirSync(join(projectPath, '.pi'), { recursive: true })
    writeFileSync(join(projectPath, '.pi', 'settings.json'), '{}')
    const agentDir = join(root, 'agent')
    const projectStore = new ProjectStore(':memory:')
    const threadStore = new CodingThreadStore(':memory:')
    const registry = createRecordingRegistry()
    const manager = new CodingThreadManager(
      registry as unknown as ThreadWorkerRegistry,
      threadStore,
      projectStore,
      new ProjectTrustService(agentDir)
    )
    const project = manager.createProject({ path: projectPath })

    expect(project.trust).toMatchObject({
      state: 'unknown',
      requiresTrust: true
    })

    await manager.createThread({
      threadId: 'thread-untrusted',
      projectId: project.projectId
    })
    expect(registry.acquires[0]).toMatchObject({
      threadId: 'thread-untrusted',
      cwd: projectPath,
      projectTrustOverride: false
    })

    const trustedProject = manager.setProjectTrust({
      projectId: project.projectId,
      decision: 'trustProject'
    })
    expect(trustedProject.trust).toMatchObject({
      state: 'trusted',
      requiresTrust: true
    })

    await manager.createThread({
      threadId: 'thread-trusted',
      projectId: project.projectId
    })
    expect(registry.acquires[1]).toMatchObject({
      threadId: 'thread-trusted',
      cwd: projectPath,
      projectTrustOverride: true
    })

    threadStore.close()
    projectStore.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('新建 thread 后把 Pi runtime 生成的 sessionFile 回写到 metadata', async () => {
    const root = createTempDir()
    const projectPath = join(root, 'repo')
    const metadataPath = join(root, 'threads.json')
    const sessionFile = join(root, 'sessions', 'session.jsonl')
    mkdirSync(projectPath, { recursive: true })
    mkdirSync(join(sessionFile, '..'), { recursive: true })
    writeFileSync(sessionFile, `${JSON.stringify({ type: 'session_start', cwd: projectPath })}\n`)
    const projectStore = new ProjectStore(':memory:')
    const threadStore = new CodingThreadStore(metadataPath)
    const registry = createRecordingRegistry()
    const manager = new CodingThreadManager(
      registry as unknown as ThreadWorkerRegistry,
      threadStore,
      projectStore,
      new ProjectTrustService(join(root, 'agent'))
    )
    const project = manager.createProject({ path: projectPath })
    registry.liveStates.set('thread-a', {
      sessionFile,
      sessionName: 'Runtime Session'
    })

    const snapshot = await manager.createThread({
      threadId: 'thread-a',
      projectId: project.projectId
    })

    expect(snapshot.sessionFile).toBe(sessionFile)
    expect(snapshot.title).toBe('Runtime Session')

    const reopened = new CodingThreadStore(metadataPath)
    expect(reopened.listThreads()).toMatchObject([
      {
        threadId: 'thread-a',
        sessionFile,
        title: 'Runtime Session'
      }
    ])
    reopened.close()
    threadStore.close()
    projectStore.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('活跃 worker 快照会从 live messages 派生 fileChanges', async () => {
    const root = createTempDir()
    const projectPath = join(root, 'repo')
    mkdirSync(projectPath, { recursive: true })
    const projectStore = new ProjectStore(':memory:')
    const threadStore = new CodingThreadStore(':memory:')
    const registry = createRecordingRegistry()
    const manager = new CodingThreadManager(
      registry as unknown as ThreadWorkerRegistry,
      threadStore,
      projectStore,
      new ProjectTrustService(join(root, 'agent'))
    )
    const project = manager.createProject({ path: projectPath })
    const messages: AgentMessage[] = [
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'tool-edit', name: 'edit', arguments: { path: 'src/app.ts' } }],
        api: 'responses',
        provider: 'openai',
        model: 'gpt-test',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'toolUse',
        timestamp: 1
      },
      {
        role: 'toolResult',
        toolCallId: 'tool-edit',
        toolName: 'edit',
        content: [{ type: 'text', text: 'Successfully replaced 1 block(s) in src/app.ts.' }],
        isError: false,
        timestamp: Date.parse('2026-07-01T00:00:00.000Z'),
        details: {
          diff: '-1 old\n+1 new',
          patch: '--- src/app.ts\n+++ src/app.ts\n@@\n-old\n+new\n',
          firstChangedLine: 1
        }
      } as AgentMessage
    ]

    await manager.createThread({
      threadId: 'thread-a',
      projectId: project.projectId
    })
    registry.liveMessages.set('thread-a', messages)

    const snapshot = await manager.getSnapshot('thread-a')

    expect(snapshot.messages).toMatchObject([
      {
        role: 'assistant',
        toolCallIds: ['tool-edit'],
        raw: {
          role: 'assistant',
          content: []
        }
      }
    ])
    expect(snapshot.messages.some((message) => message.role === 'tool')).toBe(false)
    expect(snapshot.toolCalls).toMatchObject([
      {
        toolCallId: 'tool-edit',
        toolName: 'edit',
        status: 'succeeded',
        args: { path: 'src/app.ts' }
      }
    ])
    expect(snapshot.toolCalls.some((toolCall) => toolCall.toolName === 'tool')).toBe(false)
    expect(snapshot.fileChanges).toMatchObject([
      {
        threadId: 'thread-a',
        toolCallId: 'tool-edit',
        path: 'src/app.ts',
        changeType: 'updated',
        diff: '-1 old\n+1 new',
        additions: 1,
        deletions: 1,
        firstChangedLine: 1
      }
    ])

    threadStore.close()
    projectStore.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('归档隐藏 thread 但保留 metadata/sessionFile，并支持恢复', async () => {
    const root = createTempDir()
    const projectPath = join(root, 'repo')
    const sessionFile = join(root, 'sessions', 'session.jsonl')
    mkdirSync(projectPath, { recursive: true })
    mkdirSync(join(sessionFile, '..'), { recursive: true })
    writeFileSync(sessionFile, `${JSON.stringify({ type: 'session_start', cwd: projectPath })}\n`)
    const projectStore = new ProjectStore(':memory:')
    const threadStore = new CodingThreadStore(':memory:')
    const registry = createRecordingRegistry()
    const manager = new CodingThreadManager(
      registry as unknown as ThreadWorkerRegistry,
      threadStore,
      projectStore,
      new ProjectTrustService(join(root, 'agent'))
    )
    const project = manager.createProject({ path: projectPath })
    await manager.createThread({
      threadId: 'thread-a',
      projectId: project.projectId,
      sessionFile,
      title: 'Thread A'
    })

    await manager.archiveThread('thread-a')

    expect(manager.listThreads()).toEqual([])
    expect(manager.listThreads({ archived: true })).toMatchObject([
      {
        threadId: 'thread-a',
        projectId: project.projectId,
        sessionFile,
        status: 'stopped'
      }
    ])
    expect(threadStore.listThreads()).toEqual([])
    expect(threadStore.listThreads({ archived: true })[0]).toMatchObject({
      threadId: 'thread-a',
      sessionFile
    })

    const acquireCountAfterArchive = registry.acquires.length
    await manager.restoreThread('thread-a')

    expect(registry.acquires).toHaveLength(acquireCountAfterArchive)
    expect(manager.listThreads()).toMatchObject([
      {
        threadId: 'thread-a',
        projectId: project.projectId,
        sessionFile,
        status: 'stopped'
      }
    ])
    expect(manager.listThreads()[0]?.archivedAt).toBeUndefined()
    expect(manager.listThreads({ archived: true })).toEqual([])

    threadStore.close()
    projectStore.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('project 路径不可用时拒绝 createThread', async () => {
    const projectStore = new ProjectStore(':memory:')
    const threadStore = new CodingThreadStore(':memory:')
    const registry = createRecordingRegistry()
    const project = projectStore.createProject({ path: createTempDir() })
    const manager = new CodingThreadManager(
      registry as unknown as ThreadWorkerRegistry,
      threadStore,
      projectStore
    )

    await expect(manager.createThread({ projectId: project.projectId })).rejects.toThrow(
      'project is not available: missing'
    )
    expect(registry.acquires).toEqual([])

    threadStore.close()
    projectStore.close()
  })
})

/**
 * 创建临时目录名。
 * @returns 临时路径。
 */
function createTempDir(): string {
  return join(tmpdir(), `meta-agent-desktop-${crypto.randomUUID()}`)
}

/**
 * 创建记录 acquire 输入的 ThreadWorkerRegistry stub。
 * @returns registry stub。
 */
function createRecordingRegistry(): {
  acquires: StartThreadInput[]
  liveStates: Map<string, Record<string, unknown>>
  liveMessages: Map<string, AgentMessage[]>
  acquireThreadWorker(input: StartThreadInput): Promise<WorkerLease>
  releaseThreadWorker(threadId: string): Promise<void>
  send(
    threadId: string,
    command: { type: string }
  ): Promise<{
    kind: 'response'
    id: string
    command: string
    success: true
    data?: unknown
  }>
  listLeases(): WorkerLease[]
  shutdown(): Promise<void>
} {
  const acquires: StartThreadInput[] = []
  const liveStates = new Map<string, Record<string, unknown>>()
  const liveMessages = new Map<string, AgentMessage[]>()
  const leases = new Map<string, WorkerLease>()
  return {
    acquires,
    liveStates,
    liveMessages,
    async acquireThreadWorker(input) {
      acquires.push(input)
      if (!input.threadId) {
        throw new Error('threadId is required')
      }
      const time = acquires.length
      const lease: WorkerLease = {
        workerId: `worker-${acquires.length}`,
        threadId: input.threadId,
        cwd: input.cwd,
        sessionFile: input.sessionFile,
        acquiredAt: time,
        lastActiveAt: time,
        lastEventAt: time
      }
      leases.set(input.threadId, lease)
      return lease
    },
    async releaseThreadWorker(threadId) {
      leases.delete(threadId)
    },
    async send(threadId, command) {
      return {
        kind: 'response',
        id: 'response-a',
        command: command.type,
        success: true,
        data:
          command.type === 'get_state'
            ? { cwd: leases.get(threadId)?.cwd, ...liveStates.get(threadId) }
            : command.type === 'get_messages'
              ? { messages: liveMessages.get(threadId) ?? [] }
            : undefined
      }
    },
    listLeases() {
      return [...leases.values()]
    },
    async shutdown() {
      leases.clear()
    }
  }
}
