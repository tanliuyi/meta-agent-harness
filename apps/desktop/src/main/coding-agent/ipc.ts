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
import { detectSupportedImageMimeTypeFromFile } from '../../../../../packages/coding-agent/src/utils/mime'
import { extensionForImageMimeType } from '../../../../../packages/coding-agent/src/utils/clipboard-image'
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
  FileReferenceCompletionInput,
  FileReferenceCompletionResult,
  ExtensionUiResponseInput,
  ForkInput,
  ForkThreadInput,
  ImportSessionInput,
  IpcResult,
  ListThreadsInput,
  LoadSessionTreeChildrenInput,
  LoadSessionTreePathInput,
  LoginProviderOAuthInput,
  ModelOAuthPromptResponseInput,
  NavigateTreeInput,
  NewSessionInput,
  PromptImageDraft,
  PromptImageAttachment,
  PromptInput,
  ApprovalResponseInput,
  RenameProjectInput,
  RenameThreadInput,
  ResourcePackageInput,
  RevealResourcePathInput,
  SelectResourcePathInput,
  SelectSessionFileInput,
  SetThreadTitleInput,
  SetSessionEntryLabelInput,
  SetProviderApiKeyInput,
  SetProjectTrustInput,
  SetModelInput,
  SetThinkingInput,
  SwitchSessionInput,
  TextInput,
  ToggleInput,
  UpdateAgentSettingsInput,
  UpdateModelSettingsInput,
  UpdateResourcePackageInput,
  UpsertCustomProviderInput
} from '@shared/coding-agent/types'
import {
  completeFileReference as completePiFileReference,
  extractFileReferenceQuery
} from '../../../../../packages/coding-agent/src/core/file-reference'

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
  handle(manager, codingAgentChannels.loadSessionTreeChildren, (input: LoadSessionTreeChildrenInput) =>
    manager.loadSessionTreeChildren(input)
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
  handle(manager, codingAgentChannels.getAgentSettings, () => manager.getAgentSettings())
  handle(manager, codingAgentChannels.updateAgentSettings, (input: UpdateAgentSettingsInput) =>
    manager.updateAgentSettings(input)
  )
  handle(manager, codingAgentChannels.getResourceSnapshot, () => manager.getResourceSnapshot())
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
 * 补全 prompt 中的 Pi @file 文件引用。
 * @param manager - thread 管理器。
 * @param input - 补全输入。
 * @returns 文件引用候选。
 */
async function completeFileReference(
  manager: CodingThreadManager,
  input: FileReferenceCompletionInput
): Promise<FileReferenceCompletionResult> {
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
  return await Promise.all(
    result.filePaths.map((filePath) => createPromptImageAttachment(filePath))
  )
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
    return { ...event.event, threadId: event.threadId }
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
