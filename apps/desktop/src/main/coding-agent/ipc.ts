/**
 * 本文件注册 desktop coding agent 后端 IPC handlers。
 */

import { app, ipcMain, type WebContents } from 'electron'
import { join } from 'node:path'
import { codingAgentChannels } from '../../shared/coding-agent/channels'
import { CodingThreadManager } from './thread-manager'
import { CodingThreadStore } from './thread-store'
import { createStdioWorkerClient } from './worker-client-factory'
import { WorkerPool } from './worker-pool'
import type { WorkerClient, WorkerEnvelope } from './worker-types'
import type { CodingAgentIpcEvent } from '../../shared/coding-agent/types'

/**
 * Coding agent IPC 注册选项。
 */
export interface CodingAgentIpcOptions {
  /** 可选的 CodingThreadManager 实例，用于复用现有管理器。 */
  manager?: CodingThreadManager
  /** 创建 worker 客户端的工厂函数。 */
  createWorker?: () => Promise<WorkerClient>
  /** 最大 worker 数量。 */
  maxWorkers?: number
}

/**
 * 注册 desktop coding agent 后端 IPC 处理器。
 * @param options - IPC 注册选项。
 * @returns 创建的 CodingThreadManager 实例。
 */
export function registerCodingAgentIpc(options: CodingAgentIpcOptions = {}): CodingThreadManager {
  const subscribers = new Set<WebContents>()
  const store = new CodingThreadStore(join(app.getPath('userData'), 'meta-agent.db'))
  const manager =
    options.manager ??
    new CodingThreadManager(
      new WorkerPool({
        maxWorkers: options.maxWorkers ?? 1,
        createWorker: options.createWorker ?? createStdioWorkerClient,
        onEvent: (event) => {
          const ipcEvent = toIpcEvent(event)
          if (!ipcEvent) {
            return
          }
          for (const webContents of subscribers) {
            if (!webContents.isDestroyed()) {
              webContents.send(codingAgentChannels.event, ipcEvent)
            }
          }
        }
      }),
      store
    )

  ipcMain.handle(codingAgentChannels.createThread, (_event, input) => manager.createThread(input))
  ipcMain.handle(codingAgentChannels.stopThread, (_event, threadId: string) =>
    manager.stopThread(threadId)
  )
  ipcMain.handle(codingAgentChannels.restartThread, (_event, threadId: string) =>
    manager.restartThread(threadId)
  )
  ipcMain.handle(codingAgentChannels.listThreads, () => manager.listThreads())
  ipcMain.handle(codingAgentChannels.getThread, (_event, threadId: string) =>
    manager.getThread(threadId)
  )
  ipcMain.handle(codingAgentChannels.getSnapshot, (_event, threadId: string) =>
    manager.getSnapshot(threadId)
  )
  ipcMain.handle(codingAgentChannels.prompt, (_event, input) => manager.prompt(input))
  ipcMain.handle(codingAgentChannels.steer, (_event, input) => manager.steer(input))
  ipcMain.handle(codingAgentChannels.followUp, (_event, input) => manager.followUp(input))
  ipcMain.handle(codingAgentChannels.abort, (_event, threadId: string) => manager.abort(threadId))
  ipcMain.handle(codingAgentChannels.newSession, (_event, input) => manager.newSession(input))
  ipcMain.handle(codingAgentChannels.switchSession, (_event, input) => manager.switchSession(input))
  ipcMain.handle(codingAgentChannels.importSession, (_event, input) => manager.importSession(input))
  ipcMain.handle(codingAgentChannels.exportSession, (_event, input) => manager.exportSession(input))
  ipcMain.handle(codingAgentChannels.fork, (_event, input) => manager.fork(input))
  ipcMain.handle(codingAgentChannels.clone, (_event, threadId: string) => manager.clone(threadId))
  ipcMain.handle(codingAgentChannels.renameThread, (_event, input) => manager.renameThread(input))
  ipcMain.handle(codingAgentChannels.archiveThread, (_event, threadId: string) =>
    manager.archiveThread(threadId)
  )
  ipcMain.handle(codingAgentChannels.listModels, (_event, threadId: string) =>
    manager.listModels(threadId)
  )
  ipcMain.handle(codingAgentChannels.setModel, (_event, input) => manager.setModel(input))
  ipcMain.handle(codingAgentChannels.cycleModel, (_event, threadId: string) =>
    manager.cycleModel(threadId)
  )
  ipcMain.handle(codingAgentChannels.setThinkingLevel, (_event, input) =>
    manager.setThinkingLevel(input)
  )
  ipcMain.handle(codingAgentChannels.cycleThinkingLevel, (_event, threadId: string) =>
    manager.cycleThinkingLevel(threadId)
  )
  ipcMain.handle(codingAgentChannels.compact, (_event, input) => manager.compact(input))
  ipcMain.handle(codingAgentChannels.setAutoCompaction, (_event, input) =>
    manager.setAutoCompaction(input)
  )
  ipcMain.handle(codingAgentChannels.setAutoRetry, (_event, input) => manager.setAutoRetry(input))
  ipcMain.handle(codingAgentChannels.abortRetry, (_event, threadId: string) =>
    manager.abortRetry(threadId)
  )
  ipcMain.handle(codingAgentChannels.getCommands, (_event, threadId: string) =>
    manager.getCommands(threadId)
  )
  ipcMain.handle(codingAgentChannels.runCommand, (_event, input) => manager.runCommand(input))
  ipcMain.handle(codingAgentChannels.respondUi, (_event, input) => manager.respondUi(input))
  ipcMain.handle(codingAgentChannels.respondApproval, (_event, input) =>
    manager.respondApproval(input)
  )
  ipcMain.on(codingAgentChannels.event, (event, action: 'subscribe' | 'unsubscribe') => {
    if (action === 'subscribe') {
      subscribers.add(event.sender)
      event.sender.once('destroyed', () => subscribers.delete(event.sender))
      return
    }
    subscribers.delete(event.sender)
  })
  app.once('before-quit', () => {
    void manager.shutdown()
    store.close()
  })

  return manager
}

/**
 * 将 worker 信封转换为 IPC 事件。
 * @param event - worker 信封。
 * @returns 对应的 IPC 事件；若无法转换则返回 undefined。
 */
function toIpcEvent(event: WorkerEnvelope): CodingAgentIpcEvent | undefined {
  if (event.kind !== 'event') {
    return undefined
  }
  if (event.eventType === 'canonical' && typeof event.threadId === 'string') {
    return { type: 'canonical', threadId: event.threadId, event: event.event }
  }
  if (event.eventType === 'projection' && typeof event.threadId === 'string') {
    return { type: 'projection', threadId: event.threadId, event: event.event }
  }
  if (event.eventType === 'worker') {
    return {
      type: 'worker',
      threadId: typeof event.threadId === 'string' ? event.threadId : undefined,
      event: event.event
    }
  }
  return undefined
}
