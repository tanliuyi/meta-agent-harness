/**
 * updater.ts - Updater API 封装
 *
 * 统一封装 window.api.updater 的所有调用，提供类型安全的 API 接口。
 */

import type { UpdaterState } from '@shared/updater'

/** Updater API 封装 */
export const updaterApi = {
  /** 获取当前更新状态 */
  getState(): Promise<UpdaterState> {
    return window.api.updater.getState()
  },

  /** 检查更新 */
  check(): Promise<void> {
    return window.api.updater.check()
  },

  /** 下载更新 */
  download(): Promise<void> {
    return window.api.updater.download()
  },

  /** 安装更新 */
  install(): Promise<void> {
    return window.api.updater.install()
  },

  /** 监听更新状态变化 */
  onStateChanged(listener: (state: UpdaterState) => void): () => void {
    return window.api.updater.onStateChanged(listener)
  }
}
