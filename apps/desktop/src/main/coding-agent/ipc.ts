/**
 * 本文件注册 desktop coding agent 后端 IPC handlers。
 */

import { app, dialog, ipcMain, shell, type WebContents } from 'electron'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { codingAgentChannels } from '@shared/coding-agent/channels'
import { fail, ok } from '@shared/coding-agent/ipc-contract'
import { CodingThreadManager, ProjectTrustRefreshError } from './thread-manager'
import { CodingThreadStore } from './thread-store'
import { ProjectStore } from './project-store'
import { ProjectTrustService } from './project-trust-service'
import type { ModelSettingsService } from './model-settings-service'
import type { AgentSettingsService } from './agent-settings-service'
import { createConfiguredWorkerClient } from './worker-client-factory'
import { ThreadWorkerRegistry } from './thread-worker-registry'
import { cacheWorkerProjectionEvent } from './projection-cache'
import { normalizeAllowedExternalUrl } from './external-url'
import { launchChangedFile } from './changed-file-target'
import { readDesktopRuntimeConfig, writeDesktopRuntimeConfig } from './desktop-runtime-config'
import type { WorkerClient, WorkerEnvelope } from './worker-types'
import type { ThreadWorkerLifecycleEvent } from './thread-worker-registry'
import type {
  CodingAgentIpcEvent,
  CompactInput,
  CreateThreadInput,
  DiagnosticsInput,
  ExtensionEditorTextInput,
  ExtensionPanelDisposeInput,
  ExtensionPanelLifecycleInput,
  ExtensionPanelMessageInput,
  ExtensionPanelStateInput,
  ExtensionShortcutInput,
  ExportSessionInput,
  FileReferenceCompletionInput,
  FileReferenceCompletionResult,
  ExtensionUiResponseInput,
  ForkInput,
  ForkThreadInput,
  ImportSessionInput,
  IpcResult,
  ListThreadsInput,
  LoadSessionTreeBranchesInput,
  LoadSessionTreeChildrenInput,
  LoadSessionTreePathInput,
  LoginProviderOAuthInput,
  ModelOAuthPromptResponseInput,
  NavigateTreeInput,
  NewSessionInput,
  OpenExternalUrlInput,
  OpenChangedFileInput,
  PromptImageDraft,
  PromptImageAttachment,
  PromptInput,
  ApprovalResponseInput,
  ProjectExtensionPathsInput,
  RenameProjectInput,
  RenameThreadInput,
  ResourcePackageInput,
  ResourceSnapshotInput,
  RunCommandInput,
  RevealResourcePathInput,
  SelectResourcePathInput,
  SelectSessionFileInput,
  SetThreadTitleInput,
  SetSessionEntryLabelInput,
  SetProviderApiKeyInput,
  SetProjectTrustInput,
  ThreadStatus,
  SetModelInput,
  SetThinkingInput,
  SwitchSessionInput,
  TextInput,
  ToggleInput,
  UpdateAgentSettingsInput,
  UpdateDesktopUiPreferencesInput,
  UpdateModelSettingsInput,
  UpdateProjectExtensionPathsInput,
  UpdateResourcePackageInput,
  UpsertCustomProviderInput
} from '@shared/coding-agent/types'
type FileReferenceModule = typeof import('@coding-agent-src/core/file-reference')

type MimeModule = typeof import('@coding-agent-src/utils/mime')
type ClipboardImageModule = typeof import('@coding-agent-src/utils/clipboard-image')
type FileReferenceCompletionModule = {
  completeFileReference: FileReferenceModule['completeFileReference']
  extractFileReferenceQuery: FileReferenceModule['extractFileReferenceQuery']
}
type PromptImageProcessingModule = {
  detectSupportedImageMimeTypeFromFile: MimeModule['detectSupportedImageMimeTypeFromFile']
  extensionForImageMimeType: ClipboardImageModule['extensionForImageMimeType']
}

let fileReferenceCompletionModulePromise: Promise<FileReferenceCompletionModule> | undefined
let promptImageProcessingModulePromise: Promise<PromptImageProcessingModule> | undefined

/**
 * Coding agent IPC 注册选项。
 */
export interface CodingAgentIpcOptions {
  /** 可选的 CodingThreadManager 实例，用于复用现有管理器。 */
  manager?: CodingThreadManager
  /** 创建 worker 客户端的工厂函数。 */
  createWorker?: () => Promise<WorkerClient>
  /** 可选的事件订阅集合，用于 deferred IPC 注册阶段提前收集 renderer 订阅。 */
  subscribers?: Set<WebContents>
  /** 是否在本函数内注册事件订阅 listener。 */
  registerEventHandler?: boolean
}

/**
 * 注册 desktop coding agent 后端 IPC 处理器。
 * @param options - IPC 注册选项。
 * @returns 创建的 CodingThreadManager 实例。
 */
export function registerCodingAgentIpc(options: CodingAgentIpcOptions = {}): CodingThreadManager {
  const subscribers = options.subscribers ?? new Set<WebContents>()
  const projectStore = new ProjectStore()
  const projectTrustService = new ProjectTrustService()
  let modelSettingsService: Promise<ModelSettingsService> | undefined
  let agentSettingsService: Promise<AgentSettingsService> | undefined
  const store = new CodingThreadStore()
  const manager =
    options.manager ??
    new CodingThreadManager(
      new ThreadWorkerRegistry({
        createWorker: options.createWorker ?? createConfiguredWorkerClient,
        onEvent: (event) => {
          cacheWorkerProjectionEvent(store, event)
          manager.cacheExtensionPanelProjection(event)
          syncThreadStatusFromWorkerEvent(manager, event)
          if (isThreadActivityEvent(event)) {
            manager.touchThreadActivity(event.threadId)
          }
          const ipcEvent = toCodingAgentIpcEvent(event)
          if (!ipcEvent) {
            return
          }
          publishCodingAgentEvent(subscribers, ipcEvent)
        },
        onLifecycle: (event) => {
          indexWorkerLifecycle(store, event)
          syncThreadStatusFromWorkerLifecycle(manager, event)
          const statusEvent = toThreadStatusProjectionFromLifecycle(event)
          if (statusEvent) {
            publishCodingAgentEvent(subscribers, statusEvent)
          }
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
      () => (modelSettingsService ??= createModelSettingsService()),
      () => (agentSettingsService ??= createAgentSettingsService())
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
  handle(manager, codingAgentChannels.setProjectTrust, async (input: SetProjectTrustInput) => {
    try {
      const project = await manager.setProjectTrust(input)
      publishCodingAgentEvent(subscribers, {
        type: 'project',
        event: { type: 'project.trustChanged', project }
      })
      return project
    } catch (error) {
      if (error instanceof ProjectTrustRefreshError) {
        publishCodingAgentEvent(subscribers, {
          type: 'project',
          event: { type: 'project.trustChanged', project: error.project }
        })
      }
      throw error
    }
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
  handle(manager, codingAgentChannels.listThreads, (input?: ListThreadsInput) =>
    manager.listThreads(input)
  )
  handle(manager, codingAgentChannels.getThread, (threadId: string) => manager.getThread(threadId))
  handle(manager, codingAgentChannels.getSnapshot, (threadId: string) =>
    manager.getSnapshot(threadId)
  )
  handle(manager, codingAgentChannels.prompt, (input: PromptInput) => manager.prompt(input))
  handle(manager, codingAgentChannels.steer, (input: TextInput) => manager.steer(input))
  handle(manager, codingAgentChannels.followUp, (input: TextInput) => manager.followUp(input))
  handle(manager, codingAgentChannels.selectPromptImages, () => selectPromptImages())
  handle(manager, codingAgentChannels.processPromptImageFiles, (paths: string[]) =>
    processPromptImageFiles(paths)
  )
  handle(manager, codingAgentChannels.stagePromptImages, (images: PromptImageDraft[]) =>
    stagePromptImages(manager, images)
  )
  handle(manager, codingAgentChannels.selectResourcePath, (input?: SelectResourcePathInput) =>
    selectResourcePath(input)
  )
  handle(manager, codingAgentChannels.selectSessionFile, (input?: SelectSessionFileInput) =>
    selectSessionFile(input)
  )
  handle(manager, codingAgentChannels.revealResourcePath, (input: RevealResourcePathInput) =>
    revealResourcePath(input)
  )
  handle(manager, codingAgentChannels.openChangedFile, async (input: OpenChangedFileInput) =>
    launchChangedFile(await manager.getSnapshot(input.threadId), input, shell)
  )
  handle(
    manager,
    codingAgentChannels.completeFileReference,
    (input: FileReferenceCompletionInput) => completeFileReference(manager, input)
  )
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
  handle(manager, codingAgentChannels.forkThread, async (input: ForkThreadInput) => {
    const result = await manager.forkThread(input)
    if (result.snapshot) {
      publishCodingAgentEvent(subscribers, {
        type: 'threadSnapshot',
        threadId: result.snapshot.threadId,
        snapshot: result.snapshot
      })
    }
    return result
  })
  handle(manager, codingAgentChannels.clone, (threadId: string) => manager.clone(threadId))
  handle(manager, codingAgentChannels.navigateTree, (input: NavigateTreeInput) =>
    manager.navigateTree(input)
  )
  handle(
    manager,
    codingAgentChannels.loadSessionTreeChildren,
    (input: LoadSessionTreeChildrenInput) => manager.loadSessionTreeChildren(input)
  )
  handle(
    manager,
    codingAgentChannels.loadSessionTreeBranches,
    (input: LoadSessionTreeBranchesInput) => manager.loadSessionTreeBranches(input)
  )
  handle(manager, codingAgentChannels.loadSessionTreePath, (input: LoadSessionTreePathInput) =>
    manager.loadSessionTreePath(input)
  )
  handle(manager, codingAgentChannels.setSessionEntryLabel, (input: SetSessionEntryLabelInput) =>
    manager.setSessionEntryLabel(input)
  )
  handle(manager, codingAgentChannels.setThreadTitle, (input: SetThreadTitleInput) =>
    manager.setThreadTitle(input)
  )
  handle(manager, codingAgentChannels.renameThread, (input: RenameThreadInput) =>
    manager.renameThread(input)
  )
  handle(manager, codingAgentChannels.archiveThread, (threadId: string) =>
    manager.archiveThread(threadId)
  )
  handle(manager, codingAgentChannels.restoreThread, (threadId: string) =>
    manager.restoreThread(threadId)
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
  handle(manager, codingAgentChannels.runCommand, (input: RunCommandInput) =>
    manager.runCommand(input)
  )
  handle(manager, codingAgentChannels.syncExtensionEditorText, (input: ExtensionEditorTextInput) =>
    manager.syncExtensionEditorText(input)
  )
  handle(manager, codingAgentChannels.dispatchExtensionShortcut, (input: ExtensionShortcutInput) =>
    manager.dispatchExtensionShortcut(input)
  )
  handle(manager, codingAgentChannels.respondUi, (input: ExtensionUiResponseInput) =>
    manager.respondUi(input)
  )
  handle(
    manager,
    codingAgentChannels.sendExtensionPanelMessage,
    (input: ExtensionPanelMessageInput) => manager.sendExtensionPanelMessage(input)
  )
  handle(
    manager,
    codingAgentChannels.sendExtensionPanelLifecycleEvent,
    (input: ExtensionPanelLifecycleInput) => manager.sendExtensionPanelLifecycleEvent(input)
  )
  handle(manager, codingAgentChannels.saveExtensionPanelState, (input: ExtensionPanelStateInput) =>
    manager.saveExtensionPanelState(input)
  )
  handle(manager, codingAgentChannels.disposeExtensionPanel, (input: ExtensionPanelDisposeInput) =>
    manager.disposeExtensionPanel(input)
  )
  handle(manager, codingAgentChannels.openExternalUrl, (input: OpenExternalUrlInput) =>
    openExternalUrl(input)
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
  handle(manager, codingAgentChannels.loginProviderOAuth, (input: LoginProviderOAuthInput) =>
    manager.loginProviderOAuth(input, (event) => {
      publishCodingAgentEvent(subscribers, { type: 'modelOAuth', event })
    })
  )
  handle(
    manager,
    codingAgentChannels.respondModelOAuthPrompt,
    (input: ModelOAuthPromptResponseInput) => manager.respondModelOAuthPrompt(input)
  )
  handle(manager, codingAgentChannels.refreshModelRegistry, () => manager.refreshModelRegistry())
  handle(
    manager,
    codingAgentChannels.getDesktopUiPreferences,
    () => readDesktopRuntimeConfig().uiPreferences ?? {}
  )
  handle(
    manager,
    codingAgentChannels.updateDesktopUiPreferences,
    (input: UpdateDesktopUiPreferencesInput) =>
      writeDesktopRuntimeConfig({ uiPreferences: input }).uiPreferences ?? {}
  )
  handle(manager, codingAgentChannels.getAgentSettings, () => manager.getAgentSettings())
  handle(manager, codingAgentChannels.updateAgentSettings, (input: UpdateAgentSettingsInput) =>
    manager.updateAgentSettings(input)
  )
  handle(manager, codingAgentChannels.getResourceSnapshot, (input?: ResourceSnapshotInput) =>
    manager.getResourceSnapshot(input)
  )
  handle(
    manager,
    codingAgentChannels.getProjectExtensionPaths,
    (input: ProjectExtensionPathsInput) => manager.getProjectExtensionPaths(input)
  )
  handle(
    manager,
    codingAgentChannels.updateProjectExtensionPaths,
    (input: UpdateProjectExtensionPathsInput) => manager.updateProjectExtensionPaths(input)
  )
  handle(manager, codingAgentChannels.listResourcePackages, () => manager.listResourcePackages())
  handle(manager, codingAgentChannels.addResourcePackage, (input: ResourcePackageInput) =>
    manager.addResourcePackage(input)
  )
  handle(manager, codingAgentChannels.installResourcePackage, (input: ResourcePackageInput) =>
    manager.installResourcePackage(input, (event) => {
      publishCodingAgentEvent(subscribers, { type: 'resourcePackage', event })
    })
  )
  handle(manager, codingAgentChannels.removeResourcePackage, (input: ResourcePackageInput) =>
    manager.removeResourcePackage(input)
  )
  handle(manager, codingAgentChannels.updateResourcePackage, (input?: UpdateResourcePackageInput) =>
    manager.updateResourcePackage(input, (event) => {
      publishCodingAgentEvent(subscribers, { type: 'resourcePackage', event })
    })
  )
  if (options.registerEventHandler !== false) {
    ipcMain.on(codingAgentChannels.event, (event, action: 'subscribe' | 'unsubscribe') => {
      if (action === 'subscribe') {
        subscribers.add(event.sender)
        event.sender.once('destroyed', () => subscribers.delete(event.sender))
        publishCodingAgentEvents(new Set([event.sender]), manager.getExtensionPanelReplayEvents())
        return
      }
      subscribers.delete(event.sender)
    })
  }
  app.once('before-quit', () => {
    void manager.shutdown()
    store.close()
    projectStore.close()
  })

  return manager
}

async function createModelSettingsService(): Promise<ModelSettingsService> {
  const { ModelSettingsService } = await import('./model-settings-service')
  return new ModelSettingsService()
}

async function createAgentSettingsService(): Promise<AgentSettingsService> {
  const { AgentSettingsService } = await import('./agent-settings-service')
  return new AgentSettingsService()
}

function loadPromptImageProcessingModule(): Promise<PromptImageProcessingModule> {
  promptImageProcessingModulePromise ??= Promise.all([
    import('@coding-agent-src/utils/mime'),
    import('@coding-agent-src/utils/clipboard-image')
  ]).then(([mime, clipboardImage]) => ({
    detectSupportedImageMimeTypeFromFile: mime.detectSupportedImageMimeTypeFromFile,
    extensionForImageMimeType: clipboardImage.extensionForImageMimeType
  }))
  return promptImageProcessingModulePromise
}

function loadFileReferenceCompletionModule(): Promise<FileReferenceCompletionModule> {
  fileReferenceCompletionModulePromise ??= import('@coding-agent-src/core/file-reference').then(
    (fileReference) => ({
      completeFileReference: fileReference.completeFileReference,
      extractFileReferenceQuery: fileReference.extractFileReferenceQuery
    })
  )
  return fileReferenceCompletionModulePromise
}

/**
 * 补全 prompt 中的 Pi @file 文件引用。
 * @param manager - thread 管理器。
 * @param input - 补全输入。
 * @returns 文件引用候选。
 */
async function completeFileReference(
  manager: CodingThreadManager,
  input: FileReferenceCompletionInput
): Promise<FileReferenceCompletionResult> {
  if (!input.textBeforeCursor.includes('@')) {
    return { candidates: [] }
  }
  const { completeFileReference: completePiFileReference, extractFileReferenceQuery } =
    await loadFileReferenceCompletionModule()
  const query = extractFileReferenceQuery(input.textBeforeCursor)
  if (!query) {
    return { candidates: [] }
  }
  const cwd = getCompletionCwd(manager, input)
  if (!cwd) {
    return { from: query.from, to: query.to, candidates: [] }
  }
  const candidates = await completePiFileReference({
    cwd,
    query: query.query,
    limit: input.limit
  })
  return {
    from: query.from,
    to: query.to,
    candidates
  }
}

/**
 * 获取文件补全使用的 cwd。
 * @param manager - thread 管理器。
 * @param input - 补全输入。
 * @returns cwd 或 undefined。
 */
function getCompletionCwd(
  manager: CodingThreadManager,
  input: FileReferenceCompletionInput
): string | undefined {
  if (input.threadId) {
    const thread = manager.requireThread(input.threadId)
    return manager.getThreadCwd(thread)
  }
  if (input.projectId) {
    return manager.getProject(input.projectId).path
  }
  return undefined
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
      const threadStatus = getThreadStatusFromWorkerLifecycle(event) ?? 'stopped'
      store.finishWorkerRun({
        workerId: event.workerId,
        startedAt: new Date(event.startedAt).toISOString(),
        status: event.reason === 'crash' ? 'crashed' : 'stopped',
        exitedAt: new Date(event.exitedAt).toISOString()
      })
      const message = event.message
        ? `worker finished: reason=${event.reason}, thread status=${threadStatus}; ${event.message}`
        : `worker finished: reason=${event.reason}, thread status=${threadStatus}`
      store.recordDiagnostic({
        threadId: event.threadId,
        source: 'thread_worker_registry',
        severity: event.reason === 'crash' ? 'error' : 'info',
        message,
        details: {
          workerId: event.workerId,
          reason: event.reason,
          threadStatus,
          workerMessage: event.message,
          workerDetails: event.details
        },
        createdAt: new Date(event.exitedAt).toISOString()
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
      writeDiagnostic(manager, error, channel)
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
  publishCodingAgentEvents(subscribers, [event])
}

/**
 * 向订阅窗口发布多个事件。
 * @param subscribers - 订阅窗口集合。
 * @param events - IPC events。
 */
export function publishCodingAgentEvents(
  subscribers: Set<Pick<WebContents, 'isDestroyed' | 'send'>>,
  events: CodingAgentIpcEvent[]
): void {
  if (events.length === 0) {
    return
  }
  for (const webContents of subscribers) {
    if (webContents.isDestroyed()) {
      continue
    }
    for (const event of events) {
      webContents.send(codingAgentChannels.event, event)
    }
  }
}

/**
 * 从 worker 事件同步 thread metadata 状态，避免 listThreads 返回陈旧 running。
 * @param manager - thread manager。
 * @param event - worker event envelope。
 */
export function syncThreadStatusFromWorkerEvent(
  manager: Pick<CodingThreadManager, 'hasThread' | 'updateThread'>,
  event: WorkerEnvelope
): void {
  if (event.kind !== 'event') {
    return
  }
  const status = getThreadStatusFromWorkerEvent(event)
  if (!status || !event.threadId || !manager.hasThread(event.threadId)) {
    return
  }
  manager.updateThread(event.threadId, { status })
}

/**
 * 从 worker lifecycle 同步 thread metadata 状态，覆盖 worker 退出但没有最终 runtime event 的情况。
 * @param manager - thread manager。
 * @param event - worker lifecycle event。
 */
export function syncThreadStatusFromWorkerLifecycle(
  manager: Pick<CodingThreadManager, 'hasThread' | 'updateThread'>,
  event: ThreadWorkerLifecycleEvent
): void {
  const status = getThreadStatusFromWorkerLifecycle(event)
  if (!status || !event.threadId || !manager.hasThread(event.threadId)) {
    return
  }
  manager.updateThread(event.threadId, { status })
}

function toThreadStatusProjectionFromLifecycle(
  event: ThreadWorkerLifecycleEvent
): CodingAgentIpcEvent | undefined {
  const status = getThreadStatusFromWorkerLifecycle(event)
  if (!status || !event.threadId) {
    return undefined
  }
  return {
    type: 'projection',
    threadId: event.threadId,
    event: {
      type: 'thread.stateChanged',
      threadId: event.threadId,
      status
    }
  }
}

function getThreadStatusFromWorkerLifecycle(
  event: ThreadWorkerLifecycleEvent
): ThreadStatus | undefined {
  if (event.type === 'worker.run.failed') {
    return 'error'
  }
  if (event.type !== 'worker.run.finished') {
    return undefined
  }
  switch (event.reason) {
    case 'idle':
      return 'idle'
    case 'crash':
      return 'error'
    case 'stop':
    case 'archive':
    case 'shutdown':
      return 'stopped'
    default:
      return undefined
  }
}

function getThreadStatusFromWorkerEvent(event: WorkerEnvelope): ThreadStatus | undefined {
  if (event.kind !== 'event') {
    return undefined
  }
  if (event.eventType === 'projection' && event.event.type === 'thread.stateChanged') {
    return event.event.status
  }
  if (event.eventType !== 'canonical') {
    return undefined
  }
  switch (event.event.type) {
    case 'agent_start':
    case 'turn_start':
      return 'running'
    case 'turn_end':
      return 'idle'
    case 'agent_end':
      return event.event.willRetry ? undefined : 'idle'
    default:
      return undefined
  }
}

/**
 * 选择并处理 prompt 图片附件。
 * @param manager - thread manager。
 * @returns 处理后的图片附件；用户取消时返回 undefined。
 */
async function selectPromptImages(): Promise<PromptImageAttachment[] | undefined> {
  const result = await dialog.showOpenDialog({
    title: '选择图片',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }]
  })
  if (result.canceled || result.filePaths.length === 0) {
    return undefined
  }
  return await processPromptImageFiles(result.filePaths)
}

/**
 * 直接处理本地 prompt 图片文件。
 * @param filePaths - 本地图片路径。
 * @returns 处理后的图片附件。
 */
async function processPromptImageFiles(filePaths: string[]): Promise<PromptImageAttachment[]> {
  return await Promise.all(filePaths.map((filePath) => createPromptImageAttachment(filePath)))
}

/**
 * 打开系统选择器选择资源路径。
 * @param input - 选择器选项。
 * @returns 选中的路径数组；用户取消时返回 undefined。
 */
async function selectResourcePath(
  input: SelectResourcePathInput = {}
): Promise<string[] | undefined> {
  const mode = input.mode ?? 'directory'
  const properties: Electron.OpenDialogOptions['properties'] = []
  if (mode === 'directory' || mode === 'any') properties.push('openDirectory', 'createDirectory')
  if (mode === 'file' || mode === 'any') properties.push('openFile')
  if (input.multi) properties.push('multiSelections')

  const result = await dialog.showOpenDialog({
    title: input.title ?? '选择资源路径',
    defaultPath: input.defaultPath,
    properties
  })
  if (result.canceled || result.filePaths.length === 0) {
    return undefined
  }
  return result.filePaths
}

/**
 * 打开系统选择器选择 Pi-compatible session 文件。
 * @param input - 选择器选项。
 * @returns 选中的 session 文件路径；用户取消时返回 undefined。
 */
async function selectSessionFile(input: SelectSessionFileInput = {}): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    title: input.title ?? '选择 Session 文件',
    defaultPath: input.defaultPath,
    properties: ['openFile'],
    filters: [
      { name: 'Pi sessions', extensions: ['jsonl', 'json'] },
      { name: 'All files', extensions: ['*'] }
    ]
  })
  if (result.canceled || !result.filePaths[0]) {
    return undefined
  }
  return result.filePaths[0]
}

/**
 * 在系统资源管理器中显示指定资源路径。
 * @param input - 路径输入。
 */
async function revealResourcePath(input: RevealResourcePathInput): Promise<void> {
  const targetPath = input.path.trim()
  if (!targetPath) {
    return
  }

  if (input.mode === 'open') {
    const error = await shell.openPath(targetPath)
    if (error) {
      throw new Error(error)
    }
    return
  }

  const pathStats = await stat(targetPath).catch(() => undefined)
  if (pathStats?.isDirectory()) {
    await shell.openPath(targetPath)
    return
  }
  shell.showItemInFolder(targetPath)
}

/**
 * 受控打开外部 URL。禁止 file/command/javascript 等高风险协议。
 * @param input - URL 输入。
 */
export async function openExternalUrl(input: OpenExternalUrlInput): Promise<void> {
  await shell.openExternal(normalizeAllowedExternalUrl(input.uri))
}

/**
 * 暂存 renderer 传入的 prompt 图片，再按文件图片链路处理。
 * @param manager - thread manager。
 * @param images - renderer 图片草稿。
 * @returns 处理后的图片附件。
 */
async function stagePromptImages(
  _manager: CodingThreadManager,
  images: PromptImageDraft[]
): Promise<PromptImageAttachment[]> {
  if (images.length === 0) {
    return []
  }
  return await Promise.all(
    images.map(async (image) => {
      const filePath = await writePromptImageDraft(image)
      return await createPromptImageAttachment(filePath, image.name, image.size)
    })
  )
}

/**
 * 将 renderer 图片草稿写入临时文件。
 * @param image - 图片草稿。
 * @returns 临时文件路径。
 */
async function writePromptImageDraft(image: PromptImageDraft): Promise<string> {
  const { extensionForImageMimeType } = await loadPromptImageProcessingModule()
  const ext = extensionForImageMimeType(image.mimeType) ?? 'png'
  const dir = join(tmpdir(), 'meta-agent-prompt-images')
  await mkdir(dir, { recursive: true })
  const filePath = join(dir, `meta-agent-prompt-${randomUUID()}.${ext}`)
  await writeFile(filePath, Buffer.from(image.data, 'base64'))
  return filePath
}

/**
 * 从图片文件创建 Composer 预览附件，不做 provider inline resize。
 * @param filePath - 图片路径。
 * @param displayName - UI 展示名称。
 * @param displaySize - UI 展示大小。
 * @returns prompt 图片附件。
 */
async function createPromptImageAttachment(
  filePath: string,
  displayName = basename(filePath),
  displaySize?: number
): Promise<PromptImageAttachment> {
  const { detectSupportedImageMimeTypeFromFile } = await loadPromptImageProcessingModule()
  const mimeType = await detectSupportedImageMimeTypeFromFile(filePath)
  if (!mimeType) {
    throw new Error(`${basename(filePath)} 不是支持的图片格式`)
  }
  const [fileStats, bytes] = await Promise.all([stat(filePath), readFile(filePath)])
  return {
    type: 'image',
    path: filePath,
    name: displayName,
    size: displaySize ?? fileStats.size,
    mimeType,
    data: Buffer.from(bytes).toString('base64'),
    hints: []
  }
}

/**
 * 尽力写入 diagnostics。
 * @param manager - thread manager。
 * @param error - 错误。
 * @param channel - IPC channel。
 */
function writeDiagnostic(manager: CodingThreadManager, error: unknown, channel?: string): void {
  try {
    manager.getStore()?.recordDiagnostic({
      source: 'ipc',
      severity: 'error',
      message: error instanceof Error ? error.message : String(error),
      details: {
        channel,
        stack: error instanceof Error ? error.stack : undefined
      }
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
    return { ...event.event, threadId: event.threadId }
  }
  if (event.eventType === 'projection' && typeof event.threadId === 'string') {
    if (event.event.type === 'extensionPanel.resourceRegistered') {
      return undefined
    }
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

/**
 * 判断 worker 事件是否代表 thread 会话内容活跃。
 * @param event - worker 事件信封。
 * @returns 是否需要刷新 thread updatedAt。
 */
function isThreadActivityEvent(
  event: WorkerEnvelope
): event is WorkerEnvelope & { kind: 'event'; eventType: 'canonical'; threadId: string } {
  return (
    event.kind === 'event' &&
    event.eventType === 'canonical' &&
    typeof event.threadId === 'string' &&
    event.event.type === 'message_end' &&
    isConversationMessage(event.event.message)
  )
}

/**
 * 判断消息是否是用户或 assistant 的会话消息。
 * @param message - 原始 agent message。
 * @returns 是否是会话活跃消息。
 */
function isConversationMessage(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    'role' in message &&
    (message.role === 'user' || message.role === 'assistant')
  )
}
