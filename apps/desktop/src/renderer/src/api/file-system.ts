/**
 * file-system.ts - File System API 封装
 *
 * 统一封装 window.api.fileSystem 的所有调用，提供类型安全的 API 接口。
 */

/** File System API 封装 */
export const fileSystemApi = {
  /** 获取文件路径 */
  getPathForFile(file: File): string {
    return window.api.fileSystem.getPathForFile(file)
  }
}
