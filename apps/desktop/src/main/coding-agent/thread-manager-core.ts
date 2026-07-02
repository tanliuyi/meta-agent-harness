/**
 * 本文件提供 CodingThreadManager 共享的 thread registry 与 worker send 能力。
 */

import type { ThreadSnapshot, ThreadSummary } from '@shared/coding-agent/types'
import type { WorkerCommand, WorkerResponseEnvelope } from './worker-types'
import type {
  ThreadLiveState,
  ThreadMessagesResponse
} from '../../../../../packages/coding-agent/src/desktop/protocol/thread'
import type { ThreadWorkerRegistry } from './thread-worker-registry'
import type { CodingThreadStore } from './thread-store'
import type { ProjectStore } from './project-store'
import type { ProjectTrustService } from './project-trust-service'
import type { ModelSettingsService } from './model-settings-service'
import type { AgentSettingsService } from './agent-settings-service'
import { buildSnapshotFromSession, toThreadMessages } from './session-snapshot'
import { resolveSessionCwd } from '../../../../../packages/coding-agent/src/core/session-manager'

/**
 * Coding thread 管理核心类，负责线程注册、worker 路由和快照构建。
 */
export class ThreadManagerCore {
  /** 内存中的线程摘要映射。 */
  protected readonly threads = new Map<string, ThreadSummary>()
  /** Thread worker registry 实例。 */
  protected readonly workers: ThreadWorkerRegistry
  /** 可选的持久化线程 store。 */
  private readonly store: CodingThreadStore | undefined
  /** Project registry。 */
  private readonly projectStore: ProjectStore | undefined
  /** Project trust 服务。 */
  private readonly projectTrustService: ProjectTrustService | undefined
  /** 全局模型设置服务。 */
  private readonly modelSettingsService: ModelSettingsService | undefined
  /** 全局 Pi agent 设置服务。 */
  private readonly agentSettingsService: AgentSettingsService | undefined

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
    modelSettingsService?: ModelSettingsService,
    agentSettingsService?: AgentSettingsService
  ) {
    this.workers = workers
    this.store = store
    this.projectStore = projectStore
    this.projectTrustService = projectTrustService
    this.modelSettingsService = modelSettingsService
    this.agentSettingsService = agentSettingsService
    for (const thread of store?.listThreads() ?? []) {
      console.debug(`[ThreadManagerCore] load thread from store: ${thread.threadId}`, thread)
      this.threads.set(thread.threadId, thread)
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
    this.threads.set(thread.threadId, thread)
    try {
      this.store?.saveThread(thread)
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
   * 获取持久化 store。
   * @returns store 或 undefined。
   */
  getStore(): CodingThreadStore | undefined {
    return this.store
  }

  /**
   * 列出所有线程摘要。
   * @returns 线程摘要数组。
   */
  listThreads(input: { projectId?: string } = {}): ThreadSummary[] {
    const threads = [...this.threads.values()]
    if (!input.projectId) {
      return threads
    }
    return threads.filter((thread) => thread.projectId === input.projectId)
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
    console.debug(`[ThreadManagerCore] getSnapshot threadId=${threadId} thread=`, thread)
    if (!this.hasWorker(threadId)) {
      return this.buildSnapshotFromSessionFile(thread) ?? this.buildSnapshot(thread)
    }
    const response = await this.workers.send(threadId, { type: 'get_state' })
    console.debug(`[ThreadManagerCore] getSnapshot threadId=${threadId} response=`, response)

    if (response.success) {
      const liveMessages = await this.getLiveMessages(threadId)
      this.syncThreadMetadataFromLiveState(thread, response.data as Partial<ThreadLiveState>)
      const snapshot = this.buildSnapshot(thread, {
        ...(response.data as ThreadLiveState),
        ...(liveMessages ? { messages: liveMessages } : {})
      })
      console.debug(`[ThreadManagerCore] getSnapshot threadId=${threadId} snapshot=`, snapshot)
      return snapshot
    }
    if (
      isMissingWorkerResponse(response) ||
      (thread.status !== 'idle' && thread.status !== 'running')
    ) {
      console.debug(
        `[ThreadManagerCore] getSnapshot threadId=${threadId} fallback to session file or memory`
      )
      return this.buildSnapshotFromSessionFile(thread) ?? this.buildSnapshot(thread)
    }
    throwResponseError(response)
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
    if (Object.keys(patch).length > 0) {
      this.updateThread(thread.threadId, patch)
    }
  }

  /**
   * 从 Pi live runtime 读取完整 messages。
   * @param threadId - 线程 ID。
   * @returns desktop messages 或 undefined。
   */
  private async getLiveMessages(threadId: string): Promise<ThreadSnapshot['messages'] | undefined> {
    const response = await this.workers.send(threadId, { type: 'get_messages' })
    if (!response.success) {
      if (isMissingWorkerResponse(response)) {
        return undefined
      }
      throwResponseError(response)
    }
    const data = response.data as ThreadMessagesResponse | undefined
    return data ? toThreadMessages(data.messages) : undefined
  }

  /**
   * 向 worker 发送命令并忽略返回数据。
   * @param threadId - 线程 ID。
   * @param command - 要发送的命令。
   * @throws 当 worker 响应失败时。
   */
  async sendOk(threadId: string, command: WorkerCommand): Promise<void> {
    await this.ensureWorker(threadId)
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
    await this.ensureWorker(threadId)
    const response = await this.workers.send(threadId, command)
    if (!response.success) {
      throwResponseError(response)
    }
    return response.data as T
  }

  /**
   * 根据线程摘要和 worker 状态构建快照。
   * @param thread - 线程摘要。
   * @param state - 可选的 worker 状态数据。
   * @returns 线程快照。
   */
  protected buildSnapshot(
    thread: ThreadSummary,
    state: Partial<ThreadLiveState> & Partial<Pick<ThreadSnapshot, 'messages'>> = {}
  ): ThreadSnapshot {
    return {
      threadId: thread.threadId,
      projectId: thread.projectId,
      cwd: state.cwd ?? this.getThreadCwd(thread),
      sessionFile: state.sessionFile ?? thread.sessionFile,
      title: state.sessionName ?? thread.title,
      status: thread.status,
      model: state.model,
      thinkingLevel: state.thinkingLevel ?? 'off',
      messages: state.messages ?? [],
      toolCalls: [],
      fileChanges: [],
      approvals: [],
      queue: {
        steering: [],
        followUp: []
      },
      diagnostics: []
    }
  }

  /**
   * 从 JSONL session 文件构建 snapshot。
   * @param thread - 线程摘要。
   * @returns snapshot 或 undefined。
   */
  private buildSnapshotFromSessionFile(thread: ThreadSummary): ThreadSnapshot | undefined {
    if (!thread.sessionFile) {
      return undefined
    }
    try {
      return buildSnapshotFromSession({
        thread,
        cwd: this.getThreadCwd(thread),
        sessionFile: thread.sessionFile
      })
    } catch (error) {
      this.saveStoreDiagnostic(thread.threadId, error)
      return undefined
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
    this.saveThread({ ...thread, ...patch, updatedAt: new Date().toISOString() })
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
  getModelSettingsService(): ModelSettingsService {
    if (!this.modelSettingsService) {
      throw new Error('model settings service is required')
    }
    return this.modelSettingsService
  }

  /**
   * 获取全局 Pi agent 设置服务。
   * @returns AgentSettingsService。
   * @throws 当未配置服务时。
   */
  getAgentSettingsService(): AgentSettingsService {
    if (!this.agentSettingsService) {
      throw new Error('agent settings service is required')
    }
    return this.agentSettingsService
  }

  /**
   * 获取线程启动用的 Project trust 覆盖。
   * @param cwd - Project cwd。
   * @returns 是否加载 Project 本地资源。
   */
  getProjectTrustOverride(cwd: string): boolean {
    return this.projectTrustService?.isProjectTrusted(cwd) ?? false
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
    const cwd = thread.sessionFile
      ? resolveSessionCwd(thread.sessionFile, this.getThreadCwd(thread))
      : this.getThreadCwd(thread)
    this.updateThread(threadId, { status: 'starting' })
    await this.workers.acquireThreadWorker({
      threadId,
      cwd,
      sessionFile: thread.sessionFile,
      title: thread.title,
      projectTrustOverride: this.getProjectTrustOverride(cwd)
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
  return response.error?.code === 'thread_not_found' || response.error?.code === 'worker_not_found'
}
