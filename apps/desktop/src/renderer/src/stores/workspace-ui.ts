/**
 * workspace-ui.ts - 管理工作区布局 UI 状态。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

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
    const sidebarWidth = ref(208)

    /** Project 展开状态，缺失时默认展开。 */
    const projectOpenState = ref<Record<string, boolean>>({})

    /** 边栏最小宽度。 */
    const minSidebarWidth = 160

    /** 边栏最大宽度。 */
    const maxSidebarWidth = 420

    /**
     * 设置边栏宽度，并限制在最小/最大宽度范围内。
     * @param width - 目标宽度。
     */
    const setSidebarWidth = (width: number): void => {
      sidebarWidth.value = Math.min(maxSidebarWidth, Math.max(minSidebarWidth, width))
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

    return {
      isProjectOpen,
      maxSidebarWidth,
      minSidebarWidth,
      projectOpenState,
      setProjectOpen,
      setSidebarWidth,
      sidebarOpen,
      sidebarWidth
    }
  },
  {
    persist: {
      pick: ['projectOpenState', 'sidebarOpen', 'sidebarWidth']
    }
  }
)
