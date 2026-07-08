/**
 * 本文件测试 settings 归档会话 store。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import useWorkspaceArchiveStore from '../workspace-archive'
import useWorkspaceProjectStore from '../workspace-project'

const routerMock = vi.hoisted(() => ({
  push: vi.fn()
}))

vi.mock('@renderer/router', () => ({
  default: routerMock
}))

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('workspace-archive', () => {
  it('按 archived=true 加载归档 thread 并按 Project 分组', async () => {
    const listThreads = vi.fn().mockResolvedValue([
      {
        threadId: 'thread-a',
        projectId: 'project-a',
        title: 'Archived A',
        status: 'stopped',
        archivedAt: '2026-07-01T00:00:02.000Z',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:02.000Z'
      }
    ])
    installCodingAgentApi({ listThreads })
    const projectStore = useWorkspaceProjectStore()
    projectStore.projects['project-a'] = {
      projectId: 'project-a',
      name: 'Project A',
      path: '/tmp/project-a',
      status: 'available',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    }
    const archiveStore = useWorkspaceArchiveStore()

    await archiveStore.loadArchivedThreads()

    expect(listThreads).toHaveBeenCalledWith({ archived: true })
    expect(archiveStore.projectGroups).toEqual([
      {
        project: projectStore.projects['project-a'],
        projectId: 'project-a',
        threads: [archiveStore.archivedThreads['thread-a']]
      }
    ])
  })

  it('恢复归档 thread 后刷新归档列表状态和普通 thread 列表', async () => {
    const archivedThread = {
      threadId: 'thread-a',
      projectId: 'project-a',
      title: 'Archived A',
      status: 'stopped',
      archivedAt: '2026-07-01T00:00:02.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:02.000Z'
    }
    const listThreads = vi.fn().mockResolvedValueOnce([archivedThread]).mockResolvedValueOnce([])
    const restoreThread = vi.fn().mockResolvedValue(undefined)
    installCodingAgentApi({ listThreads, restoreThread })
    const archiveStore = useWorkspaceArchiveStore()
    await archiveStore.loadArchivedThreads()

    await archiveStore.restoreThread('thread-a')

    expect(restoreThread).toHaveBeenCalledWith('thread-a')
    expect(listThreads).toHaveBeenNthCalledWith(1, { archived: true })
    expect(listThreads).toHaveBeenNthCalledWith(2)
    expect(archiveStore.archivedThreads['thread-a']).toBeUndefined()
  })
})

/**
 * 安装测试用 codingAgent API。
 * @param overrides - 覆盖方法。
 */
function installCodingAgentApi(overrides: Record<string, unknown>): void {
  vi.stubGlobal('window', {
    api: {
      codingAgent: {
        listProjects: vi.fn().mockResolvedValue([]),
        listThreads: vi.fn().mockResolvedValue([]),
        restoreThread: vi.fn().mockResolvedValue(undefined),
        onEvent: vi.fn(() => vi.fn()),
        ...overrides
      }
    }
  })
}
