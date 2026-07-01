/**
 * 本文件声明 preload 注入到 renderer 的全局 API。
 */

import { ElectronAPI } from '@electron-toolkit/preload'
import type { CodingAgentApi } from '../shared/coding-agent/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      codingAgent: CodingAgentApi
    }
  }
}
