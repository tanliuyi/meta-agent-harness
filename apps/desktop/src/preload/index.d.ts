/**
 * 本文件通过 preload 暴露受控的 renderer API。
 */
export interface WindowControlApi {
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  platform: () => Promise<NodeJS.Platform>
}

export interface FileSystemApi {
  getPathForFile: (file: File) => string
}

export interface MetaAgentApi {
  codingAgent: import('@shared/coding-agent/types').CodingAgentApi
  fileSystem: FileSystemApi
  runtime: {
    platform: NodeJS.Platform
  }
  windowControl: WindowControlApi
}

declare global {
  interface Window {
    api: MetaAgentApi
  }
}

export {}
