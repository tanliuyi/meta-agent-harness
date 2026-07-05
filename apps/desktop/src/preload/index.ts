/**
 * 本文件通过 preload 暴露受控的 renderer API。
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { CodingAgentApi, CodingAgentIpcEvent } from '@shared/coding-agent/types'
import { codingAgentChannels } from '@shared/coding-agent/channels'
import { unwrapIpcResult } from '@shared/coding-agent/ipc-contract'

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
 * 调用 main IPC 并解包结构化结果。
 * @param channel - IPC channel。
 * @param args - 参数。
 * @returns 成功值。
 */
async function invokeCodingAgent<T>(channel: string, ...args: unknown[]): Promise<T> {
  return unwrapIpcResult(await ipcRenderer.invoke(channel, ...args))
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
  setProjectTrust: (input) => invokeCodingAgent(codingAgentChannels.setProjectTrust, input),
  createThread: (input) => invokeCodingAgent(codingAgentChannels.createThread, input),
  stopThread: (threadId) => invokeCodingAgent(codingAgentChannels.stopThread, threadId),
  restartThread: (threadId) => invokeCodingAgent(codingAgentChannels.restartThread, threadId),
  listThreads: (input) => invokeCodingAgent(codingAgentChannels.listThreads, input),
  getThread: (threadId) => invokeCodingAgent(codingAgentChannels.getThread, threadId),
  getSnapshot: (threadId) => invokeCodingAgent(codingAgentChannels.getSnapshot, threadId),
  prompt: (input) => invokeCodingAgent(codingAgentChannels.prompt, input),
  steer: (input) => invokeCodingAgent(codingAgentChannels.steer, input),
  followUp: (input) => invokeCodingAgent(codingAgentChannels.followUp, input),
  selectPromptImages: () => invokeCodingAgent(codingAgentChannels.selectPromptImages),
  stagePromptImages: (images) => invokeCodingAgent(codingAgentChannels.stagePromptImages, images),
  selectResourcePath: (input) => invokeCodingAgent(codingAgentChannels.selectResourcePath, input),
  selectSessionFile: (input) => invokeCodingAgent(codingAgentChannels.selectSessionFile, input),
  revealResourcePath: (input) => invokeCodingAgent(codingAgentChannels.revealResourcePath, input),
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
  setSessionEntryLabel: (input) => invokeCodingAgent(codingAgentChannels.setSessionEntryLabel, input),
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
  respondUi: (input) => invokeCodingAgent(codingAgentChannels.respondUi, input),
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
  getAgentSettings: () => invokeCodingAgent(codingAgentChannels.getAgentSettings),
  updateAgentSettings: (input) => invokeCodingAgent(codingAgentChannels.updateAgentSettings, input),
  getResourceSnapshot: () => invokeCodingAgent(codingAgentChannels.getResourceSnapshot),
  listResourcePackages: () => invokeCodingAgent(codingAgentChannels.listResourcePackages),
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
  }
}

const windowControl: WindowControlApi = {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  platform: () => ipcRenderer.invoke('window:platform')
}

/**
 * 注入到 window 的受控 API 集合。
 */
const api = { codingAgent, windowControl }

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
