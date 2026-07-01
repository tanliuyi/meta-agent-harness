/**
 * 本文件定义 desktop renderer 与 main 之间受控暴露的 coding agent IPC 类型。
 */

/** 线程状态。 */
export type ThreadStatus =
  'new' | 'queued' | 'starting' | 'idle' | 'running' | 'stopping' | 'stopped' | 'error'

/** 思考级别。 */
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

/** Project 可用状态。 */
export type ProjectStatus = 'available' | 'missing' | 'permissionDenied' | 'invalid'

/** Project trust 状态。 */
export type ProjectTrustState = 'trusted' | 'untrusted' | 'unknown' | 'notRequired'

/** Project trust 决策。 */
export type ProjectTrustDecision = 'trustProject' | 'trustParent' | 'trustSession' | 'doNotTrust'

/** Project trust 摘要。 */
export interface ProjectTrustSummary {
  /** 当前 trust 状态。 */
  state: ProjectTrustState
  /** 是否存在需要 trust 才加载的项目本地资源。 */
  requiresTrust: boolean
  /** 已保存决策命中的路径。 */
  savedPath?: string
  /** 可保存父目录 trust 的路径。 */
  parentPath?: string
  /** 是否为当前进程内的临时决策。 */
  sessionOnly?: boolean
}

/** Project 摘要信息。 */
export interface ProjectSummary {
  /** Project ID。 */
  projectId: string
  /** Project 显示名称。 */
  name: string
  /** 本地项目路径。 */
  path: string
  /** 当前路径可用状态。 */
  status: ProjectStatus
  /** 创建时间（ISO 8601）。 */
  createdAt: string
  /** 更新时间（ISO 8601）。 */
  updatedAt: string
  /** 最近打开时间（ISO 8601）。 */
  lastOpenedAt?: string
  /** Project trust 状态。 */
  trust?: ProjectTrustSummary
}

/** 创建 Project 的输入参数。 */
export interface CreateProjectInput {
  /** 本地项目路径。 */
  path: string
  /** 可选 Project 名称。 */
  name?: string
}

/** 重命名 Project 的输入参数。 */
export interface RenameProjectInput {
  /** Project ID。 */
  projectId: string
  /** 新名称。 */
  name: string
}

/** 设置 Project trust 的输入参数。 */
export interface SetProjectTrustInput {
  /** Project ID。 */
  projectId: string
  /** trust 决策。 */
  decision: ProjectTrustDecision
}

/** 创建线程的输入参数。 */
export interface CreateThreadInput {
  /** 线程 ID；未提供时自动生成。 */
  threadId?: string
  /** 所属 Project ID。 */
  projectId: string
  /** 会话文件路径。 */
  sessionFile?: string
  /** 线程标题。 */
  title?: string
  /** Agent 目录路径。 */
  agentDir?: string
}

/** 线程摘要信息。 */
export interface ThreadSummary {
  /** 线程 ID。 */
  threadId: string
  /** 所属 Project ID。 */
  projectId: string
  /** 会话文件路径。 */
  sessionFile?: string
  /** 线程标题。 */
  title?: string
  /** 当前状态。 */
  status: ThreadStatus
  /** 归档时间（ISO 8601）。 */
  archivedAt?: string
  /** 创建时间（ISO 8601）。 */
  createdAt: string
  /** 更新时间（ISO 8601）。 */
  updatedAt: string
}

/** 线程快照。 */
export interface ThreadSnapshot {
  /** 线程 ID。 */
  threadId: string
  /** 所属 Project ID。 */
  projectId: string
  /** 工作目录。 */
  cwd: string
  /** 会话文件路径。 */
  sessionFile?: string
  /** 线程标题。 */
  title?: string
  /** 当前状态。 */
  status: ThreadStatus
  /** 思考级别。 */
  thinkingLevel: ThinkingLevel
  /** 消息列表。 */
  messages: ThreadMessage[]
  /** 工具调用列表。 */
  toolCalls: unknown[]
  /** 文件变更列表。 */
  fileChanges: unknown[]
  /** 审批请求列表。 */
  approvals: unknown[]
  /** 待处理队列。 */
  queue: {
    /** 引导/转向输入队列。 */
    steering: string[]
    /** 跟进输入队列。 */
    followUp: string[]
  }
  /** 诊断信息列表。 */
  diagnostics: unknown[]
}

/** 审批请求。 */
export interface ApprovalRequest {
  /** 审批请求 ID。 */
  approvalId: string
  /** 所属线程 ID。 */
  threadId: string
  /** 需要审批的操作描述。 */
  action: string
  /** 风险等级。 */
  risk: 'low' | 'medium' | 'high'
  /** 审批作用范围。 */
  scope: 'once' | 'thread' | 'workspace'
  /** 可选的选项列表。 */
  choices?: string[]
  /** 审批主题/对象。 */
  subject?: string
  /** 默认动作。 */
  defaultAction: 'allow' | 'deny'
  /** 超时时间（毫秒）。 */
  timeoutMs?: number
  /** 创建时间（ISO 8601）。 */
  createdAt: string
}

/** 审批响应。 */
export interface ApprovalResponse {
  /** 审批请求 ID。 */
  approvalId: string
  /** 是否允许执行。 */
  allow: boolean
  /** 审批作用范围。 */
  scope: 'once' | 'thread' | 'workspace'
  /** 选中的选项。 */
  choice?: string
  /** 拒绝或允许的原因。 */
  reason?: string
}

/** 线程消息。 */
export interface ThreadMessage {
  /** 消息 ID。 */
  id: string
  /** 消息角色。 */
  role: 'user' | 'assistant' | 'tool' | 'system'
  /** 消息文本内容。 */
  text?: string
  /** 创建时间（ISO 8601）。 */
  createdAt?: string
}

/** 包含线程 ID 的基础输入。 */
export interface ThreadIdInput {
  /** 线程 ID。 */
  threadId: string
}

/** 提示输入。 */
export interface PromptInput extends ThreadIdInput {
  /** 用户消息文本。 */
  message: string
  /** 附加图片数据。 */
  images?: unknown[]
  /** 流式行为：引导或跟进。 */
  streamingBehavior?: 'steer' | 'followUp'
}

/** 文本输入。 */
export interface TextInput extends ThreadIdInput {
  /** 用户消息文本。 */
  message: string
  /** 附加图片数据。 */
  images?: unknown[]
}

/** 新建会话输入。 */
export interface NewSessionInput extends ThreadIdInput {
  /** 父会话路径。 */
  parentSession?: string
}

/** 切换会话输入。 */
export interface SwitchSessionInput extends ThreadIdInput {
  /** 目标会话路径。 */
  sessionPath: string
  /** 可选的工作目录覆盖。 */
  cwdOverride?: string
}

/** 导入会话输入。 */
export interface ImportSessionInput extends ThreadIdInput {
  /** 源文件路径。 */
  inputPath: string
  /** 可选的工作目录覆盖。 */
  cwdOverride?: string
}

/** 导出会话输入。 */
export interface ExportSessionInput extends ThreadIdInput {
  /** 目标文件路径；未提供时使用默认路径。 */
  outputPath?: string
}

/** 导出会话结果。 */
export interface ExportSessionResult {
  /** 导出文件路径。 */
  path: string
}

/** 分叉线程输入。 */
export interface ForkInput extends ThreadIdInput {
  /** 入口节点 ID。 */
  entryId: string
  /** 分叉位置。 */
  position?: 'before' | 'at'
}

/** 重命名线程输入。 */
export interface RenameThreadInput extends ThreadIdInput {
  /** 新名称。 */
  name: string
}

/** 设置模型输入。 */
export interface SetModelInput extends ThreadIdInput {
  /** 模型提供方。 */
  provider: string
  /** 模型 ID。 */
  modelId: string
}

/** 模型切换结果。 */
export interface ModelCycleResult {
  /** 当前模型信息。 */
  model: ModelInfo
  /** 当前思考级别。 */
  thinkingLevel: ThinkingLevel
  /** 是否为范围限定模型。 */
  isScoped: boolean
}

/** 设置思考级别输入。 */
export interface SetThinkingInput extends ThreadIdInput {
  /** 目标思考级别。 */
  level: ThinkingLevel
}

/** 思考级别切换结果。 */
export interface ThinkingCycleResult {
  /** 当前思考级别。 */
  level: ThinkingLevel
}

/** 压缩线程输入。 */
export interface CompactInput extends ThreadIdInput {
  /** 自定义压缩指令。 */
  customInstructions?: string
}

/** 开关类输入。 */
export interface ToggleInput extends ThreadIdInput {
  /** 是否启用。 */
  enabled: boolean
}

/** 命令信息。 */
export interface CommandInfo {
  /** 命令名称。 */
  name: string
  /** 命令描述。 */
  description?: string
  /** 命令来源。 */
  source: 'extension' | 'prompt' | 'skill'
  /** 来源相关的附加信息。 */
  sourceInfo: unknown
}

/** 模型信息。 */
export interface ModelInfo {
  /** 模型提供方。 */
  provider: string
  /** 模型 ID。 */
  id: string
  /** 模型显示名称。 */
  name?: string
}

/** 压缩结果。 */
export interface CompactionResult {
  /** 是否被取消。 */
  cancelled?: boolean
  /** 其他扩展字段。 */
  [key: string]: unknown
}

/** 运行命令输入。 */
export interface RunCommandInput extends ThreadIdInput {
  /** 要执行的命令名称。 */
  command: string
}

/** 扩展 UI 响应输入。 */
export interface ExtensionUiResponseInput {
  /** 线程 ID。 */
  threadId: string
  /** 响应内容。 */
  response: unknown
}

/** 审批响应输入。 */
export interface ApprovalResponseInput {
  /** 线程 ID。 */
  threadId: string
  /** 审批响应内容。 */
  response: ApprovalResponse
}

/** IPC 结构化错误。 */
export interface IpcError {
  /** 错误代码。 */
  code: string
  /** 面向 renderer 的错误信息。 */
  message: string
  /** 是否可恢复。 */
  recoverable: boolean
  /** 结构化详情，不包含 raw stack。 */
  details?: unknown
}

/** IPC 调用结果信封。 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError }

/** Debug diagnostics 查询输入。 */
export interface DiagnosticsInput {
  /** 可选线程 ID。 */
  threadId?: string
  /** 可选来源。 */
  source?: string
}

/** Coding Agent IPC 事件联合类型。 */
export type CodingAgentIpcEvent =
  | { type: 'canonical'; threadId: string; event: unknown }
  | { type: 'projection'; threadId: string; event: unknown }
  | { type: 'project'; event: unknown }
  | { type: 'worker'; threadId?: string; event: unknown }
  | { type: 'threadSnapshot'; threadId: string; snapshot: ThreadSnapshot }

/** Coding Agent 渲染进程与主进程之间的 API 契约。 */
export interface CodingAgentApi {
  /** 列出所有 Project。 */
  listProjects(): Promise<ProjectSummary[]>
  /** 打开目录选择器并创建 Project；用户取消时返回 undefined。 */
  createProject(): Promise<ProjectSummary | undefined>
  /** 打开 Project。 */
  openProject(projectId: string): Promise<ProjectSummary>
  /** 获取 Project。 */
  getProject(projectId: string): Promise<ProjectSummary>
  /** 重命名 Project。 */
  renameProject(input: RenameProjectInput): Promise<void>
  /** 设置 Project trust。 */
  setProjectTrust(input: SetProjectTrustInput): Promise<ProjectSummary>
  /** 创建新线程。 */
  createThread(input: CreateThreadInput): Promise<ThreadSnapshot>
  /** 停止线程运行。 */
  stopThread(threadId: string): Promise<void>
  /** 重新启动线程。 */
  restartThread(threadId: string): Promise<ThreadSnapshot>
  /** 列出所有线程。 */
  listThreads(input?: { projectId?: string }): Promise<ThreadSummary[]>
  /** 获取线程详情。 */
  getThread(threadId: string): Promise<ThreadSnapshot>
  /** 获取线程快照。 */
  getSnapshot(threadId: string): Promise<ThreadSnapshot>
  /** 向线程发送提示。 */
  prompt(input: PromptInput): Promise<void>
  /** 向线程发送引导输入。 */
  steer(input: TextInput): Promise<void>
  /** 向线程发送跟进输入。 */
  followUp(input: TextInput): Promise<void>
  /** 中止当前运行。 */
  abort(threadId: string): Promise<void>
  /** 创建新会话。 */
  newSession(input: NewSessionInput): Promise<ThreadSnapshot>
  /** 切换会话。 */
  switchSession(input: SwitchSessionInput): Promise<ThreadSnapshot>
  /** 导入会话。 */
  importSession(input: ImportSessionInput): Promise<ThreadSnapshot>
  /** 导出会话。 */
  exportSession(input: ExportSessionInput): Promise<ExportSessionResult>
  /** 分叉线程。 */
  fork(input: ForkInput): Promise<ThreadSnapshot>
  /** 克隆线程。 */
  clone(threadId: string): Promise<ThreadSnapshot>
  /** 重命名线程。 */
  renameThread(input: RenameThreadInput): Promise<void>
  /** 归档线程。 */
  archiveThread(threadId: string): Promise<void>
  /** 列出可用的模型。 */
  listModels(threadId: string): Promise<ModelInfo[]>
  /** 设置当前模型。 */
  setModel(input: SetModelInput): Promise<void>
  /** 循环切换到下一个模型。 */
  cycleModel(threadId: string): Promise<ModelCycleResult | null>
  /** 设置思考级别。 */
  setThinkingLevel(input: SetThinkingInput): Promise<void>
  /** 循环切换思考级别。 */
  cycleThinkingLevel(threadId: string): Promise<ThinkingCycleResult | null>
  /** 压缩线程上下文。 */
  compact(input: CompactInput): Promise<CompactionResult>
  /** 设置自动压缩。 */
  setAutoCompaction(input: ToggleInput): Promise<void>
  /** 设置自动重试。 */
  setAutoRetry(input: ToggleInput): Promise<void>
  /** 中止重试。 */
  abortRetry(threadId: string): Promise<void>
  /** 获取可用命令列表。 */
  getCommands(threadId: string): Promise<CommandInfo[]>
  /** 运行指定命令。 */
  runCommand(input: RunCommandInput): Promise<void>
  /** 响应 UI 扩展请求。 */
  respondUi(input: ExtensionUiResponseInput): Promise<void>
  /** 响应审批请求。 */
  respondApproval(input: ApprovalResponseInput): Promise<void>
  /** 获取 debug diagnostics。 */
  listDiagnostics(input?: DiagnosticsInput): Promise<unknown[]>
  /** 注册事件监听器，返回取消订阅函数。 */
  onEvent(listener: (event: CodingAgentIpcEvent) => void): () => void
}
