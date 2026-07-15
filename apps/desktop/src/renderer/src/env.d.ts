/**
 * env.d.ts - renderer 构建环境类型声明。
 *
 * @description
 * 为 Vite 客户端环境提供 TypeScript 类型声明。
 */

/// <reference types="vite/client" />

interface Window {
  api: {
    browserPreview: import('@shared/browser-preview').BrowserPreviewApi
    codingAgent: import('@shared/coding-agent/types').CodingAgentApi
    fileSystem: {
      getPathForFile: (file: File) => string
    }
    runtime: {
      platform: NodeJS.Platform
    }
    updater: import('@shared/updater').UpdaterApi
    windowControl: {
      minimize: () => Promise<void>
      maximize: () => Promise<void>
      close: () => Promise<void>
      isMaximized: () => Promise<boolean>
      platform: () => Promise<NodeJS.Platform>
    }
  }
}
