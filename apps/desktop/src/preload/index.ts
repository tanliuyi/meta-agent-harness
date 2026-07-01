/**
 * 本文件通过 preload 暴露受控的 renderer API。
 */

import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { CodingAgentApi, CodingAgentIpcEvent } from '../shared/coding-agent/types'
import { codingAgentChannels } from '../shared/coding-agent/channels'

/**
 * 暴露给渲染进程的 Coding Agent IPC API 实现。
 * 通过 ipcRenderer.invoke/on 与 main 进程通信。
 */
const codingAgent: CodingAgentApi = {
  createThread: (input) => ipcRenderer.invoke(codingAgentChannels.createThread, input),
  stopThread: (threadId) => ipcRenderer.invoke(codingAgentChannels.stopThread, threadId),
  restartThread: (threadId) => ipcRenderer.invoke(codingAgentChannels.restartThread, threadId),
  listThreads: () => ipcRenderer.invoke(codingAgentChannels.listThreads),
  getThread: (threadId) => ipcRenderer.invoke(codingAgentChannels.getThread, threadId),
  getSnapshot: (threadId) => ipcRenderer.invoke(codingAgentChannels.getSnapshot, threadId),
  prompt: (input) => ipcRenderer.invoke(codingAgentChannels.prompt, input),
  steer: (input) => ipcRenderer.invoke(codingAgentChannels.steer, input),
  followUp: (input) => ipcRenderer.invoke(codingAgentChannels.followUp, input),
  abort: (threadId) => ipcRenderer.invoke(codingAgentChannels.abort, threadId),
  newSession: (input) => ipcRenderer.invoke(codingAgentChannels.newSession, input),
  switchSession: (input) => ipcRenderer.invoke(codingAgentChannels.switchSession, input),
  importSession: (input) => ipcRenderer.invoke(codingAgentChannels.importSession, input),
  exportSession: (input) => ipcRenderer.invoke(codingAgentChannels.exportSession, input),
  fork: (input) => ipcRenderer.invoke(codingAgentChannels.fork, input),
  clone: (threadId) => ipcRenderer.invoke(codingAgentChannels.clone, threadId),
  renameThread: (input) => ipcRenderer.invoke(codingAgentChannels.renameThread, input),
  archiveThread: (threadId) => ipcRenderer.invoke(codingAgentChannels.archiveThread, threadId),
  listModels: (threadId) => ipcRenderer.invoke(codingAgentChannels.listModels, threadId),
  setModel: (input) => ipcRenderer.invoke(codingAgentChannels.setModel, input),
  cycleModel: (threadId) => ipcRenderer.invoke(codingAgentChannels.cycleModel, threadId),
  setThinkingLevel: (input) => ipcRenderer.invoke(codingAgentChannels.setThinkingLevel, input),
  cycleThinkingLevel: (threadId) =>
    ipcRenderer.invoke(codingAgentChannels.cycleThinkingLevel, threadId),
  compact: (input) => ipcRenderer.invoke(codingAgentChannels.compact, input),
  setAutoCompaction: (input) => ipcRenderer.invoke(codingAgentChannels.setAutoCompaction, input),
  setAutoRetry: (input) => ipcRenderer.invoke(codingAgentChannels.setAutoRetry, input),
  abortRetry: (threadId) => ipcRenderer.invoke(codingAgentChannels.abortRetry, threadId),
  getCommands: (threadId) => ipcRenderer.invoke(codingAgentChannels.getCommands, threadId),
  runCommand: (input) => ipcRenderer.invoke(codingAgentChannels.runCommand, input),
  respondUi: (input) => ipcRenderer.invoke(codingAgentChannels.respondUi, input),
  respondApproval: (input) => ipcRenderer.invoke(codingAgentChannels.respondApproval, input),
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

/**
 * 注入到 window 的受控 API 集合。
 */
const api = { codingAgent }

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore（在 dts 中定义）
  window.electron = electronAPI
  // @ts-ignore（在 dts 中定义）
  window.api = api
}
