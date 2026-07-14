/**
 * env.d.ts - renderer 构建环境类型声明。
 *
 * @description
 * 为 Vite 客户端环境及 *.vue 单文件组件提供 TypeScript 类型声明。
 */

/// <reference types="vite/client" />

/**
 * 所有 .vue 单文件组件的模块声明。
 * 默认导出一个符合 Vue DefineComponent 类型的组件实例。
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  /** 导入的 Vue 组件定义。 */
  const component: DefineComponent<object, object, unknown>
  export default component
}

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
