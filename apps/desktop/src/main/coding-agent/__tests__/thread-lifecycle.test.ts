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
import type { StartThreadInput, WorkerLease } from '../worker-types'
import type { ThreadWorkerRegistry } from '../thread-worker-registry'

describe('CodingThreadManager lifecycle', () => {
  it('createThread 和 restartThread 使用 Project.path 作为 worker cwd', async () => {
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

  it('project 路径不可用时拒绝 createThread', async () => {
    const projectStore = new ProjectStore(':memory:')
    const threadStore = new CodingThreadStore(':memory:')
    const registry = createRecordingRegistry()
    const project = projectStore.createProject({ path: createTempDir() })
    const manager = new CodingThreadManager(registry as unknown as ThreadWorkerRegistry, threadStore, projectStore)

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
  acquireThreadWorker(input: StartThreadInput): Promise<WorkerLease>
  releaseThreadWorker(threadId: string): Promise<void>
  send(threadId: string, command: { type: string }): Promise<{
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
  const leases = new Map<string, WorkerLease>()
  return {
    acquires,
    async acquireThreadWorker(input) {
      acquires.push(input)
      if (!input.threadId) {
        throw new Error('threadId is required')
      }
      const lease: WorkerLease = {
        workerId: `worker-${acquires.length}`,
        threadId: input.threadId,
        cwd: input.cwd,
        sessionFile: input.sessionFile,
        acquiredAt: acquires.length,
        lastActiveAt: acquires.length
      }
      leases.set(input.threadId, lease)
      return lease
    },
    async releaseThreadWorker(threadId) {
      leases.delete(threadId)
    },
    async send(_threadId, command) {
      return {
        kind: 'response',
        id: 'response-a',
        command: command.type,
        success: true,
        data: command.type === 'get_state' ? {} : undefined
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
