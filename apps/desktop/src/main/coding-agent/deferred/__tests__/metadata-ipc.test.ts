/**
 * metadata-ipc.test.ts - 测试 deferred 首屏 metadata IPC。
 */

import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { IpcMainInvokeEvent } from 'electron'
import { codingAgentChannels } from '@shared/coding-agent/channels'
import { registerLightweightMetadataIpc } from '../metadata-ipc'
import type { IpcResult, ProjectSummary, ThreadSummary } from '@shared/coding-agent/types'
import {
  createLightweightProjectMetadataStore,
  createLightweightThreadMetadataStore
} from '../metadata-reader'
import { getDesktopAgentDir } from '../../agent-dir'

describe('registerLightweightMetadataIpc', () => {
  it('注册 listProjects/listThreads 并返回结构化 IPC result', async () => {
    const ipc = createFakeIpc()
    const project = createProject()
    const thread = createThread()

    registerLightweightMetadataIpc({
      ipc,
      projectStore: {
        close: vi.fn(),
        listProjects: () => [project]
      },
      threadStore: {
        close: vi.fn(),
        listThreads: () => [thread]
      }
    })

    await expect(
      invokeHandler<ProjectSummary[]>(ipc, codingAgentChannels.listProjects)
    ).resolves.toEqual({
      ok: true,
      value: [project]
    })
    await expect(
      invokeHandler<ThreadSummary[]>(ipc, codingAgentChannels.listThreads)
    ).resolves.toEqual({
      ok: true,
      value: [thread]
    })
  })

  it('dispose 时移除轻量 handlers 并关闭 stores', () => {
    const ipc = createFakeIpc()
    const projectStore = {
      close: vi.fn(),
      listProjects: () => []
    }
    const threadStore = {
      close: vi.fn(),
      listThreads: () => []
    }

    const registration = registerLightweightMetadataIpc({ ipc, projectStore, threadStore })
    registration.dispose()
    registration.dispose()

    expect(ipc.removed).toEqual([codingAgentChannels.listProjects, codingAgentChannels.listThreads])
    expect(projectStore.close).toHaveBeenCalledTimes(1)
    expect(threadStore.close).toHaveBeenCalledTimes(1)
  })
})

describe('lightweight metadata readers', () => {
  it('只读 projects.json 并刷新路径状态', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-metadata-reader-'))
    const availableProjectPath = join(root, 'repo')
    const metadataPath = join(root, 'projects.json')
    mkdirSync(availableProjectPath)
    writeFileSync(
      metadataPath,
      JSON.stringify({
        version: 1,
        projects: [
          createProject({
            createdAt: '2026-07-06T00:00:00.000Z',
            path: join(root, 'missing')
          }),
          createProject({
            createdAt: '2026-07-06T00:00:01.000Z',
            path: availableProjectPath,
            projectId: 'project-newer'
          })
        ]
      })
    )

    try {
      const store = createLightweightProjectMetadataStore({ metadataPath })
      expect(store.listProjects()).toMatchObject([
        { projectId: 'project-newer', status: 'available' },
        { projectId: 'project-a', status: 'missing' }
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('只读 threads.json 并按 project/archive 过滤', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-metadata-reader-'))
    const metadataPath = join(root, 'threads.json')
    writeFileSync(
      metadataPath,
      JSON.stringify({
        version: 1,
        threads: [
          createThread({
            threadId: 'thread-old',
            projectId: 'project-a',
            updatedAt: '2026-07-06T00:00:00.000Z'
          }),
          createThread({
            threadId: 'thread-new',
            projectId: 'project-a',
            updatedAt: '2026-07-06T00:00:01.000Z'
          }),
          createThread({
            threadId: 'thread-archived',
            projectId: 'project-a',
            archivedAt: '2026-07-06T00:00:02.000Z',
            updatedAt: '2026-07-06T00:00:02.000Z'
          }),
          createThread({
            threadId: 'thread-other-project',
            projectId: 'project-b',
            updatedAt: '2026-07-06T00:00:03.000Z'
          })
        ]
      })
    )

    try {
      const store = createLightweightThreadMetadataStore({ metadataPath })
      expect(
        store.listThreads({ projectId: 'project-a' }).map((thread) => thread.threadId)
      ).toEqual(['thread-new', 'thread-old'])
      expect(
        store
          .listThreads({ projectId: 'project-a', archived: true })
          .map((thread) => thread.threadId)
      ).toEqual(['thread-archived'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('首屏读取 threads.json 时将跨进程残留运行态归一化为 idle', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-metadata-reader-'))
    const metadataPath = join(root, 'threads.json')
    writeFileSync(
      metadataPath,
      JSON.stringify({
        version: 1,
        threads: [
          createThread({ threadId: 'thread-running', status: 'running' }),
          createThread({ threadId: 'thread-starting', status: 'starting' }),
          createThread({ threadId: 'thread-stopping', status: 'stopping' }),
          createThread({ threadId: 'thread-error', status: 'error' })
        ]
      })
    )

    try {
      const store = createLightweightThreadMetadataStore({ metadataPath })

      expect(
        store.listThreads().map((thread) => ({
          threadId: thread.threadId,
          status: thread.status
        }))
      ).toEqual([
        { threadId: 'thread-running', status: 'idle' },
        { threadId: 'thread-starting', status: 'idle' },
        { threadId: 'thread-stopping', status: 'idle' },
        { threadId: 'thread-error', status: 'idle' }
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('getDesktopAgentDir', () => {
  it('沿用 Pi agentDir 的轻量路径展开语义', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-agent-dir-'))
    const envPath = join(root, 'agent')

    try {
      vi.stubEnv('PI_CODING_AGENT_DIR', '~/agent')
      expect(getDesktopAgentDir()).toBe(join(homedir(), 'agent'))

      vi.stubEnv('PI_CODING_AGENT_DIR', pathToFileURL(envPath).toString())
      expect(getDesktopAgentDir()).toBe(envPath)
    } finally {
      rmSync(root, { recursive: true, force: true })
      vi.unstubAllEnvs()
    }
  })
})

function createFakeIpc(): {
  handlers: Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>
  handle: (
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ) => void
  removed: string[]
  removeHandler: (channel: string) => void
} {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const removed: string[] = []
  return {
    handle: (channel, listener) => {
      handlers.set(channel, listener)
    },
    handlers,
    removed,
    removeHandler: (channel) => {
      removed.push(channel)
      handlers.delete(channel)
    }
  }
}

async function invokeHandler<T>(
  ipc: ReturnType<typeof createFakeIpc>,
  channel: string
): Promise<IpcResult<T>> {
  const handler = ipc.handlers.get(channel)
  if (!handler) {
    throw new Error(`missing handler: ${channel}`)
  }
  return (await handler({} as IpcMainInvokeEvent)) as IpcResult<T>
}

function createProject(patch: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    createdAt: '2026-07-06T00:00:00.000Z',
    name: 'Project',
    path: 'H:\\project',
    projectId: 'project-a',
    status: 'available',
    updatedAt: '2026-07-06T00:00:00.000Z',
    ...patch
  }
}

function createThread(patch: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    createdAt: '2026-07-06T00:00:00.000Z',
    projectId: 'project-a',
    status: 'idle',
    threadId: 'thread-a',
    title: 'Thread',
    updatedAt: '2026-07-06T00:00:00.000Z',
    ...patch
  }
}
