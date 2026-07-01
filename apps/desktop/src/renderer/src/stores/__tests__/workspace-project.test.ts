/**
 * 本文件测试 workspace-project 的目录选择创建链路。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import useWorkspaceProjectStore from '../workspace-project'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('workspace-project', () => {
  it('通过 preload 触发目录选择并创建 Project', async () => {
    const createProject = vi.fn().mockResolvedValue({
      projectId: 'project-a',
      name: 'Project A',
      path: '/tmp/project-a',
      status: 'available',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })
    installCodingAgentApi({ createProject })
    const store = useWorkspaceProjectStore()

    const project = await store.createProject()

    expect(createProject).toHaveBeenCalledWith()
    expect(project?.projectId).toBe('project-a')
    expect(store.projects['project-a']).toMatchObject({ path: '/tmp/project-a' })
  })

  it('用户取消目录选择时不写入 Project', async () => {
    const createProject = vi.fn().mockResolvedValue(undefined)
    installCodingAgentApi({ createProject })
    const store = useWorkspaceProjectStore()

    const project = await store.createProject()

    expect(project).toBeUndefined()
    expect(store.projectList).toEqual([])
    expect(store.errorMessage).toBeUndefined()
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
        createProject: vi.fn(),
        listProjects: vi.fn().mockResolvedValue([]),
        openProject: vi.fn(),
        getProject: vi.fn(),
        renameProject: vi.fn(),
        ...overrides
      }
    }
  })
}
