/**
 * workspace-ui.ts - 管理工作区布局 UI 状态。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { queueDesktopUiPreferencesUpdate } from '@renderer/composables/desktopUiPreferencesSync'

/** 默认边栏宽度。 */
const defaultSidebarWidth = 208

/** 边栏最小宽度。 */
const minSidebarWidth = 160

/** 边栏最大宽度。 */
const maxSidebarWidth = 420

/**
 * 限制边栏宽度在可用范围内。
 * @param width - 原始宽度。
 * @returns 合法宽度。
 */
function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return defaultSidebarWidth
  }
  return Math.min(maxSidebarWidth, Math.max(minSidebarWidth, Math.round(width)))
}

/**
 * 工作区 UI 状态 Store。
 * 管理左侧边栏的展开状态与宽度。
 */
export default defineStore(
  'workspace-ui',
  () => {
    /** 边栏是否展开。 */
    const sidebarOpen = ref(true)

    /** 边栏当前宽度（像素）。 */
    const sidebarWidth = ref(defaultSidebarWidth)

    /** 切换边栏展开状态。 */
    const toggleSidebar = (): void => {
      sidebarOpen.value = !sidebarOpen.value
    }

    /** Project 展开状态，缺失时默认展开。 */
    const projectOpenState = ref<Record<string, boolean>>({})

    /** 是否已完成 desktop 配置读取。 */
    let hasLoadedDesktopPreferences = false

    /** 用户 resize generation，不受 Pinia hydration 或 Desktop 回填影响。 */
    let sidebarWidthGeneration = 0

    const applySidebarWidth = (width: number): void => {
      sidebarWidth.value = clampSidebarWidth(width)
    }

    /**
     * 设置边栏宽度，并限制在最小/最大宽度范围内。
     * @param width - 目标宽度。
     */
    const setSidebarWidth = (width: number): void => {
      sidebarWidthGeneration += 1
      applySidebarWidth(width)
      if (hasLoadedDesktopPreferences) {
        queueSidebarWidthUpdate()
      }
    }

    /**
     * 获取 Project 是否展开；没有持久化记录时默认展开。
     * @param projectId - Project ID。
     * @returns 是否展开。
     */
    const isProjectOpen = (projectId: string): boolean => {
      return projectOpenState.value[projectId] ?? true
    }

    /**
     * 设置 Project 展开状态。
     * @param projectId - Project ID。
     * @param open - 是否展开。
     */
    const setProjectOpen = (projectId: string, open: boolean): void => {
      projectOpenState.value = {
        ...projectOpenState.value,
        [projectId]: open
      }
    }

    async function hydrateDesktopPreferences(): Promise<void> {
      const generationAtStart = sidebarWidthGeneration
      try {
        const preferences = await window.api?.codingAgent.getDesktopUiPreferences?.()
        const storedWidth = preferences?.workspace?.sidebarWidth
        if (storedWidth !== undefined && sidebarWidthGeneration === generationAtStart) {
          applySidebarWidth(storedWidth)
        }
        hasLoadedDesktopPreferences = true
        if (sidebarWidthGeneration !== generationAtStart) {
          queueSidebarWidthUpdate()
        }
      } catch {
        hasLoadedDesktopPreferences = true
        if (sidebarWidthGeneration !== generationAtStart) {
          queueSidebarWidthUpdate()
        }
      }
    }

    function queueSidebarWidthUpdate(): void {
      queueDesktopUiPreferencesUpdate({
        workspace: {
          sidebarWidth: sidebarWidth.value
        }
      })
    }

    if (typeof window !== 'undefined') {
      void hydrateDesktopPreferences().catch(() => {
        // hydrateDesktopPreferences 已处理预期错误；这里确保未来改动不会泄漏 rejection。
      })
    }

    return {
      isProjectOpen,
      maxSidebarWidth,
      minSidebarWidth,
      projectOpenState,
      setProjectOpen,
      setSidebarWidth,
      sidebarOpen,
      sidebarWidth,
      toggleSidebar
    }
  },
  {
    persist: {
      pick: ['projectOpenState', 'sidebarOpen']
    }
  }
)
