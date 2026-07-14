/**
 * api/index.ts - 统一 API 导出
 *
 * 集中管理所有 window.api.* 调用，提供类型安全的 API 接口。
 * 使用方式：
 *   import { codingAgentApi, updaterApi, windowControlApi } from '@renderer/api'
 */

export { codingAgentApi } from './coding-agent'
export { updaterApi } from './updater'
export { windowControlApi } from './window-control'
export { fileSystemApi } from './file-system'
export { runtimeApi } from './runtime'
