/**
 * useWorkspaceViewSettings.ts - 管理工作区视图相关偏好。
 *
 * Thread 排序模式（recent / threaded）属于全局 UI 偏好，持久化到 localStorage。
 */

import { readonly, ref, watch } from 'vue'

/** Thread 排序模式。 */
export type ThreadSortMode = 'recent' | 'threaded'

/** localStorage 中存储 thread 排序模式的键名。 */
const threadSortModeStorageKey = 'meta-agent.workspace.thread-sort-mode'

/** 可选的 thread 排序模式。 */
export const threadSortModeOptions: Array<{ label: string; value: ThreadSortMode }> = [
  { label: 'Recent', value: 'recent' },
  { label: 'Threaded', value: 'threaded' }
]

/** 当前 thread 排序模式。 */
const threadSortMode = ref<ThreadSortMode>(readStoredThreadSortMode())

/** 是否已完成初始化。 */
let isInitialized = false

/**
 * 从 localStorage 读取 thread 排序模式。
 * @returns 存储的排序模式，无效或不存在时返回 'recent'。
 */
function readStoredThreadSortMode(): ThreadSortMode {
  if (typeof window === 'undefined') {
    return 'recent'
  }

  const stored = window.localStorage.getItem(threadSortModeStorageKey)
  if (stored === 'recent' || stored === 'threaded') {
    return stored
  }
  return 'recent'
}

/**
 * 设置 thread 排序模式。
 * @param value - 目标排序模式。
 */
function setThreadSortMode(value: ThreadSortMode): void {
  threadSortMode.value = value
}

/**
 * 组合式函数：提供工作区视图偏好读取与更新能力。
 * @returns 工作区视图偏好相关状态与方法。
 */
export function useWorkspaceViewSettings(): {
  setThreadSortMode: typeof setThreadSortMode
  threadSortMode: Readonly<typeof threadSortMode>
  threadSortModeOptions: typeof threadSortModeOptions
} {
  if (!isInitialized && typeof window !== 'undefined') {
    isInitialized = true

    watch(
      threadSortMode,
      (next) => {
        window.localStorage.setItem(threadSortModeStorageKey, next)
      },
      { immediate: true }
    )
  }

  return {
    setThreadSortMode,
    threadSortMode: readonly(threadSortMode),
    threadSortModeOptions
  }
}
