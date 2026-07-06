/**
 * metadata-ipc.test.ts - 测试 deferred 首屏 metadata IPC。
 */

import { describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { codingAgentChannels } from '@shared/coding-agent/channels'
import { registerLightweightMetadataIpc } from '../metadata-ipc'
import type { IpcResult, ProjectSummary, ThreadSummary } from '@shared/coding-agent/types'

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

    await expect(invokeHandler<ProjectSummary[]>(ipc, codingAgentChannels.listProjects)).resolves.toEqual({
      ok: true,
      value: [project]
    })
    await expect(invokeHandler<ThreadSummary[]>(ipc, codingAgentChannels.listThreads)).resolves.toEqual({
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

    expect(ipc.removed).toEqual([
      codingAgentChannels.listProjects,
      codingAgentChannels.listThreads
    ])
    expect(projectStore.close).toHaveBeenCalledTimes(1)
    expect(threadStore.close).toHaveBeenCalledTimes(1)
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

function createProject(): ProjectSummary {
  return {
    createdAt: '2026-07-06T00:00:00.000Z',
    name: 'Project',
    path: 'H:\\project',
    projectId: 'project-a',
    status: 'available',
    updatedAt: '2026-07-06T00:00:00.000Z'
  }
}

function createThread(): ThreadSummary {
  return {
    createdAt: '2026-07-06T00:00:00.000Z',
    projectId: 'project-a',
    status: 'idle',
    threadId: 'thread-a',
    title: 'Thread',
    updatedAt: '2026-07-06T00:00:00.000Z'
  }
}
