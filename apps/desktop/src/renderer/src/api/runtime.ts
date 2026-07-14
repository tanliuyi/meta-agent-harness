/**
 * runtime.ts - Runtime API 封装
 *
 * 统一封装 window.api.runtime 的所有调用，提供类型安全的 API 接口。
 */

/** Runtime API 封装 */
export const runtimeApi = {
  /** 获取平台信息 */
  get platform(): NodeJS.Platform {
    return window.api.runtime.platform
  }
}
