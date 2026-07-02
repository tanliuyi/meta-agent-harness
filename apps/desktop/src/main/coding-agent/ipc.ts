/**
 * 本文件注册 desktop coding agent 后端 IPC handlers。
 */

import { app, dialog, ipcMain, type WebContents } from 'electron'
import { codingAgentChannels } from '@shared/coding-agent/channels'
import { fail, ok } from '@shared/coding-agent/ipc-contract'
import { CodingThreadManager } from './thread-manager'
import { CodingThreadStore } from './thread-store'
import { ProjectStore } from './project-store'
import { ProjectTrustService } from './project-trust-service'
import { ModelSettingsService } from './model-settings-service'
import { AgentSettingsService } from './agent-settings-service'
import { createUtilityProcessWorkerClient } from './utility-process-worker-client-factory'
import { ThreadWorkerRegistry } from './thread-worker-registry'
import { cacheWorkerProjectionEvent } from './projection-cache'
import type { WorkerClient, WorkerEnvelope } from './worker-types'
import type { ThreadWorkerLifecycleEvent } from './thread-worker-registry'
import type {
  CodingAgentIpcEvent,
  CompactInput,
  CreateThreadInput,
  DiagnosticsInput,
  ExportSessionInput,
  ExtensionUiResponseInput,
  ForkInput,
  ImportSessionInput,
  IpcResult,
  NewSessionInput,
  PromptInput,
  ApprovalResponseInput,
  RenameProjectInput,
  RenameThreadInput,
  SetProviderApiKeyInput,
  SetProjectTrustInput,
  SetModelInput,
  SetThinkingInput,
  SwitchSessionInput,
  TextInput,
  ToggleInput,
  UpdateAgentSettingsInput,
  UpdateModelSettingsInput,
  UpsertCustomProviderInput
} from '@shared/coding-agent/types'

/**
 * Coding agent IPC 注册选项。
 */
export interface CodingAgentIpcOptions {
  /** 可选的 CodingThreadManager 实例，用于复用现有管理器。 */
  manager?: CodingThreadManager
  /** 创建 worker 客户端的工厂函数。 */
  createWorker?: () => Promise<WorkerClient>
}

/**
 * 注册 desktop coding agent 后端 IPC 处理器。
 * @param options - IPC 注册选项。
 * @returns 创建的 CodingThreadManager 实例。
 */
export function registerCodingAgentIpc(options: CodingAgentIpcOptions = {}): CodingThreadManager {
  const subscribers = new Set<WebContents>()
  const projectStore = new ProjectStore()
  const projectTrustService = new ProjectTrustService()
  const modelSettingsService = new ModelSettingsService()
  const agentSettingsService = new AgentSettingsService()
  const store = new CodingThreadStore()
  const manager =
    options.manager ??
    new CodingThreadManager(
      new ThreadWorkerRegistry({
        createWorker: options.createWorker ?? createUtilityProcessWorkerClient,
        onEvent: (event) => {
          cacheWorkerProjectionEvent(store, event)
          const ipcEvent = toCodingAgentIpcEvent(event)
          if (!ipcEvent) {
            return
          }
          publishCodingAgentEvent(subscribers, ipcEvent)
        },
        onLifecycle: (event) => {
          indexWorkerLifecycle(store, event)
          publishCodingAgentEvent(subscribers, {
            type: 'threadWorker',
            threadId: event.threadId,
            event
          })
        }
      }),
      store,
      projectStore,
      projectTrustService,
      modelSettingsService,
      agentSettingsService
    )

  handle(manager, codingAgentChannels.createProject, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 Project 目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) {
      return undefined
    }
    const project = manager.createProject({ path: result.filePaths[0] })
    publishCodingAgentEvent(subscribers, {
      type: 'project',
      event: { type: 'project.created', project }
    })
    return project
  })
  handle(manager, codingAgentChannels.openProject, (projectId: string) => {
    const project = manager.openProject(projectId)
    publishCodingAgentEvent(subscribers, {
      type: 'project',
      event: { type: 'project.opened', project }
    })
    return project
  })
  handle(manager, codingAgentChannels.getProject, (projectId: string) =>
    manager.getProject(projectId)
  )
  handle(manager, codingAgentChannels.listProjects, () => manager.listProjects())
  handle(manager, codingAgentChannels.renameProject, (input: RenameProjectInput) => {
    manager.renameProject(input)
    const project = manager.getProject(input.projectId)
    publishCodingAgentEvent(subscribers, {
      type: 'project',
      event: { type: 'project.updated', project }
    })
  })
  handle(manager, codingAgentChannels.setProjectTrust, (input: SetProjectTrustInput) => {
    const project = manager.setProjectTrust(input)
    publishCodingAgentEvent(subscribers, {
      type: 'project',
      event: { type: 'project.trustChanged', project }
    })
    return project
  })
  handle(manager, codingAgentChannels.createThread, async (input: CreateThreadInput) => {
    const snapshot = await manager.createThread(input)
    publishCodingAgentEvent(subscribers, {
      type: 'threadSnapshot',
      threadId: snapshot.threadId,
      snapshot
    })
    return snapshot
  })
  handle(manager, codingAgentChannels.stopThread, (threadId: string) =>
    manager.stopThread(threadId)
  )
  handle(manager, codingAgentChannels.restartThread, (threadId: string) =>
    manager.restartThread(threadId)
  )
  handle(manager, codingAgentChannels.listThreads, (input?: { projectId?: string }) =>
    manager.listThreads(input)
  )
  handle(manager, codingAgentChannels.getThread, (threadId: string) => manager.getThread(threadId))
  handle(manager, codingAgentChannels.getSnapshot, (threadId: string) =>
    manager.getSnapshot(threadId)
  )
  handle(manager, codingAgentChannels.prompt, (input: PromptInput) => manager.prompt(input))
  handle(manager, codingAgentChannels.steer, (input: TextInput) => manager.steer(input))
  handle(manager, codingAgentChannels.followUp, (input: TextInput) => manager.followUp(input))
  handle(manager, codingAgentChannels.abort, (threadId: string) => manager.abort(threadId))
  handle(manager, codingAgentChannels.newSession, (input: NewSessionInput) =>
    manager.newSession(input)
  )
  handle(manager, codingAgentChannels.switchSession, (input: SwitchSessionInput) =>
    manager.switchSession(input)
  )
  handle(manager, codingAgentChannels.importSession, (input: ImportSessionInput) =>
    manager.importSession(input)
  )
  handle(manager, codingAgentChannels.exportSession, (input: ExportSessionInput) =>
    manager.exportSession(input)
  )
  handle(manager, codingAgentChannels.fork, (input: ForkInput) => manager.fork(input))
  handle(manager, codingAgentChannels.clone, (threadId: string) => manager.clone(threadId))
  handle(manager, codingAgentChannels.renameThread, (input: RenameThreadInput) =>
    manager.renameThread(input)
  )
  handle(manager, codingAgentChannels.archiveThread, (threadId: string) =>
    manager.archiveThread(threadId)
  )
  handle(manager, codingAgentChannels.listModels, (threadId: string) =>
    manager.listModels(threadId)
  )
  handle(manager, codingAgentChannels.setModel, (input: SetModelInput) => manager.setModel(input))
  handle(manager, codingAgentChannels.cycleModel, (threadId: string) =>
    manager.cycleModel(threadId)
  )
  handle(manager, codingAgentChannels.setThinkingLevel, (input: SetThinkingInput) =>
    manager.setThinkingLevel(input)
  )
  handle(manager, codingAgentChannels.cycleThinkingLevel, (threadId: string) =>
    manager.cycleThinkingLevel(threadId)
  )
  handle(manager, codingAgentChannels.compact, (input: CompactInput) => manager.compact(input))
  handle(manager, codingAgentChannels.setAutoCompaction, (input: ToggleInput) =>
    manager.setAutoCompaction(input)
  )
  handle(manager, codingAgentChannels.setAutoRetry, (input: ToggleInput) =>
    manager.setAutoRetry(input)
  )
  handle(manager, codingAgentChannels.abortRetry, (threadId: string) =>
    manager.abortRetry(threadId)
  )
  handle(manager, codingAgentChannels.getCommands, (threadId: string) =>
    manager.getCommands(threadId)
  )
  handle(manager, codingAgentChannels.runCommand, (input: { threadId: string; command: string }) =>
    manager.runCommand(input)
  )
  handle(manager, codingAgentChannels.respondUi, (input: ExtensionUiResponseInput) =>
    manager.respondUi(input)
  )
  handle(manager, codingAgentChannels.respondApproval, (input: ApprovalResponseInput) =>
    manager.respondApproval(input)
  )
  handle(manager, codingAgentChannels.listDiagnostics, (input?: DiagnosticsInput) =>
    manager.listDiagnostics(input)
  )
  handle(manager, codingAgentChannels.getModelSettings, () => manager.getModelSettings())
  handle(manager, codingAgentChannels.updateModelSettings, (input: UpdateModelSettingsInput) =>
    manager.updateModelSettings(input)
  )
  handle(manager, codingAgentChannels.listModelRegistry, () => manager.listModelRegistry())
  handle(manager, codingAgentChannels.listProviderCredentials, () =>
    manager.listProviderCredentials()
  )
  handle(manager, codingAgentChannels.listModelDiagnostics, () => manager.listModelDiagnostics())
  handle(manager, codingAgentChannels.listCustomProviders, () => manager.listCustomProviders())
  handle(manager, codingAgentChannels.upsertCustomProvider, (input: UpsertCustomProviderInput) =>
    manager.upsertCustomProvider(input)
  )
  handle(manager, codingAgentChannels.deleteCustomProvider, (provider: string) =>
    manager.deleteCustomProvider(provider)
  )
  handle(manager, codingAgentChannels.setProviderApiKey, (input: SetProviderApiKeyInput) =>
    manager.setProviderApiKey(input)
  )
  handle(manager, codingAgentChannels.refreshModelRegistry, () => manager.refreshModelRegistry())
  handle(manager, codingAgentChannels.getAgentSettings, () => manager.getAgentSettings())
  handle(manager, codingAgentChannels.updateAgentSettings, (input: UpdateAgentSettingsInput) =>
    manager.updateAgentSettings(input)
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
    projectStore.close()
  })

  return manager
}

/**
 * 记录 worker lifecycle 临时状态。
 * @param store - Thread metadata/projection cache。
 * @param event - 生命周期事件。
 */
function indexWorkerLifecycle(store: CodingThreadStore, event: ThreadWorkerLifecycleEvent): void {
  try {
    if (event.type === 'worker.run.started') {
      store.recordWorkerRun({
        workerId: event.workerId,
        threadId: event.threadId,
        status: 'running',
        startedAt: new Date(event.startedAt).toISOString()
      })
      return
    }
    if (event.type === 'worker.run.finished') {
      store.finishWorkerRun({
        workerId: event.workerId,
        startedAt: new Date(event.startedAt).toISOString(),
        status: event.reason === 'crash' ? 'crashed' : 'stopped',
        exitedAt: new Date(event.exitedAt).toISOString()
      })
      return
    }
    store.recordDiagnostic({
      threadId: event.threadId,
      source: 'thread_worker_registry',
      severity: 'error',
      message: event.message,
      createdAt: new Date(event.createdAt).toISOString()
    })
  } catch (error) {
    try {
      store.recordDiagnostic({
        threadId: event.threadId,
        source: 'storage',
        severity: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    } catch {
      // diagnostics 写入失败不能影响 worker 主路径。
    }
  }
}

/**
 * 注册结构化 IPC handler。
 * @param manager - thread manager。
 * @param channel - IPC channel。
 * @param callback - handler。
 */
function handle<TArgs extends unknown[], TResult>(
  manager: CodingThreadManager,
  channel: string,
  callback: (...args: TArgs) => TResult | Promise<TResult>
): void {
  ipcMain.handle(channel, async (_event, ...args: TArgs): Promise<IpcResult<Awaited<TResult>>> => {
    try {
      return ok(await callback(...args))
    } catch (error) {
      writeDiagnostic(manager, error)
      return fail(error)
    }
  })
}

/**
 * 向订阅窗口发布事件。
 * @param subscribers - 订阅窗口集合。
 * @param event - IPC event。
 */
export function publishCodingAgentEvent(
  subscribers: Set<Pick<WebContents, 'isDestroyed' | 'send'>>,
  event: CodingAgentIpcEvent
): void {
  for (const webContents of subscribers) {
    if (!webContents.isDestroyed()) {
      webContents.send(codingAgentChannels.event, event)
    }
  }
}

/**
 * 尽力写入 diagnostics。
 * @param manager - thread manager。
 * @param error - 错误。
 */
function writeDiagnostic(manager: CodingThreadManager, error: unknown): void {
  try {
    manager.getStore()?.recordDiagnostic({
      source: 'ipc',
      severity: 'error',
      message: error instanceof Error ? error.message : String(error)
    })
  } catch {
    // diagnostics 写入失败不能阻塞 IPC 错误返回。
  }
}

/**
 * 将 worker 信封转换为 IPC 事件。
 * @param event - worker 信封。
 * @returns 对应的 IPC 事件；若无法转换则返回 undefined。
 */
export function toCodingAgentIpcEvent(event: WorkerEnvelope): CodingAgentIpcEvent | undefined {
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
