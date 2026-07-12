/**
 * workspace-project.ts - 管理 renderer 中 Project 状态与 IPC 调用。
 */

import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import type { ProjectSummary, ProjectTrustDecision } from '@shared/coding-agent/types'

/**
 * Workspace Project Store。
 */
export default defineStore(
  'workspace-project',
  () => {
    /** Project 数据。 */
    const projects = reactive<Record<string, ProjectSummary>>({})

    /** 当前活跃 Project ID，会持久化到本地。 */
    const activeProjectId = ref<string>()

    /** 是否正在加载。 */
    const loading = ref(false)

    /** 错误提示信息。 */
    const errorMessage = ref<string>()

    /** Project 列表。 */
    const projectList = computed(() => Object.values(projects))

    /** 当前活跃 Project。 */
    const activeProject = computed(() =>
      activeProjectId.value ? projects[activeProjectId.value] : undefined
    )

    /**
     * 设置当前活跃 Project。
     * @param projectId - Project ID。
     */
    const setActiveProjectId = (projectId: string | undefined): void => {
      activeProjectId.value = projectId
    }

    /**
     * 加载 Project 列表。
     */
    const loadProjects = async (): Promise<void> => {
      loading.value = true
      errorMessage.value = undefined
      try {
        const loaded = await window.api.codingAgent.listProjects()
        for (const project of loaded) {
          projects[project.projectId] = project
        }
        if (activeProjectId.value && !projects[activeProjectId.value]) {
          activeProjectId.value = undefined
        }
      } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : String(error)
      } finally {
        loading.value = false
      }
    }

    /**
     * 打开系统目录选择器并创建或打开 Project。
     */
    const createProject = async (): Promise<ProjectSummary | undefined> => {
      loading.value = true
      errorMessage.value = undefined
      try {
        const project = await window.api.codingAgent.createProject()
        if (!project) {
          return undefined
        }
        projects[project.projectId] = project
        activeProjectId.value = project.projectId
        return project
      } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : String(error)
        return undefined
      } finally {
        loading.value = false
      }
    }

    /**
     * 打开 Project。
     * @param projectId - Project ID。
     */
    const openProject = async (projectId: string): Promise<void> => {
      loading.value = true
      errorMessage.value = undefined
      try {
        const project = await window.api.codingAgent.openProject(projectId)
        projects[project.projectId] = project
        activeProjectId.value = project.projectId
      } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : String(error)
      } finally {
        loading.value = false
      }
    }

    /**
     * 重命名 Project。
     * @param projectId - Project ID。
     * @param name - 新名称。
     */
    const renameProject = async (projectId: string, name: string): Promise<void> => {
      loading.value = true
      errorMessage.value = undefined
      try {
        await window.api.codingAgent.renameProject({ projectId, name })
        const project = await window.api.codingAgent.getProject(projectId)
        projects[project.projectId] = project
      } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : String(error)
      } finally {
        loading.value = false
      }
    }

    /**
     * 删除 Project 配置及其全部 thread metadata。
     * @param projectId - Project ID。
     */
    const deleteProject = async (projectId: string): Promise<boolean> => {
      loading.value = true
      errorMessage.value = undefined
      try {
        await window.api.codingAgent.deleteProject(projectId)
        delete projects[projectId]
        if (activeProjectId.value === projectId) {
          activeProjectId.value = undefined
        }
        return true
      } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : String(error)
        return false
      } finally {
        loading.value = false
      }
    }

    /**
     * 设置 Project trust 决策。
     * @param projectId - Project ID。
     * @param decision - trust 决策。
     */
    const setProjectTrust = async (
      projectId: string,
      decision: ProjectTrustDecision
    ): Promise<void> => {
      loading.value = true
      errorMessage.value = undefined
      try {
        const project = await window.api.codingAgent.setProjectTrust({ projectId, decision })
        projects[project.projectId] = project
      } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : String(error)
      } finally {
        loading.value = false
      }
    }

    return {
      activeProject,
      activeProjectId,
      createProject,
      deleteProject,
      errorMessage,
      loadProjects,
      loading,
      openProject,
      projectList,
      projects,
      renameProject,
      setActiveProjectId,
      setProjectTrust
    }
  },
  {
    persist: {
      pick: ['activeProjectId']
    }
  }
)
