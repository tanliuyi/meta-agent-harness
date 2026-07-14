/**
 * app.ts - 应用级基础状态管理。
 */

import { defineStore } from 'pinia'
import { runtimeApi, windowControlApi } from '@renderer/api'

/**
 * 读取 preload 注入的同步运行时信息；测试或降级环境没有注入时返回 null。
 */
function getInitialPlatform(): string | null {
  return runtimeApi?.platform ?? null
}

function applyPlatformAttribute(platform: string | null): void {
  if (!platform) return
  document.documentElement.dataset.platform = platform
}

/**
 * 应用级 Store。
 * 提供应用名称、运行平台等全局基础状态。
 */
export const useAppStore = defineStore('app', {
  state: () => ({
    /** 应用名称。 */
    name: 'Meta Agent',

    /** 当前运行平台。 */
    platform: getInitialPlatform()
  }),
  getters: {
    /** 是否运行在 macOS。 */
    isMac: (state) => state.platform === 'darwin'
  },
  actions: {
    /**
     * 初始化 renderer 运行时基础信息。
     */
    async initializeRuntime(): Promise<void> {
      if (this.platform) {
        applyPlatformAttribute(this.platform)
        return
      }

      this.platform = await windowControlApi.platform()
      applyPlatformAttribute(this.platform)
    }
  }
})
