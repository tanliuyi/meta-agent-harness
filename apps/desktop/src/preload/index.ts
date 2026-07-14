/**
 * 本文件通过 preload 暴露受控的 renderer API。
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AGUIEvent } from '@ag-ui/core'
import type { CodingAgentApi, CodingAgentIpcEvent } from '@shared/coding-agent/types'
import { codingAgentChannels } from '@shared/coding-agent/channels'
import { unwrapIpcResult } from '@shared/coding-agent/ipc-contract'
import {
  assertPromptImageBytes,
  assertPromptImageCount,
  assertPromptImagePayload,
  assertPromptImageTotalBytes
} from '@shared/coding-agent/prompt-image-limits'
import { updaterChannels, type UpdaterApi, type UpdaterState } from '@shared/updater'
import { browserPreviewChannels, type BrowserPreviewApi } from '@shared/browser-preview'

/**
 * 窗口控制 API 类型。
 */
interface WindowControlApi {
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  platform: () => Promise<NodeJS.Platform>
}

/**
 * 受控文件系统 API。
 */
interface FileSystemApi {
  getPathForFile: (file: File) => string
}

/**
 * 渲染进程启动时即可同步读取的运行时信息。
 */
interface RuntimeApi {
  platform: NodeJS.Platform
}

/**
 * 调用 main IPC 并解包结构化结果。
 * @param channel - IPC channel。
 * @param args - 参数。
 * @returns 成功值。
 */
async function invokeCodingAgent<T>(channel: string, ...args: unknown[]): Promise<T> {
  const startedAt = Date.now()
  let attempt = 0

  while (true) {
    try {
      return unwrapIpcResult(await ipcRenderer.invoke(channel, ...args))
    } catch (error) {
      if (!isMissingHandlerError(error) || Date.now() - startedAt > 5000) {
        throw error
      }
      await delay(Math.min(25 * 2 ** attempt, 200))
      attempt += 1
    }
  }
}

function isMissingHandlerError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('No handler registered')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function invokePromptInput<T>(channel: string, input: T & object): Promise<void> {
  assertPromptImagePayload(input)
  return invokeCodingAgent(channel, input)
}

function assertPromptImageFiles(files: File[]): void {
  assertPromptImageCount(files.length)
  let totalBytes = 0
  for (const file of files) {
    assertPromptImageBytes(file.size, file.name || '图片')
    totalBytes += file.size
    assertPromptImageTotalBytes(totalBytes)
  }
}

/**
 * 暴露给渲染进程的 Coding Agent IPC API 实现。
 * 通过 ipcRenderer.invoke/on 与 main 进程通信。
 */
const codingAgent: CodingAgentApi = {
  listProjects: () => invokeCodingAgent(codingAgentChannels.listProjects),
  createProject: () => invokeCodingAgent(codingAgentChannels.createProject),
  openProject: (projectId) => invokeCodingAgent(codingAgentChannels.openProject, projectId),
  getProject: (projectId) => invokeCodingAgent(codingAgentChannels.getProject, projectId),
  renameProject: (input) => invokeCodingAgent(codingAgentChannels.renameProject, input),
  deleteProject: (projectId) => invokeCodingAgent(codingAgentChannels.deleteProject, projectId),
  setProjectTrust: (input) => invokeCodingAgent(codingAgentChannels.setProjectTrust, input),
  createThread: (input) => invokeCodingAgent(codingAgentChannels.createThread, input),
  stopThread: (threadId) => invokeCodingAgent(codingAgentChannels.stopThread, threadId),
  restartThread: (threadId) => invokeCodingAgent(codingAgentChannels.restartThread, threadId),
  listThreads: (input) => invokeCodingAgent(codingAgentChannels.listThreads, input),
  getThread: (threadId) => invokeCodingAgent(codingAgentChannels.getThread, threadId),
  getSnapshot: (threadId) => invokeCodingAgent(codingAgentChannels.getSnapshot, threadId),
  connectAgent: (input) => invokeCodingAgent(codingAgentChannels.connectAgent, input),
  disconnectAgent: (input) => invokeCodingAgent(codingAgentChannels.disconnectAgent, input),
  /** @deprecated 使用 connectAgent。 */
  openSessionMessageFeed: (input) =>
    invokeCodingAgent(codingAgentChannels.openSessionMessageFeed, input),
  /** @deprecated 使用 disconnectAgent。 */
  closeSessionMessageFeed: () => invokeCodingAgent(codingAgentChannels.closeSessionMessageFeed),
  runAgent: (input) => invokeCodingAgent(codingAgentChannels.runAgent, input),
  /** @deprecated 使用 runAgent。 */
  prompt: (input) => invokePromptInput(codingAgentChannels.prompt, input),
  steer: (input) => invokePromptInput(codingAgentChannels.steer, input),
  followUp: (input) => invokePromptInput(codingAgentChannels.followUp, input),
  selectPromptImages: () => invokeCodingAgent(codingAgentChannels.selectPromptImages),
  processPromptImageFiles: (files) => {
    assertPromptImageFiles(files)
    const paths = files.map((file) => webUtils.getPathForFile(file)).filter(Boolean)
    if (paths.length !== files.length) {
      return Promise.reject(new Error('无法获取拖拽图片的可信本地路径'))
    }
    return invokeCodingAgent(codingAgentChannels.processPromptImageFiles, paths)
  },
  stagePromptImages: (images) => {
    assertPromptImagePayload({ images })
    return invokeCodingAgent(codingAgentChannels.stagePromptImages, images)
  },
  selectResourcePath: (input) => invokeCodingAgent(codingAgentChannels.selectResourcePath, input),
  selectSessionFile: (input) => invokeCodingAgent(codingAgentChannels.selectSessionFile, input),
  revealResourcePath: (input) => invokeCodingAgent(codingAgentChannels.revealResourcePath, input),
  openChangedFile: (input) => invokeCodingAgent(codingAgentChannels.openChangedFile, input),
  completeFileReference: (input) =>
    invokeCodingAgent(codingAgentChannels.completeFileReference, input),
  abort: (threadId) => invokeCodingAgent(codingAgentChannels.abort, threadId),
  newSession: (input) => invokeCodingAgent(codingAgentChannels.newSession, input),
  switchSession: (input) => invokeCodingAgent(codingAgentChannels.switchSession, input),
  importSession: (input) => invokeCodingAgent(codingAgentChannels.importSession, input),
  exportSession: (input) => invokeCodingAgent(codingAgentChannels.exportSession, input),
  fork: (input) => invokeCodingAgent(codingAgentChannels.fork, input),
  forkThread: (input) => invokeCodingAgent(codingAgentChannels.forkThread, input),
  clone: (threadId) => invokeCodingAgent(codingAgentChannels.clone, threadId),
  navigateTree: (input) => invokeCodingAgent(codingAgentChannels.navigateTree, input),
  loadSessionTreeChildren: (input) =>
    invokeCodingAgent(codingAgentChannels.loadSessionTreeChildren, input),
  loadSessionTreeBranches: (input) =>
    invokeCodingAgent(codingAgentChannels.loadSessionTreeBranches, input),
  loadSessionTreePath: (input) => invokeCodingAgent(codingAgentChannels.loadSessionTreePath, input),
  setSessionEntryLabel: (input) =>
    invokeCodingAgent(codingAgentChannels.setSessionEntryLabel, input),
  setThreadTitle: (input) => invokeCodingAgent(codingAgentChannels.setThreadTitle, input),
  renameThread: (input) => invokeCodingAgent(codingAgentChannels.renameThread, input),
  archiveThread: (threadId) => invokeCodingAgent(codingAgentChannels.archiveThread, threadId),
  restoreThread: (threadId) => invokeCodingAgent(codingAgentChannels.restoreThread, threadId),
  listModels: (threadId) => invokeCodingAgent(codingAgentChannels.listModels, threadId),
  setModel: (input) => invokeCodingAgent(codingAgentChannels.setModel, input),
  cycleModel: (threadId) => invokeCodingAgent(codingAgentChannels.cycleModel, threadId),
  setThinkingLevel: (input) => invokeCodingAgent(codingAgentChannels.setThinkingLevel, input),
  cycleThinkingLevel: (threadId) =>
    invokeCodingAgent(codingAgentChannels.cycleThinkingLevel, threadId),
  compact: (input) => invokeCodingAgent(codingAgentChannels.compact, input),
  setAutoCompaction: (input) => invokeCodingAgent(codingAgentChannels.setAutoCompaction, input),
  setAutoRetry: (input) => invokeCodingAgent(codingAgentChannels.setAutoRetry, input),
  abortRetry: (threadId) => invokeCodingAgent(codingAgentChannels.abortRetry, threadId),
  getCommands: (threadId) => invokeCodingAgent(codingAgentChannels.getCommands, threadId),
  runCommand: (input) => invokeCodingAgent(codingAgentChannels.runCommand, input),
  syncExtensionEditorText: (input) =>
    invokeCodingAgent(codingAgentChannels.syncExtensionEditorText, input),
  dispatchExtensionShortcut: (input) =>
    invokeCodingAgent(codingAgentChannels.dispatchExtensionShortcut, input),
  respondUi: (input) => invokeCodingAgent(codingAgentChannels.respondUi, input),
  sendExtensionPanelMessage: (input) =>
    invokeCodingAgent(codingAgentChannels.sendExtensionPanelMessage, input),
  sendExtensionPanelLifecycleEvent: (input) =>
    invokeCodingAgent(codingAgentChannels.sendExtensionPanelLifecycleEvent, input),
  saveExtensionPanelState: (input) =>
    invokeCodingAgent(codingAgentChannels.saveExtensionPanelState, input),
  disposeExtensionPanel: (input) =>
    invokeCodingAgent(codingAgentChannels.disposeExtensionPanel, input),
  openExternalUrl: (input) => invokeCodingAgent(codingAgentChannels.openExternalUrl, input),
  respondApproval: (input) => invokeCodingAgent(codingAgentChannels.respondApproval, input),
  listDiagnostics: (input) => invokeCodingAgent(codingAgentChannels.listDiagnostics, input),
  getModelSettings: () => invokeCodingAgent(codingAgentChannels.getModelSettings),
  updateModelSettings: (input) => invokeCodingAgent(codingAgentChannels.updateModelSettings, input),
  listModelRegistry: () => invokeCodingAgent(codingAgentChannels.listModelRegistry),
  listProviderCredentials: () => invokeCodingAgent(codingAgentChannels.listProviderCredentials),
  listModelDiagnostics: () => invokeCodingAgent(codingAgentChannels.listModelDiagnostics),
  listCustomProviders: () => invokeCodingAgent(codingAgentChannels.listCustomProviders),
  upsertCustomProvider: (input) =>
    invokeCodingAgent(codingAgentChannels.upsertCustomProvider, input),
  deleteCustomProvider: (provider) =>
    invokeCodingAgent(codingAgentChannels.deleteCustomProvider, provider),
  setProviderApiKey: (input) => invokeCodingAgent(codingAgentChannels.setProviderApiKey, input),
  loginProviderOAuth: (input) => invokeCodingAgent(codingAgentChannels.loginProviderOAuth, input),
  respondModelOAuthPrompt: (input) =>
    invokeCodingAgent(codingAgentChannels.respondModelOAuthPrompt, input),
  refreshModelRegistry: () => invokeCodingAgent(codingAgentChannels.refreshModelRegistry),
  getDesktopUiPreferences: () => invokeCodingAgent(codingAgentChannels.getDesktopUiPreferences),
  updateDesktopUiPreferences: (input) =>
    invokeCodingAgent(codingAgentChannels.updateDesktopUiPreferences, input),
  getAgentSettings: () => invokeCodingAgent(codingAgentChannels.getAgentSettings),
  updateAgentSettings: (input) => invokeCodingAgent(codingAgentChannels.updateAgentSettings, input),
  getResourceSnapshot: (input) => invokeCodingAgent(codingAgentChannels.getResourceSnapshot, input),
  getHermesMemorySnapshot: (input) =>
    invokeCodingAgent(codingAgentChannels.getHermesMemorySnapshot, input),
  mutateHermesMemory: (input) => invokeCodingAgent(codingAgentChannels.mutateHermesMemory, input),
  getProjectExtensionPaths: (input) =>
    invokeCodingAgent(codingAgentChannels.getProjectExtensionPaths, input),
  updateProjectExtensionPaths: (input) =>
    invokeCodingAgent(codingAgentChannels.updateProjectExtensionPaths, input),
  listResourcePackages: (input) =>
    invokeCodingAgent(codingAgentChannels.listResourcePackages, input),
  addResourcePackage: (input) => invokeCodingAgent(codingAgentChannels.addResourcePackage, input),
  installResourcePackage: (input) =>
    invokeCodingAgent(codingAgentChannels.installResourcePackage, input),
  removeResourcePackage: (input) =>
    invokeCodingAgent(codingAgentChannels.removeResourcePackage, input),
  updateResourcePackage: (input) =>
    invokeCodingAgent(codingAgentChannels.updateResourcePackage, input),
  onEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: CodingAgentIpcEvent): void =>
      listener(payload)
    ipcRenderer.send(codingAgentChannels.event, 'subscribe')
    ipcRenderer.on(codingAgentChannels.event, handler)
    return () => {
      ipcRenderer.off(codingAgentChannels.event, handler)
      ipcRenderer.send(codingAgentChannels.event, 'unsubscribe')
    }
  },
  onAgentEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AGUIEvent): void =>
      listener(payload)
    ipcRenderer.on(codingAgentChannels.agentEvent, handler)
    return () => ipcRenderer.off(codingAgentChannels.agentEvent, handler)
  },
  /** @deprecated 使用 onAgentEvent。 */
  onSessionAgentEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AGUIEvent): void =>
      listener(payload)
    ipcRenderer.on(codingAgentChannels.sessionAgentEvent, handler)
    return () => ipcRenderer.off(codingAgentChannels.sessionAgentEvent, handler)
  }
}

const windowControl: WindowControlApi = {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  platform: () => ipcRenderer.invoke('window:platform')
}

const fileSystem: FileSystemApi = {
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  }
}

/**
 * 注入到 window 的受控 API 集合。
 */
const runtime: RuntimeApi = {
  platform: process.platform
}

const updater: UpdaterApi = {
  getState: () => ipcRenderer.invoke(updaterChannels.getState),
  check: () => ipcRenderer.invoke(updaterChannels.check),
  download: () => ipcRenderer.invoke(updaterChannels.download),
  install: () => ipcRenderer.invoke(updaterChannels.install),
  onStateChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, nextState: UpdaterState): void =>
      listener(nextState)
    ipcRenderer.on(updaterChannels.stateChanged, handler)
    return () => ipcRenderer.off(updaterChannels.stateChanged, handler)
  }
}

const browserPreview: BrowserPreviewApi = {
  navigate: (input) => ipcRenderer.invoke(browserPreviewChannels.navigate, input),
  setEmulation: (input) => ipcRenderer.invoke(browserPreviewChannels.setEmulation, input),
  sendCdpCommand: (input) => ipcRenderer.invoke(browserPreviewChannels.sendCdpCommand, input),
  readCdpEvents: (input) => ipcRenderer.invoke(browserPreviewChannels.readCdpEvents, input),
  onOpenRequested: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      request: Parameters<typeof listener>[0]
    ): void => listener(request)
    ipcRenderer.on(browserPreviewChannels.openRequested, handler)
    return () => ipcRenderer.off(browserPreviewChannels.openRequested, handler)
  },
  onPermissionRequested: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      request: Parameters<typeof listener>[0]
    ): void => listener(request)
    ipcRenderer.on(browserPreviewChannels.permissionRequested, handler)
    return () => ipcRenderer.off(browserPreviewChannels.permissionRequested, handler)
  },
  respondPermission: (input) => ipcRenderer.invoke(browserPreviewChannels.respondPermission, input)
}

const api = { browserPreview, codingAgent, fileSystem, runtime, updater, windowControl }

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore（在 dts 中定义）
  window.api = api
}
