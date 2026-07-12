/**
 * useWorkspaceViewSettings.ts - 管理工作区视图相关偏好。
 *
 * Thread 排序模式属于全局 UI 偏好，持久化到 Desktop 配置。
 */

import type { ThreadSortMode } from '@shared/coding-agent/types'
import { readonly, ref, watch } from 'vue'
import type { WatchStopHandle } from 'vue'
import { queueDesktopUiPreferencesUpdate } from './desktopUiPreferencesSync'

export type { ThreadSortMode } from '@shared/coding-agent/types'

/** localStorage 中存储 thread 排序模式的键名，用于迁移与降级。 */
const threadSortModeStorageKey = 'meta-agent.workspace.thread-sort-mode'

/** 可选的 thread 排序模式。 */
export const threadSortModeOptions: Array<{ label: string; value: ThreadSortMode }> = [
  { label: '最近活动', value: 'recent' },
  { label: 'Fork 层级', value: 'threaded' }
]

/** 当前 thread 排序模式。 */
const threadSortMode = ref<ThreadSortMode>(readStoredThreadSortMode())

/** 是否已完成初始化。 */
let isInitialized = false

/** 是否已完成 Desktop 配置读取。 */
let hasLoadedDesktopPreferences = false

let threadSortModeGeneration = 0
let stopThreadSortModeWatch: WatchStopHandle | undefined

function isThreadSortMode(value: unknown): value is ThreadSortMode {
  return value === 'recent' || value === 'threaded'
}

/** 从旧版 localStorage 缓存读取 thread 排序模式。 */
function readStoredThreadSortMode(): ThreadSortMode {
  if (typeof window === 'undefined') return 'recent'
  const stored = window.localStorage.getItem(threadSortModeStorageKey)
  return isThreadSortMode(stored) ? stored : 'recent'
}

function cacheThreadSortMode(): void {
  window.localStorage.setItem(threadSortModeStorageKey, threadSortMode.value)
}

function queueThreadSortModeUpdate(): void {
  queueDesktopUiPreferencesUpdate({
    workspace: { threadSortMode: threadSortMode.value }
  })
}

async function hydrateDesktopPreferences(): Promise<void> {
  const generationAtStart = threadSortModeGeneration
  const hasCachedMode = isThreadSortMode(window.localStorage.getItem(threadSortModeStorageKey))
  try {
    const preferences = await window.api?.codingAgent.getDesktopUiPreferences?.()
    const storedMode = preferences?.workspace?.threadSortMode
    if (isThreadSortMode(storedMode) && threadSortModeGeneration === generationAtStart) {
      threadSortMode.value = storedMode
    }
    hasLoadedDesktopPreferences = true
    cacheThreadSortMode()
    if (
      threadSortModeGeneration !== generationAtStart ||
      (!isThreadSortMode(storedMode) && hasCachedMode)
    ) {
      queueThreadSortModeUpdate()
    }
  } catch {
    hasLoadedDesktopPreferences = true
    if (threadSortModeGeneration !== generationAtStart) {
      queueThreadSortModeUpdate()
    }
  }
}

/** 设置 thread 排序模式。 */
function setThreadSortMode(value: ThreadSortMode): void {
  threadSortMode.value = value
  threadSortModeGeneration += 1
  cacheThreadSortMode()
  if (hasLoadedDesktopPreferences) {
    queueThreadSortModeUpdate()
  }
}

/** 组合式函数：提供工作区视图偏好读取与更新能力。 */
export function useWorkspaceViewSettings(): {
  setThreadSortMode: typeof setThreadSortMode
  threadSortMode: Readonly<typeof threadSortMode>
  threadSortModeOptions: typeof threadSortModeOptions
} {
  if (!isInitialized && typeof window !== 'undefined') {
    isInitialized = true

    void hydrateDesktopPreferences().catch(() => {
      // hydrateDesktopPreferences 已处理预期错误；这里确保未来改动不会泄漏 rejection。
    })

    stopThreadSortModeWatch = watch(
      threadSortMode,
      () => {
        cacheThreadSortMode()
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

export function resetWorkspaceViewSettingsForTest(): void {
  stopThreadSortModeWatch?.()
  stopThreadSortModeWatch = undefined
  isInitialized = false
  hasLoadedDesktopPreferences = false
  threadSortModeGeneration = 0
  threadSortMode.value = readStoredThreadSortMode()
}
