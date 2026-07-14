/**
 * 本文件注册 desktop coding agent 后端 IPC handlers。
 */

import { app, dialog, ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { AGUIEvent } from '@ag-ui/core'
import { readFile, realpath, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { codingAgentChannels } from '@shared/coding-agent/channels'
import { fail, ok } from '@shared/coding-agent/ipc-contract'
import {
  assertPromptImageBytes,
  assertPromptImageCount,
  assertPromptImageTotalBytes,
  MAX_PROMPT_IMAGE_BYTES
} from '@shared/coding-agent/prompt-image-limits'
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
import { createWebContentsLifetime } from './web-contents-lifetime'
import { readDesktopRuntimeConfig, writeDesktopRuntimeConfig } from './desktop-runtime-config'
import { SessionMessageRepository } from './session-message-repository'
import type { WorkerClient, WorkerEnvelope } from './worker-types'
import type { ThreadWorkerLifecycleEvent } from './thread-worker-registry'
import type {
  AgentSessionIpcEvent,
  CodingAgentIpcEvent,
  CompactInput,
  CreateThreadInput,
  DiagnosticsInput,
  DesktopCapabilityAccessMode,
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
  OpenSessionMessageFeedInput,
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
  ResourcePackageListInput,
  ResourceSnapshotInput,
  HermesMemoryMutationInput,
  HermesMemorySnapshotInput,
  RunCommandInput,
  RevealResourcePathInput,
  SelectResourcePathInput,
  SelectSessionFileInput,
  SetThreadTitleInput,
  SetSessionEntryLabelInput,
  SetProviderApiKeyInput,
  SetProjectTrustInput,
  ThreadSnapshot,
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
type FileReferenceCompletionModule = {
  completeFileReference: FileReferenceModule['completeFileReference']
  extractFileReferenceQuery: FileReferenceModule['extractFileReferenceQuery']
}
type PromptImageProcessingModule = {
  detectSupportedImageMimeType: MimeModule['detectSupportedImageMimeType']
  detectSupportedImageMimeTypeFromFile: MimeModule['detectSupportedImageMimeTypeFromFile']
}

export {
  MAX_PROMPT_IMAGE_BYTES,
  MAX_PROMPT_IMAGE_COUNT,
  MAX_PROMPT_IMAGE_TOTAL_BYTES
} from '@shared/coding-agent/prompt-image-limits'
const promptImageReadConcurrency = 2
const resourceCapabilityTtlMs = 60 * 60 * 1000
const maxResourceCapabilities = 128

interface ResourcePathCapability {
  path: string
  expiresAt: number
}

export class ResourcePathCapabilityStore {
  private readonly capabilities = new Map<string, ResourcePathCapability>()

  issue(path: string): string {
    this.prune()
    while (this.capabilities.size >= maxResourceCapabilities) {
      const oldest = this.capabilities.keys().next().value as string | undefined
      if (!oldest) break
      this.capabilities.delete(oldest)
    }
    const token = randomUUID()
    this.capabilities.set(token, { path, expiresAt: Date.now() + resourceCapabilityTtlMs })
    return token
  }

  resolve(token: string): string {
    this.prune()
    const capability = this.capabilities.get(token)
    if (!capability) {
      throw new Error('资源 capability 无效或已过期')
    }
    return capability.path
  }

  private prune(): void {
    const now = Date.now()
    for (const [token, capability] of this.capabilities) {
      if (capability.expiresAt <= now) this.capabilities.delete(token)
    }
  }
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
  let rollback: (() => void) | undefined
  try {
    return registerCodingAgentIpcUnchecked(options, (cleanup) => {
      rollback = cleanup
    })
  } catch (error) {
    rollback?.()
    throw error
  }
}

function registerCodingAgentIpcUnchecked(
  options: CodingAgentIpcOptions,
  setRollback: (cleanup: () => void) => void
): CodingThreadManager {
  const subscribers = options.subscribers ?? new Set<WebContents>()
  const sessionFeeds = new SessionAgentSubscriptionManager()
  const projectStore = new ProjectStore()
  const projectTrustService = new ProjectTrustService()
  const resourceCapabilities = new ResourcePathCapabilityStore()
  let modelSettingsService: Promise<ModelSettingsService> | undefined
  let agentSettingsService: Promise<AgentSettingsService> | undefined
  const store = new CodingThreadStore()
  const sessionMessages: { repository?: SessionMessageRepository } = {}
  let createdManager: CodingThreadManager | undefined
  const ownsManager = !options.manager
  setRollback(() => {
    if (ownsManager && createdManager) {
      void createdManager.shutdown().catch((error) => {
        console.error('Failed to shut down partially registered coding-agent manager', error)
      })
    }
    try {
      store.close()
    } catch {
      // Preserve the original registration error.
    }
    try {
      projectStore.close()
    } catch {
      // Preserve the original registration error.
    }
  })
  const manager =
    options.manager ??
    (createdManager = new CodingThreadManager(
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
          if (isAgentSessionIpcEvent(ipcEvent)) {
            const repository = sessionMessages.repository
            if (!repository) return
            for (const event of repository.record(ipcEvent)) {
              publishSessionAgentEvent(sessionFeeds.subscriptions, ipcEvent.threadId, event)
            }
            if (ipcEvent.type === 'compaction_end' || ipcEvent.type === 'message_end') {
              repository.invalidate(ipcEvent.threadId)
              void repository
                .get(ipcEvent.threadId)
                .then((snapshot) =>
                  publishSessionAgentEvent(sessionFeeds.subscriptions, ipcEvent.threadId, snapshot)
                )
                .catch(() => undefined)
            }
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
    ))
  sessionMessages.repository = new SessionMessageRepository((sessionId) =>
    manager.getSessionMessages(sessionId)
  )
  void cleanupLegacyPromptImageTempFiles().catch(() => undefined)

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
  handle(manager, codingAgentChannels.deleteProject, async (projectId: string) => {
    const result = await manager.deleteProject(projectId)
    publishCodingAgentEvent(subscribers, {
      type: 'project',
      event: { type: 'project.deleted', projectId, threadIds: result.threadIds }
    })
    return result
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
    sessionMessages.repository!.replace(snapshot.threadId, snapshot.messages)
    const nonChatSnapshot = toNonChatSnapshot(snapshot)
    publishCodingAgentEvent(subscribers, {
      type: 'threadSnapshot',
      threadId: snapshot.threadId,
      snapshot: nonChatSnapshot
    })
    return nonChatSnapshot
  })
  handle(manager, codingAgentChannels.stopThread, (threadId: string) =>
    manager.stopThread(threadId)
  )
  handle(manager, codingAgentChannels.restartThread, async (threadId: string) =>
    toNonChatSnapshot(await manager.restartThread(threadId))
  )
  handle(manager, codingAgentChannels.listThreads, (input?: ListThreadsInput) =>
    manager.listThreads(input)
  )
  handle(manager, codingAgentChannels.getThread, async (threadId: string) =>
    toNonChatSnapshot(await manager.getThread(threadId))
  )
  handle(manager, codingAgentChannels.getSnapshot, async (threadId: string) =>
    toNonChatSnapshot(await manager.getSnapshot(threadId))
  )
  handleWithEvent(
    manager,
    codingAgentChannels.openSessionMessageFeed,
    async (event, input: OpenSessionMessageFeedInput) => {
      assertRendererSessionId(input?.sessionId)
      return sessionFeeds.open(event.sender, input.sessionId, () =>
        sessionMessages.repository!.get(input.sessionId)
      )
    }
  )
  handleWithEvent(manager, codingAgentChannels.closeSessionMessageFeed, (event) => {
    sessionFeeds.close(event.sender)
  })
  handle(manager, codingAgentChannels.prompt, (input: PromptInput) => manager.prompt(input))
  handle(manager, codingAgentChannels.steer, (input: TextInput) => manager.steer(input))
  handle(manager, codingAgentChannels.followUp, (input: TextInput) => manager.followUp(input))
  handle(manager, codingAgentChannels.selectPromptImages, () => selectPromptImages())
  handle(manager, codingAgentChannels.processPromptImageFiles, (paths: string[]) =>
    processPromptImageFiles(paths)
  )
  handle(manager, codingAgentChannels.stagePromptImages, (images: PromptImageDraft[]) =>
    stagePromptImages(images)
  )
  handle(manager, codingAgentChannels.selectResourcePath, (input?: SelectResourcePathInput) =>
    selectResourcePath(input)
  )
  handle(manager, codingAgentChannels.selectSessionFile, (input?: SelectSessionFileInput) =>
    selectSessionFile(input)
  )
  handle(manager, codingAgentChannels.revealResourcePath, (input: RevealResourcePathInput) =>
    revealResourcePath(input, resourceCapabilities, readDesktopRuntimeConfig().filesystemAccess)
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
  handle(manager, codingAgentChannels.newSession, async (input: NewSessionInput) =>
    replaceSessionMessages(sessionMessages.repository!, await manager.newSession(input))
  )
  handle(manager, codingAgentChannels.switchSession, async (input: SwitchSessionInput) =>
    replaceSessionMessages(sessionMessages.repository!, await manager.switchSession(input))
  )
  handle(manager, codingAgentChannels.importSession, async (input: ImportSessionInput) =>
    replaceSessionMessages(sessionMessages.repository!, await manager.importSession(input))
  )
  handle(manager, codingAgentChannels.exportSession, async (input: ExportSessionInput) => {
    if (
      !input ||
      typeof input.threadId !== 'string' ||
      !input.threadId.trim() ||
      (input.outputPath !== undefined && typeof input.outputPath !== 'string')
    ) {
      throw new Error('Invalid export session request')
    }
    const result = await manager.exportSession(input)
    const capabilityPath = await assertExportedSessionPath(result.path)
    return {
      ...result,
      resourceCapability: resourceCapabilities.issue(capabilityPath)
    }
  })
  handle(manager, codingAgentChannels.fork, async (input: ForkInput) =>
    replaceSessionMessages(sessionMessages.repository!, await manager.fork(input))
  )
  handle(manager, codingAgentChannels.forkThread, async (input: ForkThreadInput) => {
    const result = await manager.forkThread(input)
    if (result.snapshot) {
      sessionMessages.repository!.replace(result.snapshot.threadId, result.snapshot.messages)
      result.snapshot = toNonChatSnapshot(result.snapshot)
      publishCodingAgentEvent(subscribers, {
        type: 'threadSnapshot',
        threadId: result.snapshot.threadId,
        snapshot: result.snapshot
      })
    }
    return result
  })
  handle(manager, codingAgentChannels.clone, async (threadId: string) =>
    replaceSessionMessages(sessionMessages.repository!, await manager.clone(threadId))
  )
  handle(manager, codingAgentChannels.navigateTree, async (input: NavigateTreeInput) => {
    const result = await manager.navigateTree(input)
    sessionMessages.repository!.replace(result.snapshot.threadId, result.snapshot.messages)
    return { ...result, snapshot: toNonChatSnapshot(result.snapshot) }
  })
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
  handle(
    manager,
    codingAgentChannels.setSessionEntryLabel,
    async (input: SetSessionEntryLabelInput) =>
      toNonChatSnapshot(await manager.setSessionEntryLabel(input))
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
  handleWithEvent(
    manager,
    codingAgentChannels.loginProviderOAuth,
    async (ipcEvent, input: LoginProviderOAuthInput) => {
      const owner = ipcEvent.sender
      const lifetime = createWebContentsLifetime(owner)
      try {
        return await manager.loginProviderOAuth(
          input,
          (event) => {
            if (lifetime.signal.aborted || owner.isDestroyed() || !subscribers.has(owner)) {
              throw new Error('OAuth renderer 已关闭或取消订阅')
            }
            owner.send(codingAgentChannels.event, { type: 'modelOAuth', event })
          },
          { ownerId: owner.id, signal: lifetime.signal }
        )
      } finally {
        lifetime.dispose()
      }
    }
  )
  handleWithEvent(
    manager,
    codingAgentChannels.respondModelOAuthPrompt,
    (ipcEvent, input: ModelOAuthPromptResponseInput) =>
      manager.respondModelOAuthPrompt(input, ipcEvent.sender.id)
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
    codingAgentChannels.getHermesMemorySnapshot,
    (input?: HermesMemorySnapshotInput) => manager.getHermesMemorySnapshot(input)
  )
  handle(manager, codingAgentChannels.mutateHermesMemory, (input: HermesMemoryMutationInput) =>
    manager.mutateHermesMemory(input)
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
  handle(manager, codingAgentChannels.listResourcePackages, (input?: ResourcePackageListInput) =>
    manager.listResourcePackages(input)
  )
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
  promptImageProcessingModulePromise ??= import('@coding-agent-src/utils/mime').then((mime) => ({
    detectSupportedImageMimeType: mime.detectSupportedImageMimeType,
    detectSupportedImageMimeTypeFromFile: mime.detectSupportedImageMimeTypeFromFile
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

function handleWithEvent<TArgs extends unknown[], TResult>(
  manager: CodingThreadManager,
  channel: string,
  callback: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>
): void {
  ipcMain.handle(channel, async (event, ...args: TArgs): Promise<IpcResult<Awaited<TResult>>> => {
    try {
      return ok(await callback(event, ...args))
    } catch (error) {
      writeDiagnostic(manager, error, channel)
      return fail(error)
    }
  })
}

/** Serializes open/close requests independently for each renderer WebContents. */
export class SessionAgentSubscriptionManager {
  readonly subscriptions = new Map<WebContents, string>()
  private readonly requests = new WeakMap<WebContents, object>()
  private readonly observedWebContents = new WeakSet<WebContents>()

  async open<T>(
    webContents: WebContents,
    sessionId: string,
    loadSnapshot: () => Promise<T>
  ): Promise<T> {
    const token = this.begin(webContents)
    const snapshot = await loadSnapshot()
    if (this.requests.get(webContents) === token && !webContents.isDestroyed()) {
      this.subscriptions.set(webContents, sessionId)
    }
    return snapshot
  }

  close(webContents: WebContents): void {
    this.requests.delete(webContents)
    this.subscriptions.delete(webContents)
  }

  private begin(webContents: WebContents): object {
    this.close(webContents)
    const token = {}
    this.requests.set(webContents, token)
    if (!this.observedWebContents.has(webContents)) {
      this.observedWebContents.add(webContents)
      webContents.once('destroyed', () => this.close(webContents))
    }
    return token
  }
}

/** 只向当前打开对应 session feed 的窗口发送标准 AG-UI event。 */
export function publishSessionAgentEvent(
  subscribers: Map<WebContents, string>,
  sessionId: string,
  event: AGUIEvent
): void {
  for (const [webContents, subscribedSessionId] of subscribers) {
    if (!webContents.isDestroyed() && subscribedSessionId === sessionId) {
      webContents.send(codingAgentChannels.sessionAgentEvent, event)
    }
  }
}

function toNonChatSnapshot(snapshot: ThreadSnapshot): ThreadSnapshot {
  return { ...snapshot, messages: [] }
}

function replaceSessionMessages(
  repository: SessionMessageRepository,
  snapshot: ThreadSnapshot
): ThreadSnapshot {
  repository.replace(snapshot.threadId, snapshot.messages)
  return toNonChatSnapshot(snapshot)
}

function assertRendererSessionId(sessionId: string | undefined): asserts sessionId is string {
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new Error('sessionId is required')
  }
}

function isAgentSessionIpcEvent(event: CodingAgentIpcEvent): event is AgentSessionIpcEvent {
  return (
    'threadId' in event &&
    typeof event.threadId === 'string' &&
    event.type !== 'projection' &&
    event.type !== 'worker' &&
    event.type !== 'threadSnapshot' &&
    event.type !== 'threadWorker'
  )
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
export async function processPromptImageFiles(
  filePaths: string[]
): Promise<PromptImageAttachment[]> {
  assertPromptImageCount(filePaths.length)
  let totalBytes = 0
  for (const filePath of filePaths) {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      throw new Error('图片路径无效')
    }
    const fileStats = await stat(filePath)
    if (!fileStats.isFile()) {
      throw new Error(`${basename(filePath)} 不是普通文件`)
    }
    assertPromptImageBytes(fileStats.size, basename(filePath))
    totalBytes += fileStats.size
    assertPromptImageTotalBytes(totalBytes)
  }
  let processedTotalBytes = 0
  return await mapWithConcurrency(filePaths, promptImageReadConcurrency, async (filePath) => {
    const attachment = await createPromptImageAttachment(filePath)
    processedTotalBytes += attachment.size
    assertPromptImageTotalBytes(processedTotalBytes)
    return attachment
  })
}

async function mapWithConcurrency<T, TResult>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<TResult>
): Promise<TResult[]> {
  const results = new Array<TResult>(values.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await map(values[index]!)
    }
  })
  await Promise.all(workers)
  return results
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
export async function revealResourcePath(
  input: RevealResourcePathInput,
  capabilities: ResourcePathCapabilityStore,
  accessMode: DesktopCapabilityAccessMode = 'safe'
): Promise<void> {
  if (!input || typeof input !== 'object') {
    throw new Error('资源路径参数无效')
  }
  const hasCapability = 'capability' in input
  const targetPath = hasCapability
    ? capabilities.resolve(input.capability.trim())
    : input.path.trim()
  if (!targetPath) {
    return
  }

  if (input.mode === 'open') {
    if (!hasCapability && accessMode !== 'full') {
      throw new Error('打开资源需要 main 签发的 capability')
    }
    if (accessMode !== 'full') {
      await assertOpenableResourcePath(targetPath)
    }
    const error = await shell.openPath(targetPath)
    if (error) {
      throw new Error(error)
    }
    return
  }

  if (accessMode !== 'full' && !hasCapability && isPotentialNetworkOrDevicePath(targetPath)) {
    throw new Error('不能显示网络或设备路径')
  }
  if (accessMode === 'full') {
    const pathStats = await stat(targetPath).catch(() => undefined)
    if (pathStats?.isDirectory()) {
      const error = await shell.openPath(targetPath)
      if (error) throw new Error(error)
      return
    }
  }
  shell.showItemInFolder(targetPath)
}

function isPotentialNetworkOrDevicePath(path: string): boolean {
  return path.startsWith('\\\\') || path.startsWith('//')
}

/**
 * 受控打开外部 URL。禁止 file/command/javascript 等高风险协议。
 * @param input - URL 输入。
 */
export async function openExternalUrl(input: OpenExternalUrlInput): Promise<void> {
  const accessMode = readDesktopRuntimeConfig().externalProtocolAccess
  await shell.openExternal(normalizeAllowedExternalUrl(input.uri, accessMode))
}

/**
 * 校验 renderer 传入的 prompt 图片并保留为 inline 附件。
 * @param images - renderer 图片草稿。
 * @returns 处理后的图片附件。
 */
export async function stagePromptImages(
  images: PromptImageDraft[]
): Promise<PromptImageAttachment[]> {
  assertPromptImageCount(images.length)
  const { detectSupportedImageMimeType } = await loadPromptImageProcessingModule()
  const attachments: PromptImageAttachment[] = []
  let totalBytes = 0
  for (const image of images) {
    const bytes = decodePromptImageDraft(image)
    totalBytes += bytes.length
    assertPromptImageTotalBytes(totalBytes)
    const mimeType = detectSupportedImageMimeType(bytes)
    if (!mimeType) {
      throw new Error(`${image.name || '粘贴图片'} 不是支持的图片格式`)
    }
    if (image.mimeType !== mimeType) {
      throw new Error(`${image.name || '粘贴图片'} 的图片类型与内容不一致`)
    }
    attachments.push({
      type: 'image',
      data: bytes.toString('base64'),
      mimeType,
      name: basename(image.name || 'pasted-image'),
      size: bytes.length,
      hints: []
    })
  }
  return attachments
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
  displayName = basename(filePath)
): Promise<PromptImageAttachment> {
  const { detectSupportedImageMimeTypeFromFile } = await loadPromptImageProcessingModule()
  const fileStats = await stat(filePath)
  if (!fileStats.isFile()) {
    throw new Error(`${basename(filePath)} 不是普通文件`)
  }
  assertPromptImageBytes(fileStats.size, basename(filePath))
  const mimeType = await detectSupportedImageMimeTypeFromFile(filePath)
  if (!mimeType) {
    throw new Error(`${basename(filePath)} 不是支持的图片格式`)
  }
  const bytes = await readFile(filePath)
  assertPromptImageBytes(bytes.length, basename(filePath))
  return {
    type: 'image',
    path: filePath,
    name: displayName,
    size: bytes.length,
    mimeType,
    data: Buffer.from(bytes).toString('base64'),
    hints: []
  }
}

function decodePromptImageDraft(image: PromptImageDraft): Buffer {
  if (
    !image ||
    typeof image.data !== 'string' ||
    typeof image.name !== 'string' ||
    typeof image.mimeType !== 'string' ||
    typeof image.size !== 'number'
  ) {
    throw new Error('图片草稿格式无效')
  }
  const encoded = image.data.trim()
  const maxEncodedLength = Math.ceil(MAX_PROMPT_IMAGE_BYTES / 3) * 4
  if (
    encoded.length === 0 ||
    encoded.length > maxEncodedLength ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  ) {
    throw new Error(`${image.name || '粘贴图片'} 的图片数据无效或过大`)
  }
  const bytes = Buffer.from(encoded, 'base64')
  assertPromptImageBytes(bytes.length, image.name || '粘贴图片')
  if (image.size !== bytes.length) {
    throw new Error(`${image.name || '粘贴图片'} 的声明大小与内容不一致`)
  }
  return bytes
}

async function cleanupLegacyPromptImageTempFiles(): Promise<void> {
  await rm(join(tmpdir(), 'meta-agent-prompt-images'), { recursive: true, force: true })
}

async function assertExportedSessionPath(path: string): Promise<string> {
  const canonicalPath = await realpath(path)
  await assertOpenableResourcePath(canonicalPath)
  return canonicalPath
}

async function assertOpenableResourcePath(path: string): Promise<void> {
  if (extname(path).toLowerCase() !== '.html') {
    throw new Error('导出资源必须是 HTML 文件')
  }
  const fileStats = await stat(path)
  if (!fileStats.isFile()) {
    throw new Error('导出资源不是普通文件')
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
