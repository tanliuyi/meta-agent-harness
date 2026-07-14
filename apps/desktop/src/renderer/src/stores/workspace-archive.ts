/**
 * workspace-archive.ts - 管理设置页中的归档 thread 列表与恢复操作。
 */

import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import useWorkspaceProjectStore from './workspace-project'
import useWorkspaceSessionStore from './workspace-session'
import type { ThreadSummary } from '@shared/coding-agent/types'
import { codingAgentApi } from '@renderer/api'

/**
 * Workspace Archive Store。
 */
export default defineStore('workspace-archive', () => {
  /** 归档会话映射。 */
  const archivedThreads = reactive<Record<string, ThreadSummary>>({})

  /** 是否正在加载。 */
  const loading = ref(false)

  /** 正在恢复的 thread ID。 */
  const restoringThreadId = ref<string>()

  /** 错误提示。 */
  const errorMessage = ref<string>()

  const workspaceProject = useWorkspaceProjectStore()
  const workspaceSession = useWorkspaceSessionStore()

  /** 归档会话列表。 */
  const archivedThreadList = computed(() =>
    Object.values(archivedThreads).sort((left, right) =>
      (right.archivedAt ?? right.updatedAt).localeCompare(left.archivedAt ?? left.updatedAt)
    )
  )

  /** 按 Project ID 分组的归档会话。 */
  const archivedThreadsByProject = computed(() =>
    archivedThreadList.value.reduce<Record<string, ThreadSummary[]>>((groups, thread) => {
      groups[thread.projectId] ??= []
      groups[thread.projectId].push(thread)
      return groups
    }, {})
  )

  /** 按 Project 分组后的归档会话列表。 */
  const projectGroups = computed(() =>
    Object.entries(archivedThreadsByProject.value)
      .map(([projectId, threads]) => ({
        project: workspaceProject.projects[projectId],
        projectId,
        threads
      }))
      .sort((left, right) =>
        (left.project?.name ?? left.projectId).localeCompare(right.project?.name ?? right.projectId)
      )
  )

  /**
   * 加载归档会话。
   */
  const loadArchivedThreads = async (): Promise<void> => {
    loading.value = true
    errorMessage.value = undefined
    try {
      if (workspaceProject.projectList.length === 0) {
        await workspaceProject.loadProjects()
      }
      const threads = await codingAgentApi.listThreads({ archived: true })
      const existingThreadIds = new Set(threads.map((thread) => thread.threadId))
      for (const threadId of Object.keys(archivedThreads)) {
        if (!existingThreadIds.has(threadId)) {
          delete archivedThreads[threadId]
        }
      }
      for (const thread of threads) {
        archivedThreads[thread.threadId] = thread
      }
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error)
    } finally {
      loading.value = false
    }
  }

  /**
   * 恢复归档会话。
   * @param threadId - Thread ID。
   */
  const restoreThread = async (threadId: string): Promise<void> => {
    restoringThreadId.value = threadId
    errorMessage.value = undefined
    try {
      await codingAgentApi.restoreThread(threadId)
      delete archivedThreads[threadId]
      await workspaceSession.loadThreads()
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error)
    } finally {
      restoringThreadId.value = undefined
    }
  }

  return {
    archivedThreadList,
    archivedThreads,
    archivedThreadsByProject,
    errorMessage,
    loadArchivedThreads,
    loading,
    projectGroups,
    restoreThread,
    restoringThreadId
  }
})
