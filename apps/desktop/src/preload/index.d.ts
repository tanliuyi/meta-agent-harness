/**
 * 本文件声明 preload 注入到 renderer 的全局 API。
 */

import type { CodingAgentApi } from '@shared/coding-agent/types'

/**
 * Window 接口：声明 preload 脚本挂载到全局 window 的属性。
 */
declare global {
  interface Window {
    /** 应用自定义 API 入口。 */
    api: {
      /** Coding Agent 相关 IPC API。 */
      codingAgent: CodingAgentApi
    }
  }
}
