/**
 * 本文件组合 desktop main 进程中的 coding thread 管理能力。
 */

import type {
  CommandInfo,
  CompactInput,
  CompactionResult,
  CreateProjectInput,
  CreateThreadInput,
  DiagnosticsInput,
  ExtensionEditorTextInput,
  ExtensionPanelDisposeInput,
  ExtensionPanelLifecycleInput,
  ExtensionPanelMessageInput,
  ExtensionPanelStateInput,
  ExtensionShortcutInput,
  ExportSessionInput,
  ExportSessionResult,
  ExtensionUiResponseInput,
  ForkInput,
  ForkThreadInput,
  ForkThreadResult,
  ImportSessionInput,
  LoadSessionTreeBranchesInput,
  LoadSessionTreeBranchesResult,
  LoadSessionTreeChildrenInput,
  LoadSessionTreePathInput,
  LoginProviderOAuthInput,
  CustomProviderSummary,
  ModelOAuthPromptResponseInput,
  ModelCycleResult,
  ModelInfo,
  ModelOAuthLoginEvent,
  ModelRegistrySnapshot,
  ModelSettingsDiagnostic,
  ModelSettingsSnapshot,
  NavigateTreeInput,
  NavigateTreeResult,
  NewSessionInput,
  PromptInput,
  ProjectSummary,
  ProjectExtensionPathsInput,
  ProviderCredentialStatus,
  RenameThreadInput,
  RenameProjectInput,
  ApprovalResponseInput,
  HermesMemoryMutationInput,
  HermesMemorySnapshot,
  HermesMemorySnapshotInput,
  ResourcePackageInput,
  ResourcePackageProgressEvent,
  ResourcePackageSummary,
  ResourceSnapshotInput,
  ResourceSnapshot,
  RunCommandInput,
  RunCommandResult,
  SetSessionEntryLabelInput,
  SetThreadTitleInput,
  SetProjectTrustInput,
  SetModelInput,
  SetProviderApiKeyInput,
  SetThinkingInput,
  SwitchSessionInput,
  TextInput,
  ThinkingCycleResult,
  ThreadSnapshot,
  ThreadSummary,
  ToggleInput,
  AgentSettingsSnapshot,
  UpdateAgentSettingsInput,
  UpdateProjectExtensionPathsInput,
  UpdateResourcePackageInput,
  UpdateModelSettingsInput,
  UpsertCustomProviderInput
} from '@shared/coding-agent/types'
import { abort, followUp, prompt, runCommand, steer } from './thread-agent-commands'
import {
  archiveThread,
  createThread,
  restartThread,
  restoreThread,
  stopThread
} from './thread-lifecycle'
import {
  cycleModel,
  cycleThinkingLevel,
  listModels,
  setModel,
  setThinkingLevel
} from './thread-model-commands'
import {
  compact,
  abortRetry,
  dispatchExtensionShortcut,
  getCommands,
  respondApproval,
  respondUi,
  sendExtensionPanelLifecycleEvent,
  sendExtensionPanelMessage,
  syncExtensionEditorText,
  setAutoCompaction,
  setAutoRetry
} from './thread-runtime-controls'
import {
  clone,
  exportSession,
  fork,
  forkThread,
  importSession,
  loadSessionTreeBranches,
  loadSessionTreeChildren,
  loadSessionTreePath,
  navigateTree,
  newSession,
  renameThread,
  setSessionEntryLabel,
  setThreadTitle,
  switchSession
} from './thread-session-commands'
import { ThreadManagerCore } from './thread-manager-core'

export class ProjectTrustRefreshError extends AggregateError {
  constructor(
    readonly project: ProjectSummary,
    errors: unknown[]
  ) {
    super(errors, `failed to refresh Project trust workers: ${project.path}`)
    this.name = 'ProjectTrustRefreshError'
  }
}

/**
 * Desktop coding agent 线程管理器，提供线程生命周期、模型、会话、运行控制等操作。
 */
export class CodingThreadManager extends ThreadManagerCore {
  /**
   * 创建 Project。
   * @param input - 创建 Project 输入。
   * @returns Project 摘要。
   */
  createProject(input: CreateProjectInput): ProjectSummary {
    return this.getProjectTrustService().decorateProject(
      this.getProjectStore().createProject(input)
    )
  }

  /**
   * 打开 Project。
   * @param projectId - Project ID。
   * @returns Project 摘要。
   */
  openProject(projectId: string): ProjectSummary {
    return this.getProjectTrustService().decorateProject(
      this.getProjectStore().openProject(projectId)
    )
  }

  /**
   * 获取 Project。
   * @param projectId - Project ID。
   * @returns Project 摘要。
   */
  getProject(projectId: string): ProjectSummary {
    return this.getProjectTrustService().decorateProject(
      this.getProjectStore().requireProject(projectId)
    )
  }

  /**
   * 列出 Project。
   * @returns Project 摘要列表。
   */
  listProjects(): ProjectSummary[] {
    return this.getProjectTrustService().decorateProjects(this.getProjectStore().listProjects())
  }

  /**
   * 重命名 Project。
   * @param input - 重命名输入。
   */
  renameProject(input: RenameProjectInput): void {
    this.getProjectStore().updateProject(input.projectId, { name: input.name })
  }

  /**
   * 设置 Project trust 决策。
   * @param input - trust 输入。
   * @returns 更新后的 Project。
   */
  setProjectTrust(input: SetProjectTrustInput): Promise<ProjectSummary> {
    return this.runProjectWorkerLifecycle(input.projectId, async () => {
      const project = this.getProjectStore().requireProject(input.projectId)
      this.getProjectTrustService().setProjectTrust(project, input.decision)

      const activeThreadIds = this.getWorkers()
        .listLeases()
        .filter((lease) => this.requireThread(lease.threadId).projectId === project.projectId)
        .map((lease) => lease.threadId)
      const restartErrors: unknown[] = []
      for (const threadId of activeThreadIds) {
        try {
          await this.runThreadWorkerLifecycle(threadId, () => restartThread(this, threadId))
        } catch (error) {
          restartErrors.push(error)
        }
      }

      const updatedProject = this.getProject(input.projectId)
      if (restartErrors.length > 0) {
        throw new ProjectTrustRefreshError(updatedProject, restartErrors)
      }
      return updatedProject
    })
  }

  /**
   * 创建新线程。
   * @param input - 创建线程输入参数。
   * @returns 线程快照。
   */
  createThread(input: CreateThreadInput): Promise<ThreadSnapshot> {
    if (!input.projectId) {
      return createThread(this, input)
    }
    const threadId = input.threadId ?? crypto.randomUUID()
    return this.runProjectWorkerLifecycle(input.projectId, () =>
      this.runThreadWorkerLifecycle(threadId, () => createThread(this, { ...input, threadId }))
    )
  }

  /**
   * 停止指定线程。
   * @param threadId - 线程 ID。
   */
  stopThread(threadId: string): Promise<void> {
    return this.runThreadWorkerLifecycle(threadId, () => stopThread(this, threadId))
  }

  /**
   * 重新启动指定线程。
   * @param threadId - 线程 ID。
   * @returns 线程快照。
   */
  restartThread(threadId: string): Promise<ThreadSnapshot> {
    const projectId = this.requireThread(threadId).projectId
    return this.runProjectWorkerLifecycle(projectId, () =>
      this.runThreadWorkerLifecycle(threadId, () => restartThread(this, threadId))
    )
  }

  /**
   * 向线程发送提示。
   * @param input - 提示输入。
   */
  prompt(input: PromptInput): Promise<void> {
    return prompt(this, input)
  }

  /**
   * 向线程发送引导输入。
   * @param input - 文本输入。
   */
  steer(input: TextInput): Promise<void> {
    return steer(this, input)
  }

  /**
   * 向线程发送跟进输入。
   * @param input - 文本输入。
   */
  followUp(input: TextInput): Promise<void> {
    return followUp(this, input)
  }

  /**
   * 中止线程当前运行。
   * @param threadId - 线程 ID。
   */
  abort(threadId: string): Promise<void> {
    return abort(this, threadId)
  }

  /**
   * 创建新会话。
   * @param input - 新建会话输入。
   * @returns 线程快照。
   */
  newSession(input: NewSessionInput): Promise<ThreadSnapshot> {
    return newSession(this, input)
  }

  /**
   * 切换到指定会话。
   * @param input - 切换会话输入。
   * @returns 线程快照。
   */
  switchSession(input: SwitchSessionInput): Promise<ThreadSnapshot> {
    return switchSession(this, input)
  }

  /**
   * 导入会话。
   * @param input - 导入会话输入。
   * @returns 线程快照。
   */
  importSession(input: ImportSessionInput): Promise<ThreadSnapshot> {
    return importSession(this, input)
  }

  /**
   * 导出会话。
   * @param input - 导出会话输入。
   * @returns 导出结果。
   */
  exportSession(input: ExportSessionInput): Promise<ExportSessionResult> {
    return exportSession(this, input)
  }

  /**
   * 在指定位置分叉线程。
   * @param input - 分叉输入。
   * @returns 线程快照。
   */
  fork(input: ForkInput): Promise<ThreadSnapshot> {
    return fork(this, input)
  }

  /**
   * 从指定位置创建新的分支线程。
   * @param input - 分支输入。
   * @returns 分支线程创建结果。
   */
  forkThread(input: ForkThreadInput): Promise<ForkThreadResult> {
    return forkThread(this, input)
  }

  /**
   * 克隆线程。
   * @param threadId - 线程 ID。
   * @returns 线程快照。
   */
  clone(threadId: string): Promise<ThreadSnapshot> {
    return clone(this, threadId)
  }

  /**
   * 在当前 session tree 内导航。
   * @param input - 导航输入。
   * @returns 导航结果。
   */
  navigateTree(input: NavigateTreeInput): Promise<NavigateTreeResult> {
    return navigateTree(this, input)
  }

  /**
   * 加载 session tree 子节点。
   * @param input - 加载输入。
   * @returns 子节点列表。
   */
  loadSessionTreeChildren(
    input: LoadSessionTreeChildrenInput
  ): Promise<NonNullable<ThreadSnapshot['sessionTree']>> {
    return loadSessionTreeChildren(this, input)
  }

  /**
   * 加载 main 派生的扁平 branch 视图。
   * @param input - 加载输入。
   * @returns 扁平 branch rows。
   */
  loadSessionTreeBranches(
    input: LoadSessionTreeBranchesInput
  ): Promise<LoadSessionTreeBranchesResult> {
    return loadSessionTreeBranches(this, input)
  }

  /**
   * 加载 root 到指定 entry 的路径。
   * @param input - 加载输入。
   * @returns entry ID 路径。
   */
  loadSessionTreePath(input: LoadSessionTreePathInput): Promise<string[]> {
    return loadSessionTreePath(this, input)
  }

  /**
   * 设置 session entry label。
   * @param input - label 输入。
   * @returns 最新 snapshot。
   */
  setSessionEntryLabel(input: SetSessionEntryLabelInput): Promise<ThreadSnapshot> {
    return setSessionEntryLabel(this, input)
  }

  /**
   * 设置线程标题。
   * @param input - 标题输入。
   * @returns 更新后的线程摘要。
   */
  setThreadTitle(input: SetThreadTitleInput): Promise<ThreadSummary> {
    return setThreadTitle(this, input)
  }

  /**
   * 重命名线程。
   * @param input - 重命名输入。
   */
  renameThread(input: RenameThreadInput): Promise<void> {
    return renameThread(this, input)
  }

  /**
   * 归档线程。
   * @param threadId - 线程 ID。
   */
  archiveThread(threadId: string): Promise<void> {
    return this.runThreadWorkerLifecycle(threadId, () => archiveThread(this, threadId))
  }

  /**
   * 恢复归档线程。
   * @param threadId - 线程 ID。
   */
  restoreThread(threadId: string): Promise<void> {
    return restoreThread(this, threadId)
  }

  /**
   * 列出线程可用模型。
   * @param threadId - 线程 ID。
   * @returns 模型信息列表。
   */
  listModels(threadId: string): Promise<ModelInfo[]> {
    return listModels(this, threadId)
  }

  /**
   * 设置线程使用的模型。
   * @param input - 设置模型输入。
   */
  setModel(input: SetModelInput): Promise<void> {
    return setModel(this, input)
  }

  /**
   * 切换到下一个模型。
   * @param threadId - 线程 ID。
   * @returns 模型切换结果或 null。
   */
  cycleModel(threadId: string): Promise<ModelCycleResult | null> {
    return cycleModel(this, threadId)
  }

  /**
   * 设置线程思考级别。
   * @param input - 设置思考级别输入。
   */
  setThinkingLevel(input: SetThinkingInput): Promise<void> {
    return setThinkingLevel(this, input)
  }

  /**
   * 切换线程思考级别。
   * @param threadId - 线程 ID。
   * @returns 思考级别切换结果或 null。
   */
  cycleThinkingLevel(threadId: string): Promise<ThinkingCycleResult | null> {
    return cycleThinkingLevel(this, threadId)
  }

  /**
   * 压缩线程上下文。
   * @param input - 压缩输入。
   * @returns 压缩结果。
   */
  compact(input: CompactInput): Promise<CompactionResult> {
    return compact(this, input)
  }

  /**
   * 设置自动压缩开关。
   * @param input - 开关输入。
   */
  setAutoCompaction(input: ToggleInput): Promise<void> {
    return setAutoCompaction(this, input)
  }

  /**
   * 设置自动重试开关。
   * @param input - 开关输入。
   */
  setAutoRetry(input: ToggleInput): Promise<void> {
    return setAutoRetry(this, input)
  }

  /**
   * 中止重试。
   * @param threadId - 线程 ID。
   */
  abortRetry(threadId: string): Promise<void> {
    return abortRetry(this, threadId)
  }

  /**
   * 获取线程可用命令列表。
   * @param threadId - 线程 ID。
   * @returns 命令信息列表。
   */
  getCommands(threadId: string): Promise<CommandInfo[]> {
    return getCommands(this, threadId)
  }

  /**
   * 运行指定命令。
   * @param input - 命令输入。
   */
  runCommand(input: RunCommandInput): Promise<RunCommandResult | undefined> {
    return runCommand(this, input)
  }

  /**
   * 同步扩展可读取的编辑器文本缓存。
   * @param input - 编辑器文本输入。
   */
  syncExtensionEditorText(input: ExtensionEditorTextInput): Promise<void> {
    return syncExtensionEditorText(this, input)
  }

  /**
   * 触发扩展快捷键。
   * @param input - 快捷键输入。
   */
  dispatchExtensionShortcut(input: ExtensionShortcutInput): Promise<boolean> {
    return dispatchExtensionShortcut(this, input)
  }

  /**
   * 响应 UI 扩展请求。
   * @param input - 响应输入。
   */
  respondUi(input: ExtensionUiResponseInput): Promise<void> {
    return respondUi(this, input)
  }

  /**
   * 向扩展派发 desktop panel 消息。
   * @param input - panel 消息输入。
   */
  sendExtensionPanelMessage(input: ExtensionPanelMessageInput): Promise<void> {
    return sendExtensionPanelMessage(this, input)
  }

  /**
   * 向扩展派发 desktop panel 生命周期事件。
   * @param input - panel 生命周期输入。
   */
  sendExtensionPanelLifecycleEvent(input: ExtensionPanelLifecycleInput): Promise<void> {
    return sendExtensionPanelLifecycleEvent(this, input)
  }

  /**
   * 缓存 desktop panel state。
   * @param input - panel state 输入。
   */
  saveExtensionPanelState(input: ExtensionPanelStateInput): void {
    this.cacheExtensionPanelState(input.threadId, input.panelId, input.state)
  }

  /**
   * 销毁 desktop extension panel。
   * @param input - panel dispose 输入。
   */
  async disposeExtensionPanel(input: ExtensionPanelDisposeInput): Promise<void> {
    await this.disposeExtensionPanelRuntime(input.threadId, input.panelId, input.reason)
  }

  /**
   * 响应审批请求。
   * @param input - 审批响应输入。
   */
  respondApproval(input: ApprovalResponseInput): Promise<void> {
    return respondApproval(this, input)
  }

  /**
   * 列出 debug diagnostics。
   * @param input - 查询输入。
   * @returns diagnostics。
   */
  listDiagnostics(input: DiagnosticsInput = {}): unknown[] {
    return this.getStore()?.listDiagnostics(input) ?? []
  }

  /**
   * 获取全局模型设置快照。
   * @returns 模型设置快照。
   */
  getModelSettings(): Promise<ModelSettingsSnapshot> {
    return this.getModelSettingsService().then((service) => service.getModelSettings())
  }

  /**
   * 更新全局模型设置。
   * @param input - 更新输入。
   * @returns 模型设置快照。
   */
  updateModelSettings(input: UpdateModelSettingsInput): Promise<ModelSettingsSnapshot> {
    return this.getModelSettingsService().then((service) => service.updateModelSettings(input))
  }

  /**
   * 获取模型 registry。
   * @returns registry 快照。
   */
  listModelRegistry(): Promise<ModelRegistrySnapshot> {
    return this.getModelSettingsService().then((service) => service.listModelRegistry())
  }

  /**
   * 获取 provider 凭据状态。
   * @returns 凭据状态列表。
   */
  listProviderCredentials(): Promise<ProviderCredentialStatus[]> {
    return this.getModelSettingsService().then((service) => service.listProviderCredentials())
  }

  /**
   * 获取模型设置诊断。
   * @returns 诊断列表。
   */
  listModelDiagnostics(): Promise<ModelSettingsDiagnostic[]> {
    return this.getModelSettingsService().then((service) => service.listModelDiagnostics())
  }

  /**
   * 获取自定义 provider 摘要。
   * @returns 自定义 provider 摘要列表。
   */
  listCustomProviders(): Promise<CustomProviderSummary[]> {
    return this.getModelSettingsService().then((service) => service.listCustomProviders())
  }

  /**
   * 新增或更新自定义 provider。
   * @param input - provider 输入。
   * @returns 模型设置快照。
   */
  async upsertCustomProvider(input: UpsertCustomProviderInput): Promise<ModelSettingsSnapshot> {
    const snapshot = await (await this.getModelSettingsService()).upsertCustomProvider(input)
    this.refreshActiveThreadModelRegistries()
    return snapshot
  }

  /**
   * 删除自定义 provider。
   * @param provider - provider ID。
   * @returns 模型设置快照。
   */
  async deleteCustomProvider(provider: string): Promise<ModelSettingsSnapshot> {
    const snapshot = await (await this.getModelSettingsService()).deleteCustomProvider(provider)
    this.refreshActiveThreadModelRegistries()
    return snapshot
  }

  /**
   * 保存 provider API key 到 Pi-compatible auth.json。
   * @param input - API key 输入。
   * @returns 模型设置快照。
   */
  async setProviderApiKey(input: SetProviderApiKeyInput): Promise<ModelSettingsSnapshot> {
    const snapshot = await (await this.getModelSettingsService()).setProviderApiKey(input)
    this.refreshActiveThreadModelRegistries()
    return snapshot
  }

  /**
   * 使用 OAuth 登录 provider。
   * @param input - OAuth 登录输入。
   * @param onEvent - OAuth 登录事件回调。
   * @returns 模型设置快照。
   */
  async loginProviderOAuth(
    input: LoginProviderOAuthInput,
    onEvent?: (event: ModelOAuthLoginEvent) => void
  ): Promise<ModelSettingsSnapshot> {
    const snapshot = await (await this.getModelSettingsService()).loginProviderOAuth(input, onEvent)
    this.refreshActiveThreadModelRegistries()
    return snapshot
  }

  /**
   * 响应 OAuth 登录过程中的 renderer 输入请求。
   * @param input - OAuth prompt 响应。
   */
  async respondModelOAuthPrompt(input: ModelOAuthPromptResponseInput): Promise<void> {
    ;(await this.getModelSettingsService()).respondOAuthPrompt(input)
  }

  /**
   * 刷新模型 registry。
   * @returns 模型设置快照。
   */
  async refreshModelRegistry(): Promise<ModelSettingsSnapshot> {
    const snapshot = await (await this.getModelSettingsService()).refreshModelRegistry()
    this.refreshActiveThreadModelRegistries()
    return snapshot
  }

  /** 将 auth.json/models.json 变更同步到当前已绑定的 thread worker。 */
  private refreshActiveThreadModelRegistries(): void {
    const workers = this.getWorkers()
    for (const { threadId } of workers.listLeases()) {
      // 设置文件已经持久化成功，worker 同步不能反向阻塞设置页或保存操作。
      // 启动中、退出中或暂时无响应的 worker 会在后续模型查询时再次刷新 registry。
      void workers.send(threadId, { type: 'refresh_model_registry' }).catch(() => undefined)
    }
  }

  /**
   * 获取 Pi-compatible agent 设置快照。
   * @returns agent 设置快照。
   */
  getAgentSettings(): Promise<AgentSettingsSnapshot> {
    return this.getAgentSettingsService().then((service) => service.getAgentSettings())
  }

  /**
   * 更新 Pi-compatible agent 设置。
   * @param input - 更新输入。
   * @returns agent 设置快照。
   */
  updateAgentSettings(input: UpdateAgentSettingsInput): Promise<AgentSettingsSnapshot> {
    return this.getAgentSettingsService().then((service) => service.updateAgentSettings(input))
  }

  /** 列出 Pi package manager 配置包。 */
  listResourcePackages(): Promise<ResourcePackageSummary[]> {
    return this.getAgentSettingsService().then((service) => service.listResourcePackages())
  }

  /** 获取 Pi-compatible resource / extension 发现快照。 */
  async getResourceSnapshot(input: ResourceSnapshotInput = {}): Promise<ResourceSnapshot> {
    const service = await this.getAgentSettingsService()
    if (input.threadId) {
      const thread = this.requireThread(input.threadId)
      const cwd = this.getThreadCwd(thread)
      return service.getResourceSnapshot({
        cwd,
        projectTrusted: this.getProjectTrustOverride(cwd)
      })
    }
    return service.getResourceSnapshot(input)
  }

  /** 获取无需会话的 Hermes Memory 设置快照。 */
  getHermesMemorySnapshot(input: HermesMemorySnapshotInput = {}): Promise<HermesMemorySnapshot> {
    return this.getAgentSettingsService().then((service) => service.getHermesMemorySnapshot(input))
  }

  /** 无需会话地修改 Hermes Memory。 */
  mutateHermesMemory(input: HermesMemoryMutationInput): Promise<HermesMemorySnapshot> {
    return this.getAgentSettingsService().then((service) => service.mutateHermesMemory(input))
  }

  /** 获取 Project 本地 extension 路径配置。 */
  getProjectExtensionPaths(input: ProjectExtensionPathsInput): Promise<string[]> {
    return this.getAgentSettingsService().then((service) => service.getProjectExtensionPaths(input))
  }

  /** 更新 Project 本地 extension 路径配置。 */
  updateProjectExtensionPaths(input: UpdateProjectExtensionPathsInput): Promise<string[]> {
    return this.getAgentSettingsService().then((service) =>
      service.updateProjectExtensionPaths(input)
    )
  }

  /** 新增并持久化 package source。 */
  addResourcePackage(input: ResourcePackageInput): Promise<ResourcePackageSummary[]> {
    return this.getAgentSettingsService().then((service) => service.addResourcePackage(input))
  }

  /** 安装并持久化 package source。 */
  installResourcePackage(
    input: ResourcePackageInput,
    onEvent?: (event: ResourcePackageProgressEvent) => void
  ): Promise<ResourcePackageSummary[]> {
    return this.getAgentSettingsService().then((service) =>
      service.installResourcePackage(input, onEvent)
    )
  }

  /** 移除并持久化 package source。 */
  removeResourcePackage(input: ResourcePackageInput): Promise<ResourcePackageSummary[]> {
    return this.getAgentSettingsService().then((service) => service.removeResourcePackage(input))
  }

  /** 更新已配置 package source。 */
  updateResourcePackage(
    input?: UpdateResourcePackageInput,
    onEvent?: (event: ResourcePackageProgressEvent) => void
  ): Promise<ResourcePackageSummary[]> {
    return this.getAgentSettingsService().then((service) =>
      service.updateResourcePackage(input, onEvent)
    )
  }

  /**
   * 关闭管理器并释放所有 worker。
   */
  shutdown(): Promise<void> {
    return this.getWorkers().shutdown()
  }
}
