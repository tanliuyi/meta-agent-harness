/**
 * coding-agent.ts - Coding Agent API 封装
 *
 * 统一封装 window.api.codingAgent 的所有调用，提供类型安全的 API 接口。
 */

import type { AGUIEvent, RunAgentInput } from '@ag-ui/core'
import type {
  AgentSettingsSnapshot,
  ApprovalResponseInput,
  CodingAgentIpcEvent,
  CompactInput,
  ConnectAgentInput,
  CreateThreadInput,
  CustomProviderSummary,
  DiagnosticsInput,
  DisconnectAgentInput,
  ExportSessionInput,
  ExportSessionResult,
  ExtensionPanelDisposeInput,
  ExtensionPanelLifecycleInput,
  ExtensionPanelMessageInput,
  ExtensionPanelStateInput,
  ExtensionShortcutInput,
  ExtensionUiResponseInput,
  FileReferenceCompletionInput,
  FileReferenceCompletionResult,
  ForkInput,
  ForkThreadInput,
  ForkThreadResult,
  HermesMemoryMutationInput,
  HermesMemorySnapshot,
  HermesMemorySnapshotInput,
  ImportSessionInput,
  ListThreadsInput,
  LoadSessionTreeBranchesInput,
  LoadSessionTreeBranchesResult,
  LoadSessionTreeChildrenInput,
  LoadSessionTreePathInput,
  ModelCycleResult,
  ModelInfo,
  ModelOAuthPromptResponseInput,
  ModelRegistrySnapshot,
  ModelSettingsSnapshot,
  NavigateTreeInput,
  NavigateTreeResult,
  NewSessionInput,
  OpenChangedFileInput,
  OpenChangedFileResult,
  OpenExternalUrlInput,
  PromptInput,
  ProjectExtensionPathsInput,
  ProjectSummary,
  RenameProjectInput,
  RevealResourcePathInput,
  ResourcePackageInput,
  ResourcePackageListInput,
  ResourcePackageSummary,
  ResourceSnapshot,
  ResourceSnapshotInput,
  RunCommandInput,
  RunCommandResult,
  SelectResourcePathInput,
  SelectSessionFileInput,
  SetModelInput,
  SetProjectTrustInput,
  SetProviderApiKeyInput,
  SetSessionEntryLabelInput,
  SetThinkingInput,
  SetThreadTitleInput,
  SwitchSessionInput,
  TextInput,
  ThreadSnapshot,
  ThreadSummary,
  ThinkingCycleResult,
  ToggleInput,
  UpdateAgentSettingsInput,
  UpdateDesktopUiPreferencesInput,
  UpdateModelSettingsInput,
  UpdateProjectExtensionPathsInput,
  UpdateResourcePackageInput,
  UpsertCustomProviderInput,
  LoginProviderOAuthInput,
  DesktopUiPreferences,
  PromptImageAttachment,
  PromptImageDraft,
  DeleteProjectResult,
  RenameThreadInput,
  ExtensionEditorTextInput
} from '@shared/coding-agent/types'

/** Coding Agent API 封装类 */
export const codingAgentApi = {
  // ==================== Project 管理 ====================

  /** 列出所有 Project */
  listProjects(): Promise<ProjectSummary[]> {
    return window.api.codingAgent.listProjects()
  },

  /** 打开目录选择器并创建 Project */
  createProject(): Promise<ProjectSummary | undefined> {
    return window.api.codingAgent.createProject()
  },

  /** 打开 Project */
  openProject(projectId: string): Promise<ProjectSummary> {
    return window.api.codingAgent.openProject(projectId)
  },

  /** 获取 Project */
  getProject(projectId: string): Promise<ProjectSummary> {
    return window.api.codingAgent.getProject(projectId)
  },

  /** 重命名 Project */
  renameProject(input: RenameProjectInput): Promise<void> {
    return window.api.codingAgent.renameProject(input)
  },

  /** 删除 Project */
  deleteProject(projectId: string): Promise<DeleteProjectResult> {
    return window.api.codingAgent.deleteProject(projectId)
  },

  /** 设置 Project trust */
  setProjectTrust(input: SetProjectTrustInput): Promise<ProjectSummary> {
    return window.api.codingAgent.setProjectTrust(input)
  },

  // ==================== Thread 管理 ====================

  /** 创建新线程 */
  createThread(input: CreateThreadInput): Promise<ThreadSnapshot> {
    return window.api.codingAgent.createThread(input)
  },

  /** 停止线程运行 */
  stopThread(threadId: string): Promise<void> {
    return window.api.codingAgent.stopThread(threadId)
  },

  /** 重新启动线程 */
  restartThread(threadId: string): Promise<ThreadSnapshot> {
    return window.api.codingAgent.restartThread(threadId)
  },

  /** 列出所有线程 */
  listThreads(input?: ListThreadsInput): Promise<ThreadSummary[]> {
    return input ? window.api.codingAgent.listThreads(input) : window.api.codingAgent.listThreads()
  },

  /** 获取线程详情 */
  getThread(threadId: string): Promise<ThreadSnapshot> {
    return window.api.codingAgent.getThread(threadId)
  },

  /** 获取线程快照 */
  getSnapshot(threadId: string): Promise<ThreadSnapshot> {
    return window.api.codingAgent.getSnapshot(threadId)
  },

  /** 连接 thread 的 AG-UI event stream。 */
  connectAgent(input: ConnectAgentInput): Promise<void> {
    return window.api.codingAgent.connectAgent(input)
  },

  /** 按 thread 所有权断开 AG-UI event stream。 */
  disconnectAgent(input: DisconnectAgentInput): Promise<void> {
    return window.api.codingAgent.disconnectAgent(input)
  },

  /** 使用标准 AG-UI input 发起一次 agent run。 */
  runAgent(input: RunAgentInput): Promise<void> {
    return window.api.codingAgent.runAgent(input)
  },

  /** 设置线程标题 */
  setThreadTitle(input: SetThreadTitleInput): Promise<ThreadSummary> {
    return window.api.codingAgent.setThreadTitle(input)
  },

  /** 重命名线程 */
  renameThread(input: RenameThreadInput): Promise<void> {
    return window.api.codingAgent.renameThread(input)
  },

  /** 归档线程 */
  archiveThread(threadId: string): Promise<void> {
    return window.api.codingAgent.archiveThread(threadId)
  },

  /** 恢复归档线程 */
  restoreThread(threadId: string): Promise<void> {
    return window.api.codingAgent.restoreThread(threadId)
  },

  // ==================== 消息与交互 ====================

  /** @deprecated 使用 runAgent。 */
  prompt(input: PromptInput): Promise<void> {
    return window.api.codingAgent.prompt(input)
  },

  /** 向线程发送引导输入 */
  steer(input: TextInput): Promise<void> {
    return window.api.codingAgent.steer(input)
  },

  /** 向线程发送跟进输入 */
  followUp(input: TextInput): Promise<void> {
    return window.api.codingAgent.followUp(input)
  },

  /** 选择并处理 prompt 图片附件 */
  selectPromptImages(): Promise<PromptImageAttachment[] | undefined> {
    return window.api.codingAgent.selectPromptImages()
  },

  /** 直接处理本地 prompt 图片文件 */
  processPromptImageFiles(files: File[]): Promise<PromptImageAttachment[]> {
    return window.api.codingAgent.processPromptImageFiles(files)
  },

  /** 暂存并处理 prompt 图片附件 */
  stagePromptImages(images: PromptImageDraft[]): Promise<PromptImageAttachment[]> {
    return window.api.codingAgent.stagePromptImages(images)
  },

  /** 中止当前运行 */
  abort(threadId: string): Promise<void> {
    return window.api.codingAgent.abort(threadId)
  },

  // ==================== Session 管理 ====================

  /** 创建新会话 */
  newSession(input: NewSessionInput): Promise<ThreadSnapshot> {
    return window.api.codingAgent.newSession(input)
  },

  /** 切换会话 */
  switchSession(input: SwitchSessionInput): Promise<ThreadSnapshot> {
    return window.api.codingAgent.switchSession(input)
  },

  /** 导入会话 */
  importSession(input: ImportSessionInput): Promise<ThreadSnapshot> {
    return window.api.codingAgent.importSession(input)
  },

  /** 导出会话 */
  exportSession(input: ExportSessionInput): Promise<ExportSessionResult> {
    return window.api.codingAgent.exportSession(input)
  },

  // ==================== 分叉与克隆 ====================

  /** 分叉线程 */
  fork(input: ForkInput): Promise<ThreadSnapshot> {
    return window.api.codingAgent.fork(input)
  },

  /** 从指定节点创建新的分支线程 */
  forkThread(input: ForkThreadInput): Promise<ForkThreadResult> {
    return window.api.codingAgent.forkThread(input)
  },

  /** 克隆线程 */
  clone(threadId: string): Promise<ThreadSnapshot> {
    return window.api.codingAgent.clone(threadId)
  },

  // ==================== Session Tree ====================

  /** 在当前 session tree 内导航 */
  navigateTree(input: NavigateTreeInput): Promise<NavigateTreeResult> {
    return window.api.codingAgent.navigateTree(input)
  },

  /** 加载 session tree 子节点 */
  loadSessionTreeChildren(input: LoadSessionTreeChildrenInput) {
    return window.api.codingAgent.loadSessionTreeChildren(input)
  },

  /** 加载 main 派生的扁平 tree 视图 */
  loadSessionTreeBranches(
    input: LoadSessionTreeBranchesInput
  ): Promise<LoadSessionTreeBranchesResult> {
    return window.api.codingAgent.loadSessionTreeBranches(input)
  },

  /** 加载 root 到指定 entry 的路径 */
  loadSessionTreePath(input: LoadSessionTreePathInput): Promise<string[]> {
    return window.api.codingAgent.loadSessionTreePath(input)
  },

  /** 设置 session entry label */
  setSessionEntryLabel(input: SetSessionEntryLabelInput): Promise<ThreadSnapshot> {
    return window.api.codingAgent.setSessionEntryLabel(input)
  },

  // ==================== 模型与思考 ====================

  /** 列出可用的模型 */
  listModels(threadId: string): Promise<ModelInfo[]> {
    return window.api.codingAgent.listModels(threadId)
  },

  /** 设置当前模型 */
  setModel(input: SetModelInput): Promise<void> {
    return window.api.codingAgent.setModel(input)
  },

  /** 循环切换到下一个模型 */
  cycleModel(threadId: string): Promise<ModelCycleResult | null> {
    return window.api.codingAgent.cycleModel(threadId)
  },

  /** 设置思考级别 */
  setThinkingLevel(input: SetThinkingInput): Promise<void> {
    return window.api.codingAgent.setThinkingLevel(input)
  },

  /** 循环切换思考级别 */
  cycleThinkingLevel(threadId: string): Promise<ThinkingCycleResult | null> {
    return window.api.codingAgent.cycleThinkingLevel(threadId)
  },

  // ==================== 上下文与命令 ====================

  /** 压缩线程上下文 */
  compact(input: CompactInput) {
    return window.api.codingAgent.compact(input)
  },

  /** 设置自动压缩 */
  setAutoCompaction(input: ToggleInput): Promise<void> {
    return window.api.codingAgent.setAutoCompaction(input)
  },

  /** 设置自动重试 */
  setAutoRetry(input: ToggleInput): Promise<void> {
    return window.api.codingAgent.setAutoRetry(input)
  },

  /** 中止重试 */
  abortRetry(threadId: string): Promise<void> {
    return window.api.codingAgent.abortRetry(threadId)
  },

  /** 获取可用命令列表 */
  getCommands(threadId: string) {
    return window.api.codingAgent.getCommands(threadId)
  },

  /** 运行指定命令 */
  runCommand(input: RunCommandInput): Promise<RunCommandResult | undefined> {
    return window.api.codingAgent.runCommand(input)
  },

  // ==================== 扩展相关 ====================

  /** 同步编辑器文本给扩展运行时 */
  syncExtensionEditorText(input: ExtensionEditorTextInput): Promise<void> {
    return window.api.codingAgent.syncExtensionEditorText(input)
  },

  /** 触发扩展快捷键 */
  dispatchExtensionShortcut(input: ExtensionShortcutInput): Promise<boolean> {
    return window.api.codingAgent.dispatchExtensionShortcut(input)
  },

  /** 响应 UI 扩展请求 */
  respondUi(input: ExtensionUiResponseInput): Promise<void> {
    return window.api.codingAgent.respondUi(input)
  },

  /** 向扩展派发 desktop panel 消息 */
  sendExtensionPanelMessage(input: ExtensionPanelMessageInput): Promise<void> {
    return window.api.codingAgent.sendExtensionPanelMessage(input)
  },

  /** 向扩展派发 desktop panel 生命周期事件 */
  sendExtensionPanelLifecycleEvent(input: ExtensionPanelLifecycleInput): Promise<void> {
    return window.api.codingAgent.sendExtensionPanelLifecycleEvent(input)
  },

  /** 缓存 desktop panel state */
  saveExtensionPanelState(input: ExtensionPanelStateInput): Promise<void> {
    return window.api.codingAgent.saveExtensionPanelState(input)
  },

  /** 销毁 desktop extension panel */
  disposeExtensionPanel(input: ExtensionPanelDisposeInput): Promise<void> {
    return window.api.codingAgent.disposeExtensionPanel(input)
  },

  // ==================== 审批与 UI ====================

  /** 响应审批请求 */
  respondApproval(input: ApprovalResponseInput): Promise<void> {
    return window.api.codingAgent.respondApproval(input)
  },

  /** 受控打开外部 URL */
  openExternalUrl(input: OpenExternalUrlInput): Promise<void> {
    return window.api.codingAgent.openExternalUrl(input)
  },

  // ==================== 文件与资源 ====================

  /** 选择资源路径 */
  selectResourcePath(input?: SelectResourcePathInput): Promise<string[] | undefined> {
    return window.api.codingAgent.selectResourcePath(input)
  },

  /** 选择 Pi-compatible session 文件 */
  selectSessionFile(input?: SelectSessionFileInput): Promise<string | undefined> {
    return window.api.codingAgent.selectSessionFile(input)
  },

  /** 在系统资源管理器中显示资源路径 */
  revealResourcePath(input: RevealResourcePathInput): Promise<void> {
    return window.api.codingAgent.revealResourcePath(input)
  },

  /** 打开或定位当前 thread snapshot 中的变更文件 */
  openChangedFile(input: OpenChangedFileInput): Promise<OpenChangedFileResult> {
    return window.api.codingAgent.openChangedFile(input)
  },

  /** 补全 prompt 中的 Pi @file 文件引用 */
  completeFileReference(
    input: FileReferenceCompletionInput
  ): Promise<FileReferenceCompletionResult> {
    return window.api.codingAgent.completeFileReference(input)
  },

  // ==================== 诊断 ====================

  /** 获取 debug diagnostics */
  listDiagnostics(input?: DiagnosticsInput): Promise<unknown[]> {
    return window.api.codingAgent.listDiagnostics(input)
  },

  // ==================== 模型设置 ====================

  /** 获取全局模型设置快照 */
  getModelSettings(): Promise<ModelSettingsSnapshot> {
    return window.api.codingAgent.getModelSettings()
  },

  /** 更新全局模型设置 */
  updateModelSettings(input: UpdateModelSettingsInput): Promise<ModelSettingsSnapshot> {
    return window.api.codingAgent.updateModelSettings(input)
  },

  /** 获取全局模型 registry */
  listModelRegistry(): Promise<ModelRegistrySnapshot> {
    return window.api.codingAgent.listModelRegistry()
  },

  /** 获取 provider 凭据状态 */
  listProviderCredentials() {
    return window.api.codingAgent.listProviderCredentials()
  },

  /** 获取模型设置诊断 */
  listModelDiagnostics() {
    return window.api.codingAgent.listModelDiagnostics()
  },

  /** 获取自定义 provider 摘要 */
  listCustomProviders(): Promise<CustomProviderSummary[]> {
    return window.api.codingAgent.listCustomProviders()
  },

  /** 新增或更新自定义 provider */
  upsertCustomProvider(input: UpsertCustomProviderInput): Promise<ModelSettingsSnapshot> {
    return window.api.codingAgent.upsertCustomProvider(input)
  },

  /** 删除自定义 provider */
  deleteCustomProvider(provider: string): Promise<ModelSettingsSnapshot> {
    return window.api.codingAgent.deleteCustomProvider(provider)
  },

  /** 保存 provider API key */
  setProviderApiKey(input: SetProviderApiKeyInput): Promise<ModelSettingsSnapshot> {
    return window.api.codingAgent.setProviderApiKey(input)
  },

  /** 使用 OAuth 登录 provider */
  loginProviderOAuth(input: LoginProviderOAuthInput): Promise<ModelSettingsSnapshot> {
    return window.api.codingAgent.loginProviderOAuth(input)
  },

  /** 响应 OAuth 登录过程中的 renderer 输入请求 */
  respondModelOAuthPrompt(input: ModelOAuthPromptResponseInput): Promise<void> {
    return window.api.codingAgent.respondModelOAuthPrompt(input)
  },

  /** 刷新模型 registry */
  refreshModelRegistry(): Promise<ModelSettingsSnapshot> {
    return window.api.codingAgent.refreshModelRegistry()
  },

  // ==================== UI 偏好 ====================

  /** 获取 Desktop UI 偏好 */
  getDesktopUiPreferences(): Promise<DesktopUiPreferences> {
    return window.api.codingAgent.getDesktopUiPreferences()
  },

  /** 更新 Desktop UI 偏好 */
  updateDesktopUiPreferences(
    input: UpdateDesktopUiPreferencesInput
  ): Promise<DesktopUiPreferences> {
    return window.api.codingAgent.updateDesktopUiPreferences(input)
  },

  // ==================== Agent 设置 ====================

  /** 获取 Pi-compatible agent 设置 */
  getAgentSettings(): Promise<AgentSettingsSnapshot> {
    return window.api.codingAgent.getAgentSettings()
  },

  /** 更新 Pi-compatible agent 设置 */
  updateAgentSettings(input: UpdateAgentSettingsInput): Promise<AgentSettingsSnapshot> {
    return window.api.codingAgent.updateAgentSettings(input)
  },

  // ==================== 资源与扩展 ====================

  /** 获取 Pi-compatible resource / extension 发现快照 */
  getResourceSnapshot(input?: ResourceSnapshotInput): Promise<ResourceSnapshot> {
    return window.api.codingAgent.getResourceSnapshot(input)
  },

  /** 获取无需活跃会话的 Hermes Memory 设置快照 */
  getHermesMemorySnapshot(input?: HermesMemorySnapshotInput): Promise<HermesMemorySnapshot> {
    return window.api.codingAgent.getHermesMemorySnapshot(input)
  },

  /** 无需活跃会话地修改 Hermes Memory */
  mutateHermesMemory(input: HermesMemoryMutationInput): Promise<HermesMemorySnapshot> {
    return window.api.codingAgent.mutateHermesMemory(input)
  },

  /** 获取项目级 extension 路径配置 */
  getProjectExtensionPaths(input: ProjectExtensionPathsInput): Promise<string[]> {
    return window.api.codingAgent.getProjectExtensionPaths(input)
  },

  /** 更新项目级 extension 路径配置 */
  updateProjectExtensionPaths(input: UpdateProjectExtensionPathsInput): Promise<string[]> {
    return window.api.codingAgent.updateProjectExtensionPaths(input)
  },

  // ==================== 资源包管理 ====================

  /** 列出 Pi package manager 配置包 */
  listResourcePackages(input?: ResourcePackageListInput): Promise<ResourcePackageSummary[]> {
    return window.api.codingAgent.listResourcePackages(input)
  },

  /** 新增并持久化 package source */
  addResourcePackage(input: ResourcePackageInput): Promise<ResourcePackageSummary[]> {
    return window.api.codingAgent.addResourcePackage(input)
  },

  /** 安装并持久化 package source */
  installResourcePackage(input: ResourcePackageInput): Promise<ResourcePackageSummary[]> {
    return window.api.codingAgent.installResourcePackage(input)
  },

  /** 移除并持久化 package source */
  removeResourcePackage(input: ResourcePackageInput): Promise<ResourcePackageSummary[]> {
    return window.api.codingAgent.removeResourcePackage(input)
  },

  /** 更新已配置 package source */
  updateResourcePackage(input?: UpdateResourcePackageInput): Promise<ResourcePackageSummary[]> {
    return window.api.codingAgent.updateResourcePackage(input)
  },

  // ==================== 事件监听 ====================

  /** 注册事件监听器，返回取消订阅函数 */
  onEvent(listener: (event: CodingAgentIpcEvent) => void): () => void {
    return window.api.codingAgent.onEvent(listener)
  },

  /** 监听当前已连接 thread 的标准 AG-UI event。 */
  onAgentEvent(listener: (event: AGUIEvent) => void): () => void {
    return window.api.codingAgent.onAgentEvent(listener)
  }
}
