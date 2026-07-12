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
    expect(store.activeProjectId).toBe('project-a')
    expect(store.activeProject?.path).toBe('/tmp/project-a')
  })

  it('用户取消目录选择时不写入 Project', async () => {
    const createProject = vi.fn().mockResolvedValue(undefined)
    installCodingAgentApi({ createProject })
    const store = useWorkspaceProjectStore()

    const project = await store.createProject()

    expect(project).toBeUndefined()
    expect(store.projectList).toEqual([])
    expect(store.activeProjectId).toBeUndefined()
    expect(store.errorMessage).toBeUndefined()
  })

  it('打开 Project 后记录 active Project', async () => {
    const openProject = vi.fn().mockResolvedValue({
      projectId: 'project-a',
      name: 'Project A',
      path: '/tmp/project-a',
      status: 'available',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })
    installCodingAgentApi({ openProject })
    const store = useWorkspaceProjectStore()

    await store.openProject('project-a')

    expect(openProject).toHaveBeenCalledWith('project-a')
    expect(store.activeProjectId).toBe('project-a')
    expect(store.activeProject?.projectId).toBe('project-a')
  })

  it('加载 Project 时清理不存在的 active Project', async () => {
    const listProjects = vi.fn().mockResolvedValue([])
    installCodingAgentApi({ listProjects })
    const store = useWorkspaceProjectStore()
    store.setActiveProjectId('project-missing')

    await store.loadProjects()

    expect(store.activeProjectId).toBeUndefined()
  })

  it('重命名 Project 仅更新显示名称', async () => {
    const renameProject = vi.fn().mockResolvedValue(undefined)
    const getProject = vi.fn().mockResolvedValue({
      projectId: 'project-a',
      name: '项目别名',
      path: '/tmp/real-project-name',
      status: 'available',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:01:00.000Z'
    })
    installCodingAgentApi({ renameProject, getProject })
    const store = useWorkspaceProjectStore()

    await store.renameProject('project-a', '项目别名')

    expect(renameProject).toHaveBeenCalledWith({ projectId: 'project-a', name: '项目别名' })
    expect(store.projects['project-a']).toMatchObject({
      name: '项目别名',
      path: '/tmp/real-project-name'
    })
  })

  it('删除 Project 后清理本地项目与 active 状态', async () => {
    const deleteProject = vi.fn().mockResolvedValue({ threadIds: ['thread-a'] })
    installCodingAgentApi({ deleteProject })
    const store = useWorkspaceProjectStore()
    store.projects['project-a'] = {
      projectId: 'project-a',
      name: 'Project A',
      path: '/tmp/project-a',
      status: 'available',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    }
    store.setActiveProjectId('project-a')

    expect(await store.deleteProject('project-a')).toBe(true)

    expect(deleteProject).toHaveBeenCalledWith('project-a')
    expect(store.projects['project-a']).toBeUndefined()
    expect(store.activeProjectId).toBeUndefined()
  })

  it('设置 Project trust 后更新 Project 状态', async () => {
    const setProjectTrust = vi.fn().mockResolvedValue({
      projectId: 'project-a',
      name: 'Project A',
      path: '/tmp/project-a',
      status: 'available',
      trust: {
        state: 'trusted',
        requiresTrust: true
      },
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    })
    installCodingAgentApi({ setProjectTrust })
    const store = useWorkspaceProjectStore()

    await store.setProjectTrust('project-a', 'trustProject')

    expect(setProjectTrust).toHaveBeenCalledWith({
      projectId: 'project-a',
      decision: 'trustProject'
    })
    expect(store.projects['project-a']?.trust).toMatchObject({
      state: 'trusted',
      requiresTrust: true
    })
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
        deleteProject: vi.fn(),
        listProjects: vi.fn().mockResolvedValue([]),
        openProject: vi.fn(),
        getProject: vi.fn(),
        renameProject: vi.fn(),
        setProjectTrust: vi.fn(),
        ...overrides
      }
    }
  })
}
