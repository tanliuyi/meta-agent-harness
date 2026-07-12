/**
 * 本文件提供 CodingThreadManager 共享的 thread registry 与 worker send 能力。
 */

import type {
  CodingAgentIpcEvent,
  DesktopExtensionWebviewPanel,
  ListThreadsInput,
  ModelSettingsModelItem,
  ThreadSnapshot,
  ThreadSummary
} from '@shared/coding-agent/types'
import type { WorkerCommand, WorkerResponseEnvelope, WorkerEnvelope } from './worker-types'
import type { DesktopExtensionWebviewResource } from '@coding-agent-desktop-src/protocol/extension-panel'
import type {
  ThreadLiveState,
  ThreadMessagesResponse
} from '@coding-agent-desktop-src/protocol/thread'
import type { ContextUsage } from '@coding-agent-src/core/extensions/types'
import type { ThreadWorkerRegistry } from './thread-worker-registry'
import type { CodingThreadStore } from './thread-store'
import type { ProjectStore } from './project-store'
import type { ProjectTrustService } from './project-trust-service'
import type { ModelSettingsService } from './model-settings-service'
import type { AgentSettingsService } from './agent-settings-service'
import { withThreadLineage } from './thread-lineage'
import { resolveSessionCwdLazy } from './session-manager-lazy'

type MaybePromise<T> = T | Promise<T>
type ServiceProvider<T> = T | (() => MaybePromise<T>)
type SessionSnapshotModule = typeof import('./session-snapshot')
type InteractionResponseCommand = Extract<
  WorkerCommand,
  { type: 'ui.respond' | 'approval.respond' }
>

export interface ExtensionPanelRestoreRequest {
  panelId: string
  viewType: string
  state: unknown
}

let sessionSnapshotModulePromise: Promise<SessionSnapshotModule> | undefined

function loadSessionSnapshotModule(): Promise<SessionSnapshotModule> {
  sessionSnapshotModulePromise ??= import('./session-snapshot')
  return sessionSnapshotModulePromise
}

/**
 * Coding thread 管理核心类，负责线程注册、worker 路由和快照构建。
 */
export class ThreadManagerCore {
  /** 内存中的线程摘要映射。 */
  protected readonly threads = new Map<string, ThreadSummary>()
  /** Renderer reload 后可重放的 desktop extension panel snapshot。 */
  private readonly extensionPanelSnapshots = new Map<
    string,
    Map<string, DesktopExtensionWebviewPanel>
  >()
  /** Renderer reload 后可重放的 desktop extension panel state。 */
  private readonly extensionPanelStateSnapshots = new Map<string, Map<string, unknown>>()
  /** Webview resource token registry. Tokens are opaque to renderer. */
  private readonly extensionWebviewResources = new Map<string, DesktopExtensionWebviewResource>()
  /** Thread worker registry 实例。 */
  protected readonly workers: ThreadWorkerRegistry
  /** 可选的持久化线程 store。 */
  private readonly store: CodingThreadStore | undefined
  /** Project registry。 */
  private readonly projectStore: ProjectStore | undefined
  /** Project trust 服务。 */
  private readonly projectTrustService: ProjectTrustService | undefined
  private readonly projectWorkerLifecycleTasks = new Map<string, Promise<void>>()
  private readonly threadWorkerLifecycleTasks = new Map<string, Promise<void>>()
  /** 全局模型设置服务。 */
  private modelSettingsService: ModelSettingsService | undefined
  private modelSettingsServicePromise: Promise<ModelSettingsService> | undefined
  private readonly createModelSettingsService:
    (() => MaybePromise<ModelSettingsService>) | undefined
  /** 全局 Pi agent 设置服务。 */
  private agentSettingsService: AgentSettingsService | undefined
  private agentSettingsServicePromise: Promise<AgentSettingsService> | undefined
  private readonly createAgentSettingsService:
    (() => MaybePromise<AgentSettingsService>) | undefined

  /**
   * 创建 ThreadManagerCore 实例。
   * @param workers - thread worker registry 实例。
   * @param store - 可选的线程 store，用于加载持久化线程。
   */
  constructor(
    workers: ThreadWorkerRegistry,
    store?: CodingThreadStore,
    projectStore?: ProjectStore,
    projectTrustService?: ProjectTrustService,
    modelSettingsService?: ServiceProvider<ModelSettingsService>,
    agentSettingsService?: ServiceProvider<AgentSettingsService>
  ) {
    this.workers = workers
    this.store = store
    this.projectStore = projectStore
    this.projectTrustService = projectTrustService
    if (typeof modelSettingsService === 'function') {
      this.createModelSettingsService = modelSettingsService
    } else {
      this.modelSettingsService = modelSettingsService
    }
    if (typeof agentSettingsService === 'function') {
      this.createAgentSettingsService = agentSettingsService
    } else {
      this.agentSettingsService = agentSettingsService
    }
    const persistedThreads = [
      ...(store?.listThreads() ?? []),
      ...(store?.listThreads({ archived: true }) ?? [])
    ]
    for (const thread of persistedThreads) {
      const normalizedThread = normalizePersistedThread(thread)
      this.threads.set(thread.threadId, normalizedThread)
      if (normalizedThread.status !== thread.status) {
        try {
          store?.saveThread(stripDerivedThreadFields(normalizedThread))
        } catch {
          // 启动期状态归一化失败不能阻塞 thread registry 初始化。
        }
      }
    }
  }

  /**
   * 检查是否存在指定线程。
   * @param threadId - 线程 ID。
   * @returns 是否存在。
   */
  hasThread(threadId: string): boolean {
    return this.threads.has(threadId)
  }

  /**
   * 保存线程摘要到内存并可选写入 store。
   * @param thread - 线程摘要。
   */
  saveThread(thread: ThreadSummary): void {
    const persistedThread = stripDerivedThreadFields(thread)
    this.threads.set(thread.threadId, persistedThread)
    try {
      this.store?.saveThread(persistedThread)
    } catch (error) {
      this.saveStoreDiagnostic(thread.threadId, error)
    }
  }

  /**
   * 获取当前使用的 thread worker registry。
   * @returns thread worker registry 实例。
   */
  getWorkers(): ThreadWorkerRegistry {
    return this.workers
  }

  /**
   * 更新 desktop extension panel snapshot，供 renderer reload 后重放。
   * @param event - worker event envelope。
   */
  cacheExtensionPanelProjection(event: WorkerEnvelope): void {
    if (
      event.kind !== 'event' ||
      event.eventType !== 'projection' ||
      typeof event.threadId !== 'string'
    ) {
      return
    }
    switch (event.event.type) {
      case 'extensionPanel.registered':
        this.ensureExtensionPanelSnapshot(event.threadId).set(
          event.event.panel.id,
          event.event.panel
        )
        return
      case 'extensionPanel.updated': {
        const panels = this.extensionPanelSnapshots.get(event.threadId)
        const current = panels?.get(event.event.panelId)
        if (!current) {
          return
        }
        panels?.set(event.event.panelId, { ...current, ...event.event.patch })
        return
      }
      case 'extensionPanel.removed':
        this.extensionPanelSnapshots.get(event.threadId)?.delete(event.event.panelId)
        this.extensionPanelStateSnapshots.get(event.threadId)?.delete(event.event.panelId)
        return
      case 'extensionPanel.stateUpdated':
        this.cacheExtensionPanelState(event.threadId, event.event.panelId, event.event.state)
        return
      case 'extensionPanel.resourceRegistered':
        this.extensionWebviewResources.set(event.event.resource.token, event.event.resource)
        return
      default:
        return
    }
  }

  /**
   * Resolve a previously registered desktop webview resource token.
   * @param token - Opaque token from pi-webview-resource:// URLs.
   * @returns Registered resource metadata, if present.
   */
  resolveExtensionWebviewResource(token: string): DesktopExtensionWebviewResource | undefined {
    return this.extensionWebviewResources.get(token)
  }

  /**
   * 缓存 desktop extension panel state，供 renderer reload 后恢复。
   * @param threadId - Thread ID。
   * @param panelId - Panel ID。
   * @param state - JSON 可序列化 panel state。
   */
  cacheExtensionPanelState(threadId: string, panelId: string, state: unknown): void {
    const panels = this.extensionPanelSnapshots.get(threadId)
    if (!panels?.has(panelId)) {
      return
    }
    let states = this.extensionPanelStateSnapshots.get(threadId)
    if (!states) {
      states = new Map<string, unknown>()
      this.extensionPanelStateSnapshots.set(threadId, states)
    }
    states.set(panelId, state)
  }

  /**
   * 移除 desktop extension panel replay 与 state cache。
   * @param threadId - Thread ID。
   * @param panelId - Panel ID。
   * @returns 是否存在并移除了 panel。
   */
  removeExtensionPanelRuntime(threadId: string, panelId: string): boolean {
    const removed = this.extensionPanelSnapshots.get(threadId)?.delete(panelId) ?? false
    this.extensionPanelStateSnapshots.get(threadId)?.delete(panelId)
    return removed
  }

  /**
   * 获取指定 thread 当前可恢复的 desktop extension panel。
   * @param threadId - Thread ID。
   * @returns restore 请求列表。
   */
  getExtensionPanelRestoreRequests(threadId: string): ExtensionPanelRestoreRequest[] {
    const panels = this.extensionPanelSnapshots.get(threadId)
    if (!panels) {
      return []
    }
    const states = this.extensionPanelStateSnapshots.get(threadId)
    return [...panels.values()].map((panel) => ({
      panelId: panel.id,
      viewType: panel.viewType ?? panel.id,
      state: states?.get(panel.id)
    }))
  }

  /**
   * 请求已绑定 worker 恢复 desktop extension panel。
   * @param threadId - Thread ID。
   * @param requests - Restore 请求列表。
   */
  async requestExtensionPanelRestoreRuntime(
    threadId: string,
    requests: ExtensionPanelRestoreRequest[]
  ): Promise<void> {
    if (!requests.length || !this.hasWorker(threadId)) {
      return
    }
    for (const restore of requests) {
      const response = await this.workers.send(threadId, {
        type: 'desktop.panelRestore',
        restore
      })
      if (!response.success) {
        throwResponseError(response)
      }
    }
  }

  /**
   * 销毁 desktop extension panel 并通知已绑定的 extension runtime。
   * 不会为了 dispose 一个 panel 启动新 worker。
   * @param threadId - Thread ID。
   * @param panelId - Panel ID。
   * @param reason - Dispose 原因。
   */
  async disposeExtensionPanelRuntime(
    threadId: string,
    panelId: string,
    reason: 'removed' | 'rendererUnmount' | 'threadRestart' | 'userClosed'
  ): Promise<void> {
    const removed = this.removeExtensionPanelRuntime(threadId, panelId)
    if (!removed || !this.hasWorker(threadId)) {
      return
    }
    const response = await this.workers.send(threadId, {
      type: 'desktop.panelLifecycle',
      event: { type: 'disposed', panelId, reason }
    })
    if (!response.success) {
      throwResponseError(response)
    }
  }

  /**
   * 清除指定 thread 的 desktop extension panel replay 与 webview resource token。
   * @param threadId - thread ID。
   */
  clearExtensionPanelRuntime(threadId: string): void {
    this.extensionPanelSnapshots.delete(threadId)
    this.extensionPanelStateSnapshots.delete(threadId)
    for (const [token, resource] of this.extensionWebviewResources.entries()) {
      if (resource.threadId === threadId) {
        this.extensionWebviewResources.delete(token)
      }
    }
  }

  /**
   * 获取当前可重放的 desktop extension panel projection events。
   * @returns renderer IPC events。
   */
  getExtensionPanelReplayEvents(): CodingAgentIpcEvent[] {
    return [...this.extensionPanelSnapshots.entries()].flatMap(([threadId, panels]) =>
      [...panels.values()].flatMap((panel) => {
        const registeredEvent = {
          type: 'projection' as const,
          threadId,
          event: {
            type: 'extensionPanel.registered' as const,
            threadId,
            panel
          }
        }
        const state = this.extensionPanelStateSnapshots.get(threadId)?.get(panel.id)
        if (state === undefined) {
          return [registeredEvent]
        }
        return [
          registeredEvent,
          {
            type: 'projection' as const,
            threadId,
            event: {
              type: 'extensionPanel.stateUpdated' as const,
              threadId,
              panelId: panel.id,
              state
            }
          }
        ]
      })
    )
  }

  private ensureExtensionPanelSnapshot(
    threadId: string
  ): Map<string, DesktopExtensionWebviewPanel> {
    let panels = this.extensionPanelSnapshots.get(threadId)
    if (!panels) {
      panels = new Map<string, DesktopExtensionWebviewPanel>()
      this.extensionPanelSnapshots.set(threadId, panels)
    }
    return panels
  }

  /**
   * 获取持久化 store。
   * @returns store 或 undefined。
   */
  getStore(): CodingThreadStore | undefined {
    return this.store
  }

  /**
   * 列出所有线程摘要。
   * @returns 线程摘要数组，按 updatedAt 降序。
   */
  listThreads(input: ListThreadsInput = {}): ThreadSummary[] {
    const includeArchived = input.archived === true
    const allThreads = [...this.threads.values()]
    return sortThreadsByUpdatedAt(
      allThreads
        .filter((thread) => !input.projectId || thread.projectId === input.projectId)
        .filter((thread) => Boolean(thread.archivedAt) === includeArchived)
        .map((thread) => withThreadLineage(thread, allThreads))
    )
  }

  /**
   * 获取指定线程的快照。
   * @param threadId - 线程 ID。
   * @returns 线程快照。
   */
  async getThread(threadId: string): Promise<ThreadSnapshot> {
    return await this.getSnapshot(threadId)
  }

  /**
   * 获取线程快照，优先从 worker 获取，回退到 store 或内存构建。
   * @param threadId - 线程 ID。
   * @returns 线程快照。
   * @throws 当 worker 响应失败且无法回退时。
   */
  async getSnapshot(threadId: string): Promise<ThreadSnapshot> {
    const thread = this.requireThread(threadId)
    if (!this.hasWorker(threadId)) {
      const inactiveThread = normalizeInactiveThread(thread)
      return (
        (await this.buildSnapshotFromSessionFile(inactiveThread)) ??
        this.buildSnapshot(inactiveThread)
      )
    }
    const response = await this.workers.send(threadId, { type: 'get_state' })

    if (response.success) {
      const liveState = response.data as Partial<ThreadLiveState>
      this.syncThreadMetadataFromLiveState(thread, liveState)
      const currentThread = this.requireThread(threadId)
      const liveProjection = await this.getLiveProjection(threadId)
      const persistedProjection = await this.getPersistedProjection(
        currentThread,
        liveState.currentEntryId
      )
      const renderableProjection = selectRenderableProjection({
        liveProjection,
        persistedProjection,
        liveState
      })
      const snapshot = this.buildSnapshot(currentThread, {
        ...(renderableProjection ?? {}),
        ...liveState
      })
      return snapshot
    }
    if (
      isMissingWorkerResponse(response) ||
      (thread.status !== 'idle' && thread.status !== 'running')
    ) {
      const fallbackThread = isMissingWorkerResponse(response)
        ? normalizeInactiveThread(this.requireThread(threadId))
        : thread
      return (
        (await this.buildSnapshotFromSessionFile(fallbackThread)) ??
        this.buildSnapshot(fallbackThread)
      )
    }
    throwResponseError(response)
  }

  /**
   * 轻量获取 thread 当前 session 文件，避免为了结构视图读取完整 message projection。
   * @param threadId - 线程 ID。
   * @returns session 文件路径。
   */
  async getThreadSessionFile(threadId: string): Promise<string | undefined> {
    return (await this.getThreadSessionState(threadId)).sessionFile
  }

  /**
   * 轻量获取 thread 当前 session 文件和 live leaf。
   * @param threadId - 线程 ID。
   * @returns session 文件路径与运行时当前 entry。
   */
  async getThreadSessionState(
    threadId: string
  ): Promise<{ sessionFile?: string; currentEntryId?: string | null }> {
    const thread = this.requireThread(threadId)
    if (!this.hasWorker(threadId)) {
      return { sessionFile: thread.sessionFile }
    }
    const response = await this.workers.send(threadId, { type: 'get_state' })
    if (!response.success) {
      if (isMissingWorkerResponse(response)) {
        return { sessionFile: thread.sessionFile }
      }
      throwResponseError(response)
    }
    const liveState = response.data as Partial<ThreadLiveState>
    this.syncThreadMetadataFromLiveState(thread, liveState)
    return {
      sessionFile: liveState.sessionFile ?? this.requireThread(threadId).sessionFile,
      currentEntryId: liveState.currentEntryId
    }
  }

  /**
   * 将 Pi runtime 产生的 durable session metadata 回写到 thread registry。
   * 新建 thread 时 session.jsonl 由 worker 内部 SessionManager 创建，初始 metadata
   * 还拿不到 sessionFile；恢复能力依赖这里把 live state 同步到 threads.json。
   */
  private syncThreadMetadataFromLiveState(
    thread: ThreadSummary,
    state: Partial<ThreadLiveState>
  ): void {
    const patch: Partial<ThreadSummary> = {}
    if (state.sessionFile && state.sessionFile !== thread.sessionFile) {
      patch.sessionFile = state.sessionFile
    }
    if (state.sessionName && state.sessionName !== thread.title) {
      patch.title = state.sessionName
    }
    const liveStatus = getThreadStatusFromLiveState(state)
    if (liveStatus && liveStatus !== thread.status) {
      patch.status = liveStatus
    }
    if (Object.keys(patch).length > 0) {
      this.updateThread(thread.threadId, patch)
    }
  }

  /**
   * 从 Pi live runtime 读取完整 message/tool call projection。
   * @param threadId - 线程 ID。
   * @returns desktop live projection 或 undefined。
   */
  private async getLiveProjection(
    threadId: string
  ): Promise<Pick<ThreadSnapshot, 'messages' | 'toolCalls' | 'fileChanges'> | undefined> {
    const response = await this.workers.send(threadId, { type: 'get_messages' })
    if (!response.success) {
      if (isMissingWorkerResponse(response)) {
        return undefined
      }
      throwResponseError(response)
    }
    const data = response.data as ThreadMessagesResponse | undefined
    if (!data) {
      return undefined
    }
    const sessionSnapshot = await loadSessionSnapshotModule()
    return {
      messages: sessionSnapshot.toThreadMessages(data.messages, data.messageEntryIds),
      toolCalls: sessionSnapshot.toThreadToolCalls(data.messages, threadId),
      fileChanges: sessionSnapshot.toThreadFileChanges(data.messages, threadId)
    }
  }

  /**
   * 向 worker 发送命令并忽略返回数据。
   * @param threadId - 线程 ID。
   * @param command - 要发送的命令。
   * @throws 当 worker 响应失败时。
   */
  async sendOk(threadId: string, command: WorkerCommand): Promise<void> {
    const projectId = this.requireThread(threadId).projectId
    await this.runProjectWorkerLifecycle(projectId, () =>
      this.runThreadWorkerLifecycle(threadId, async () => {
        await this.ensureWorker(threadId)
        const response = await this.workers.send(threadId, command)
        if (!response.success) {
          throwResponseError(response)
        }
      })
    )
  }

  /**
   * 发送解除当前扩展或审批等待所需的响应，不进入 lifecycle 串行队列。
   * 交互请求只可能来自已绑定 worker，因此这里不创建或重启 worker。
   */
  async sendInteractionResponse(
    threadId: string,
    command: InteractionResponseCommand
  ): Promise<void> {
    this.requireThread(threadId)
    const response = await this.workers.send(threadId, command)
    if (!response.success) {
      throwResponseError(response)
    }
  }

  /**
   * 向 worker 发送命令并返回数据。
   * @param threadId - 线程 ID。
   * @param command - 要发送的命令。
   * @returns worker 返回的数据。
   * @throws 当 worker 响应失败时。
   */
  async sendData<T>(threadId: string, command: WorkerCommand): Promise<T> {
    const projectId = this.requireThread(threadId).projectId
    return await this.runProjectWorkerLifecycle(projectId, () =>
      this.runThreadWorkerLifecycle(threadId, async () => {
        await this.ensureWorker(threadId)
        const response = await this.workers.send(threadId, command)
        if (!response.success) {
          throwResponseError(response)
        }
        return response.data as T
      })
    )
  }

  /**
   * 根据线程摘要和 worker 状态构建快照。
   * @param thread - 线程摘要。
   * @param state - 可选的 worker 状态数据。
   * @returns 线程快照。
   */
  protected buildSnapshot(
    thread: ThreadSummary,
    state: Partial<ThreadLiveState> &
      Partial<
        Pick<
          ThreadSnapshot,
          'messages' | 'toolCalls' | 'fileChanges' | 'sessionTree' | 'currentEntryId'
        >
      > = {}
  ): ThreadSnapshot {
    const lineage = withThreadLineage(thread, [...this.threads.values()]).lineage
    return {
      threadId: thread.threadId,
      projectId: thread.projectId,
      cwd: state.cwd ?? this.getThreadCwd(thread),
      sessionFile: state.sessionFile ?? thread.sessionFile,
      title: state.sessionName ?? thread.title,
      status: getThreadStatusFromLiveState(state) ?? thread.status,
      model: state.model,
      thinkingLevel: state.thinkingLevel ?? 'off',
      messages: state.messages ?? [],
      sessionTree: state.sessionTree,
      currentEntryId: state.currentEntryId,
      toolCalls: state.toolCalls ?? [],
      fileChanges: state.fileChanges ?? [],
      approvals: state.approvals ?? [],
      extensionDialogs: state.extensionDialogs ?? [],
      queue: state.queue ?? {
        steering: [],
        followUp: []
      },
      diagnostics: [],
      autoCompactionEnabled: state.autoCompactionEnabled,
      autoRetryEnabled: state.autoRetryEnabled,
      context: buildContextUsage(state.contextUsage),
      lineage
    }
  }

  /**
   * 从 JSONL session 文件构建 snapshot。
   * @param thread - 线程摘要。
   * @returns snapshot 或 undefined。
   */
  private async buildSnapshotFromSessionFile(
    thread: ThreadSummary,
    currentEntryId?: string | null
  ): Promise<ThreadSnapshot | undefined> {
    if (!thread.sessionFile) {
      return undefined
    }
    try {
      const { buildSnapshotFromSession } = await loadSessionSnapshotModule()
      const snapshot = buildSnapshotFromSession({
        thread,
        cwd: this.getThreadCwd(thread),
        sessionFile: thread.sessionFile,
        currentEntryId,
        modelContextWindows: await this.getModelContextWindowsForSnapshot()
      })
      return {
        ...snapshot,
        lineage: withThreadLineage(thread, [...this.threads.values()]).lineage
      }
    } catch (error) {
      this.saveStoreDiagnostic(thread.threadId, error)
      return undefined
    }
  }

  private async getModelContextWindowsForSnapshot(): Promise<Record<string, number> | undefined> {
    try {
      const registry = await (await this.getModelSettingsService()).listModelRegistry()
      return Object.fromEntries(
        registry.models.flatMap((model: ModelSettingsModelItem) =>
          model.contextWindow && model.contextWindow > 0
            ? [[`${model.provider}/${model.id}`, model.contextWindow] as const]
            : []
        )
      )
    } catch {
      return undefined
    }
  }

  /**
   * 从 JSONL session 读取 renderer 使用的持久化 timeline projection。
   * @param thread - 当前线程摘要。
   * @returns 持久化 projection。
   */
  private async getPersistedProjection(
    thread: ThreadSummary,
    currentEntryId?: string | null
  ): Promise<
    | Pick<
        ThreadSnapshot,
        'messages' | 'toolCalls' | 'fileChanges' | 'sessionTree' | 'currentEntryId'
      >
    | undefined
  > {
    const persistedSnapshot = await this.buildSnapshotFromSessionFile(thread, currentEntryId)
    if (!persistedSnapshot || persistedSnapshot.messages.length === 0) {
      return undefined
    }
    return {
      messages: persistedSnapshot.messages,
      toolCalls: persistedSnapshot.toolCalls,
      fileChanges: persistedSnapshot.fileChanges,
      sessionTree: persistedSnapshot.sessionTree,
      currentEntryId: persistedSnapshot.currentEntryId
    }
  }

  /**
   * 尽力记录 store 错误。
   * @param threadId - 线程 ID。
   * @param error - 错误。
   */
  private saveStoreDiagnostic(threadId: string, error: unknown): void {
    try {
      this.store?.recordDiagnostic({
        threadId,
        source: 'storage',
        severity: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    } catch {
      // store 失败不能阻塞 canonical worker/session 主路径。
    }
  }

  /**
   * 更新线程的部分字段。
   * @param threadId - 线程 ID。
   * @param patch - 要更新的字段。
   */
  updateThread(threadId: string, patch: Partial<ThreadSummary>): void {
    const thread = this.requireThread(threadId)
    this.saveThread({ ...thread, ...patch })
  }

  /**
   * 记录 thread 会话内容活跃时间。
   * @param threadId - 线程 ID。
   * @param updatedAt - 活跃时间，默认当前时间。
   */
  touchThreadActivity(threadId: string, updatedAt = new Date().toISOString()): void {
    const thread = this.requireThread(threadId)
    this.saveThread({ ...thread, updatedAt })
  }

  /**
   * 获取线程摘要，不存在则抛出错误。
   * @param threadId - 线程 ID。
   * @returns 线程摘要。
   * @throws 当线程不存在时。
   */
  requireThread(threadId: string): ThreadSummary {
    const thread = this.threads.get(threadId)
    if (!thread) {
      throw new Error(`thread not found: ${threadId}`)
    }
    return thread
  }

  /**
   * 获取 ProjectStore。
   * @returns ProjectStore。
   * @throws 当未配置 ProjectStore 时。
   */
  getProjectStore(): ProjectStore {
    if (!this.projectStore) {
      throw new Error('project store is required')
    }
    return this.projectStore
  }

  /**
   * 获取 ProjectTrustService。
   * @returns ProjectTrustService。
   * @throws 当未配置 ProjectTrustService 时。
   */
  getProjectTrustService(): ProjectTrustService {
    if (!this.projectTrustService) {
      throw new Error('project trust service is required')
    }
    return this.projectTrustService
  }

  /**
   * 获取全局模型设置服务。
   * @returns ModelSettingsService。
   * @throws 当未配置服务时。
   */
  async getModelSettingsService(): Promise<ModelSettingsService> {
    if (this.modelSettingsService) {
      return this.modelSettingsService
    }
    if (!this.createModelSettingsService) {
      throw new Error('model settings service is required')
    }
    this.modelSettingsServicePromise ??= Promise.resolve(this.createModelSettingsService()).then(
      (service) => {
        this.modelSettingsService = service
        return service
      },
      (error) => {
        this.modelSettingsServicePromise = undefined
        throw error
      }
    )
    return await this.modelSettingsServicePromise
  }

  /**
   * 获取全局 Pi agent 设置服务。
   * @returns AgentSettingsService。
   * @throws 当未配置服务时。
   */
  async getAgentSettingsService(): Promise<AgentSettingsService> {
    if (this.agentSettingsService) {
      return this.agentSettingsService
    }
    if (!this.createAgentSettingsService) {
      throw new Error('agent settings service is required')
    }
    this.agentSettingsServicePromise ??= Promise.resolve(this.createAgentSettingsService()).then(
      (service) => {
        this.agentSettingsService = service
        return service
      },
      (error) => {
        this.agentSettingsServicePromise = undefined
        throw error
      }
    )
    return await this.agentSettingsServicePromise
  }

  /**
   * 获取线程启动用的 Project trust 覆盖。
   * @param projectPath - Thread 所属 Project 路径。
   * @returns 是否加载 Project 本地资源。
   */
  getProjectTrustOverride(projectPath: string): boolean {
    return this.projectTrustService?.isProjectTrusted(projectPath) ?? false
  }

  /**
   * 串行执行指定 Project 的 worker 生命周期操作。
   * @param projectId - Project ID。
   * @param operation - 生命周期操作。
   * @returns 操作结果。
   */
  async runProjectWorkerLifecycle<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    return await runQueuedLifecycleTask(this.projectWorkerLifecycleTasks, projectId, operation)
  }

  /**
   * 串行执行指定 Thread 的 worker 生命周期操作。
   * @param threadId - Thread ID。
   * @param operation - 生命周期操作。
   * @returns 操作结果。
   */
  async runThreadWorkerLifecycle<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    return await runQueuedLifecycleTask(this.threadWorkerLifecycleTasks, threadId, operation)
  }

  /**
   * 获取 thread 的运行时 cwd。
   * @param thread - Thread 摘要。
   * @returns Project 路径。
   */
  getThreadCwd(thread: ThreadSummary): string {
    return this.getProjectStore().requireProject(thread.projectId).path
  }

  /**
   * 检查指定线程是否已绑定到 worker。
   * @param threadId - 线程 ID。
   * @returns 是否已绑定 worker。
   */
  private hasWorker(threadId: string): boolean {
    return this.workers.listLeases().some((lease) => lease.threadId === threadId)
  }

  /**
   * 确保指定线程已绑定到 worker，必要时启动新 worker。
   * @param threadId - 线程 ID。
   */
  private async ensureWorker(threadId: string): Promise<void> {
    if (this.hasWorker(threadId)) {
      return
    }
    const thread = this.requireThread(threadId)
    const statusAfterStart = thread.status === 'running' ? 'running' : 'idle'
    const projectPath = this.getThreadCwd(thread)
    const cwd = thread.sessionFile
      ? await resolveSessionCwdLazy(thread.sessionFile, projectPath)
      : projectPath
    this.updateThread(threadId, { status: 'starting' })
    await this.workers.acquireThreadWorker({
      threadId,
      cwd,
      sessionFile: thread.sessionFile,
      title: thread.title,
      projectTrustOverride: this.getProjectTrustOverride(projectPath)
    })
    this.updateThread(threadId, { status: statusAfterStart })
  }
}

/**
 * 根据 worker 响应抛出错误。
 * @param response - worker 响应。
 * @throws 始终抛出 Error。
 */
export function throwResponseError(response: WorkerResponseEnvelope): never {
  const message = response.error?.message ?? `worker command failed: ${response.command}`
  throw new Error(message)
}

/**
 * 判断 worker 响应是否表示线程或 worker 不存在。
 * @param response - worker 响应。
 * @returns 是否为缺失响应。
 */
function isMissingWorkerResponse(response: WorkerResponseEnvelope): boolean {
  return (
    response.error?.code === 'thread_not_found' ||
    response.error?.code === 'worker_not_found' ||
    response.error?.code === 'worker_exited'
  )
}

function getThreadStatusFromLiveState(
  state: Partial<ThreadLiveState>
): ThreadSummary['status'] | undefined {
  if (state.isStreaming || state.isCompacting) {
    return 'running'
  }
  if (typeof state.isStreaming === 'boolean' || typeof state.isCompacting === 'boolean') {
    return 'idle'
  }
  return undefined
}

async function runQueuedLifecycleTask<T>(
  tasks: Map<string, Promise<void>>,
  key: string,
  operation: () => Promise<T>
): Promise<T> {
  const previousTask = tasks.get(key) ?? Promise.resolve()
  const result = previousTask.catch(() => undefined).then(operation)
  const barrier = result.then(
    () => undefined,
    () => undefined
  )
  tasks.set(key, barrier)
  try {
    return await result
  } finally {
    if (tasks.get(key) === barrier) {
      tasks.delete(key)
    }
  }
}

function normalizePersistedThread(thread: ThreadSummary): ThreadSummary {
  return stripDerivedThreadFields(normalizeInactiveThread(thread))
}

function normalizeInactiveThread(thread: ThreadSummary): ThreadSummary {
  if (
    thread.status === 'running' ||
    thread.status === 'starting' ||
    thread.status === 'stopping' ||
    thread.status === 'error'
  ) {
    return { ...thread, status: 'idle' }
  }
  return thread
}

function stripDerivedThreadFields(thread: ThreadSummary): ThreadSummary {
  const { lineage: _lineage, ...persistedThread } = thread
  return persistedThread
}

function sortThreadsByUpdatedAt(threads: ThreadSummary[]): ThreadSummary[] {
  return [...threads].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

/**
 * 将 worker 返回的 ContextUsage 转换为 ThreadSnapshot 的 context 字段。
 * @param usage - worker 的上下文用量。
 * @returns ThreadSnapshot 可用的上下文数据；没有窗口信息时返回 undefined。
 */
function buildContextUsage(usage: ContextUsage | undefined): ThreadSnapshot['context'] {
  if (!usage) {
    return undefined
  }
  return {
    tokens: usage.tokens === null ? undefined : usage.tokens,
    contextWindow: usage.contextWindow,
    percent: usage.percent === null ? undefined : Math.round(usage.percent)
  }
}

type RenderableProjection = Pick<
  ThreadSnapshot,
  'messages' | 'toolCalls' | 'fileChanges' | 'sessionTree' | 'currentEntryId'
>

type LiveRenderableProjection = Pick<ThreadSnapshot, 'messages' | 'toolCalls' | 'fileChanges'>

function selectRenderableProjection(input: {
  liveProjection: LiveRenderableProjection | undefined
  persistedProjection: RenderableProjection | undefined
  liveState: Partial<ThreadLiveState>
}): RenderableProjection | LiveRenderableProjection | undefined {
  if (input.liveState.isStreaming) {
    return hasRenderableMessages(input.liveProjection)
      ? input.liveProjection
      : input.persistedProjection
  }
  if (input.liveState.isCompacting) {
    return hasRenderableMessages(input.persistedProjection)
      ? input.persistedProjection
      : input.liveProjection
  }
  if (!hasRenderableMessages(input.persistedProjection)) {
    return hasRenderableMessages(input.liveProjection) ? input.liveProjection : undefined
  }
  if (!hasRenderableMessages(input.liveProjection)) {
    return input.persistedProjection
  }
  return input.persistedProjection.messages.length >= input.liveProjection.messages.length
    ? input.persistedProjection
    : input.liveProjection
}

function hasRenderableMessages<T extends Pick<ThreadSnapshot, 'messages'>>(
  projection: T | undefined
): projection is T {
  return Boolean(projection?.messages.length)
}
