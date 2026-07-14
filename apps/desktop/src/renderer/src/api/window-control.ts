/**
 * window-control.ts - Window Control API 封装
 *
 * 统一封装 window.api.windowControl 的所有调用，提供类型安全的 API 接口。
 */

/** Window Control API 封装 */
export const windowControlApi = {
  /** 最小化窗口 */
  minimize(): Promise<void> {
    return window.api.windowControl.minimize()
  },

  /** 最大化窗口 */
  maximize(): Promise<void> {
    return window.api.windowControl.maximize()
  },

  /** 关闭窗口 */
  close(): Promise<void> {
    return window.api.windowControl.close()
  },

  /** 获取窗口是否最大化 */
  isMaximized(): Promise<boolean> {
    return window.api.windowControl.isMaximized()
  },

  /** 获取平台信息 */
  platform(): Promise<NodeJS.Platform> {
    return window.api.windowControl.platform() as Promise<NodeJS.Platform>
  }
}
