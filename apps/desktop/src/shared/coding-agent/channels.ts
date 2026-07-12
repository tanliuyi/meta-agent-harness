/**
 * 本文件定义 desktop coding agent IPC channel 名称。
 */

export const codingAgentChannels = {
  /** 创建 Project。 */
  createProject: 'coding-agent:create-project',
  /** 打开 Project。 */
  openProject: 'coding-agent:open-project',
  /** 获取 Project。 */
  getProject: 'coding-agent:get-project',
  /** 列出 Project。 */
  listProjects: 'coding-agent:list-projects',
  /** 重命名 Project。 */
  renameProject: 'coding-agent:rename-project',
  /** 删除 Project 及其 thread metadata。 */
  deleteProject: 'coding-agent:delete-project',
  /** 设置 Project trust。 */
  setProjectTrust: 'coding-agent:set-project-trust',
  /** 创建新线程。 */
  createThread: 'coding-agent:create-thread',
  /** 停止线程运行。 */
  stopThread: 'coding-agent:stop-thread',
  /** 重新启动已停止的线程。 */
  restartThread: 'coding-agent:restart-thread',
  /** 列出所有线程。 */
  listThreads: 'coding-agent:list-threads',
  /** 获取单个线程信息。 */
  getThread: 'coding-agent:get-thread',
  /** 获取线程快照。 */
  getSnapshot: 'coding-agent:get-snapshot',
  /** 向线程发送用户提示。 */
  prompt: 'coding-agent:prompt',
  /** 向线程发送引导/转向输入。 */
  steer: 'coding-agent:steer',
  /** 向线程发送跟进输入。 */
  followUp: 'coding-agent:follow-up',
  /** 选择并处理 prompt 图片附件。 */
  selectPromptImages: 'coding-agent:select-prompt-images',
  /** 直接处理本地 prompt 图片文件。 */
  processPromptImageFiles: 'coding-agent:process-prompt-image-files',
  /** 暂存并处理 prompt 图片附件。 */
  stagePromptImages: 'coding-agent:stage-prompt-images',
  /** 选择资源路径。 */
  selectResourcePath: 'coding-agent:select-resource-path',
  /** 选择 Pi-compatible session 文件。 */
  selectSessionFile: 'coding-agent:select-session-file',
  /** 在系统资源管理器中显示资源路径。 */
  revealResourcePath: 'coding-agent:reveal-resource-path',
  /** 打开或定位当前 thread snapshot 中的变更文件。 */
  openChangedFile: 'coding-agent:open-changed-file',
  /** 补全 prompt 中的 Pi @file 文件引用。 */
  completeFileReference: 'coding-agent:complete-file-reference',
  /** 中止线程当前运行。 */
  abort: 'coding-agent:abort',
  /** 创建新会话。 */
  newSession: 'coding-agent:new-session',
  /** 切换会话。 */
  switchSession: 'coding-agent:switch-session',
  /** 导入会话。 */
  importSession: 'coding-agent:import-session',
  /** 导出会话。 */
  exportSession: 'coding-agent:export-session',
  /** 从指定节点分叉线程。 */
  fork: 'coding-agent:fork',
  /** 从指定节点创建新的分支线程。 */
  forkThread: 'coding-agent:fork-thread',
  /** 克隆线程。 */
  clone: 'coding-agent:clone',
  /** 在当前 session tree 内导航。 */
  navigateTree: 'coding-agent:navigate-tree',
  /** 加载 session tree 子节点。 */
  loadSessionTreeChildren: 'coding-agent:load-session-tree-children',
  /** 加载 main 派生的扁平 branch 视图。 */
  loadSessionTreeBranches: 'coding-agent:load-session-tree-branches',
  /** 加载 root 到指定 entry 的路径。 */
  loadSessionTreePath: 'coding-agent:load-session-tree-path',
  /** 设置 session entry label。 */
  setSessionEntryLabel: 'coding-agent:set-session-entry-label',
  /** 设置线程标题。 */
  setThreadTitle: 'coding-agent:set-thread-title',
  /** 重命名线程。 */
  renameThread: 'coding-agent:rename-thread',
  /** 归档线程。 */
  archiveThread: 'coding-agent:archive-thread',
  /** 恢复归档线程。 */
  restoreThread: 'coding-agent:restore-thread',
  /** 列出可用的模型。 */
  listModels: 'coding-agent:list-models',
  /** 设置当前模型。 */
  setModel: 'coding-agent:set-model',
  /** 循环切换到下一个模型。 */
  cycleModel: 'coding-agent:cycle-model',
  /** 设置思考级别。 */
  setThinkingLevel: 'coding-agent:set-thinking-level',
  /** 循环切换思考级别。 */
  cycleThinkingLevel: 'coding-agent:cycle-thinking-level',
  /** 压缩线程上下文。 */
  compact: 'coding-agent:compact',
  /** 设置自动压缩。 */
  setAutoCompaction: 'coding-agent:set-auto-compaction',
  /** 设置自动重试。 */
  setAutoRetry: 'coding-agent:set-auto-retry',
  /** 中止重试。 */
  abortRetry: 'coding-agent:abort-retry',
  /** 获取可用命令列表。 */
  getCommands: 'coding-agent:get-commands',
  /** 运行指定命令。 */
  runCommand: 'coding-agent:run-command',
  /** 同步编辑器文本给扩展运行时。 */
  syncExtensionEditorText: 'coding-agent:sync-extension-editor-text',
  /** 触发扩展快捷键。 */
  dispatchExtensionShortcut: 'coding-agent:dispatch-extension-shortcut',
  /** 响应 UI 扩展的请求。 */
  respondUi: 'coding-agent:respond-ui',
  /** 向扩展派发 desktop panel 消息。 */
  sendExtensionPanelMessage: 'coding-agent:send-extension-panel-message',
  /** 向扩展派发 desktop panel 生命周期事件。 */
  sendExtensionPanelLifecycleEvent: 'coding-agent:send-extension-panel-lifecycle-event',
  /** 缓存 desktop panel state，用于 renderer reload 后恢复。 */
  saveExtensionPanelState: 'coding-agent:save-extension-panel-state',
  /** 销毁 desktop extension panel。 */
  disposeExtensionPanel: 'coding-agent:dispose-extension-panel',
  /** 受控打开外部 URL。 */
  openExternalUrl: 'coding-agent:open-external-url',
  /** 响应审批请求。 */
  respondApproval: 'coding-agent:respond-approval',
  /** 获取 debug diagnostics。 */
  listDiagnostics: 'coding-agent:list-diagnostics',
  /** 获取全局模型设置快照。 */
  getModelSettings: 'coding-agent:get-model-settings',
  /** 更新全局模型设置。 */
  updateModelSettings: 'coding-agent:update-model-settings',
  /** 获取全局模型 registry。 */
  listModelRegistry: 'coding-agent:list-model-registry',
  /** 获取 provider 凭据状态。 */
  listProviderCredentials: 'coding-agent:list-provider-credentials',
  /** 获取模型设置诊断。 */
  listModelDiagnostics: 'coding-agent:list-model-diagnostics',
  /** 获取自定义 provider 列表。 */
  listCustomProviders: 'coding-agent:list-custom-providers',
  /** 新增或更新自定义 provider。 */
  upsertCustomProvider: 'coding-agent:upsert-custom-provider',
  /** 删除自定义 provider。 */
  deleteCustomProvider: 'coding-agent:delete-custom-provider',
  /** 保存 provider API key 到 Pi-compatible auth.json。 */
  setProviderApiKey: 'coding-agent:set-provider-api-key',
  /** 使用 OAuth 登录 provider。 */
  loginProviderOAuth: 'coding-agent:login-provider-oauth',
  /** 响应 OAuth 登录过程中的 renderer 输入请求。 */
  respondModelOAuthPrompt: 'coding-agent:respond-model-oauth-prompt',
  /** 刷新模型 registry。 */
  refreshModelRegistry: 'coding-agent:refresh-model-registry',
  /** 获取 Desktop UI 偏好。 */
  getDesktopUiPreferences: 'coding-agent:get-desktop-ui-preferences',
  /** 更新 Desktop UI 偏好。 */
  updateDesktopUiPreferences: 'coding-agent:update-desktop-ui-preferences',
  /** 获取 Pi-compatible agent 设置快照。 */
  getAgentSettings: 'coding-agent:get-agent-settings',
  /** 更新 Pi-compatible agent 设置。 */
  updateAgentSettings: 'coding-agent:update-agent-settings',
  /** 获取 Pi-compatible resource / extension 发现快照。 */
  getResourceSnapshot: 'coding-agent:get-resource-snapshot',
  /** 获取无需会话的 Hermes Memory 管理快照。 */
  getHermesMemorySnapshot: 'coding-agent:get-hermes-memory-snapshot',
  /** 无需会话地修改 Hermes Memory。 */
  mutateHermesMemory: 'coding-agent:mutate-hermes-memory',
  /** 获取项目级 extension 路径配置。 */
  getProjectExtensionPaths: 'coding-agent:get-project-extension-paths',
  /** 更新项目级 extension 路径配置。 */
  updateProjectExtensionPaths: 'coding-agent:update-project-extension-paths',
  /** 列出 Pi package manager 配置包。 */
  listResourcePackages: 'coding-agent:list-resource-packages',
  /** 新增并持久化 package source。 */
  addResourcePackage: 'coding-agent:add-resource-package',
  /** 安装并持久化 package source。 */
  installResourcePackage: 'coding-agent:install-resource-package',
  /** 移除并持久化 package source。 */
  removeResourcePackage: 'coding-agent:remove-resource-package',
  /** 更新已配置 package source。 */
  updateResourcePackage: 'coding-agent:update-resource-package',
  /** 事件通道。 */
  event: 'coding-agent:event'
} as const
