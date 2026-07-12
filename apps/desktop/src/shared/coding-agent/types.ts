/**
 * 本文件定义 desktop renderer 与 main 之间受控暴露的 coding agent IPC 类型。
 */

import type {
  ApprovalRequest as PackageApprovalRequest,
  ApprovalResponse as PackageApprovalResponse
} from '@coding-agent-desktop-src/protocol/approval'
import type { AgentSessionEvent as PackageAgentSessionEvent } from '@coding-agent-src/core/agent-session'
import type {
  DesktopExtensionPanelLifecycle as PackageDesktopExtensionPanelLifecycle,
  DesktopExtensionWebviewPanel as PackageDesktopExtensionWebviewPanel,
  ExtensionPanelProjection as PackageExtensionPanelProjection
} from '@coding-agent-desktop-src/protocol/extension-panel'
import type { DesktopProjectionEvent as PackageDesktopProjectionEvent } from '@coding-agent-desktop-src/protocol/events/projection'
import type { WorkerLifecycleEvent as PackageWorkerLifecycleEvent } from '@coding-agent-desktop-src/protocol/events/worker'
import type {
  ExtensionDialogRequest as PackageExtensionDialogRequest,
  ExtensionUiRequest as PackageExtensionUiRequest,
  ExtensionUiResponse as PackageExtensionUiResponse
} from '@coding-agent-desktop-src/protocol/extension-ui'
import type { AgentMessage, ThinkingLevel as PiThinkingLevel } from '@earendil-works/pi-agent-core'
import { toDesktopMessageContent as toPackageDesktopMessageContent } from '@coding-agent-desktop-src/protocol/message'
import type {
  DesktopMessage,
  ThreadSnapshot as PackageThreadSnapshot
} from '@coding-agent-desktop-src/protocol/snapshot'
import type {
  StartThreadInput as PackageStartThreadInput,
  ThreadRuntimeState,
  ThreadSummary as PackageThreadSummary
} from '@coding-agent-desktop-src/protocol/thread'
import type { RpcResponse } from '@coding-agent-src/modes/rpc/rpc-types'
import type { SourceInfo } from '@coding-agent-src/core/source-info'
import type { ImageContent } from '@earendil-works/pi-ai'
import type { ResourcesSnapshot as PackageResourcesSnapshot } from '@coding-agent-src/core/resource-snapshot'

/** 线程状态。 */
export type ThreadStatus = ThreadRuntimeState

/** 思考级别。 */
export type ThinkingLevel = PiThinkingLevel

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
export type CreateThreadInput = Omit<PackageStartThreadInput, 'cwd'> & {
  /** 所属 Project ID。 */
  projectId: string
}

/** Thread 来源关系，desktop 从 session header 派生，不写入 Pi JSONL。 */
export interface ThreadLineage {
  /** 父 session 文件路径，来自 session header parentSession。 */
  parentSessionFile?: string
  /** 已匹配到的父 thread ID。 */
  parentThreadId?: string
  /** 已匹配到的父 thread 标题。 */
  parentThreadTitle?: string
  /** 已匹配到的父 thread 归档时间。 */
  parentThreadArchivedAt?: string
  /** 父 session 文件存在但未匹配到 thread。 */
  parentSessionExists?: boolean
  /** 父 session 文件不存在。 */
  parentSessionMissing?: boolean
  /** parentSession 指向自身等异常情况。 */
  unavailable?: boolean
}

/** 线程摘要信息。 */
export type ThreadSummary = Omit<PackageThreadSummary, 'cwd'> & {
  /** 所属 Project ID。 */
  projectId: string
  /** 归档时间（ISO 8601）。 */
  archivedAt?: string
  /** 来源关系，desktop-only 派生字段。 */
  lineage?: ThreadLineage
}

/** Thread 列表过滤条件。 */
export interface ListThreadsInput {
  /** 过滤指定 Project。 */
  projectId?: string
  /** 是否返回归档线程；默认 false。 */
  archived?: boolean
}

/** 线程快照。 */
export type ThreadSnapshot = PackageThreadSnapshot & {
  /** 所属 Project ID。 */
  projectId: string
  /** 来源关系，desktop-only 派生字段。 */
  lineage?: ThreadLineage
}

/** 审批请求。 */
export type ApprovalRequest = PackageApprovalRequest

/** 审批响应。 */
export type ApprovalResponse = PackageApprovalResponse

/** 线程消息。 */
export type ThreadMessage = DesktopMessage

/** Prompt 图片内容。 */
export type PromptImage = ImageContent

/** Prompt 图片文件引用，由后端按 Pi @file 语义展开。 */
export interface PromptImageFile {
  /** 原始文件路径。 */
  path: string
  /** renderer 已持有的图片数据，用于文件处理失败时的 inline fallback。 */
  inlineFallback?: PromptImage
}

/** Prompt skill 引用，由后端展开为真实 skill 上下文。 */
export interface PromptSkillReference {
  /** skill command 名称，例如 skill:review。 */
  name: string
  /** skill 文件真实路径。 */
  path?: string
  /** skill 引用资源的基准目录。 */
  baseDir?: string
}

/** 待暂存的 prompt 图片内容。 */
export type PromptImageDraft = PromptImage & {
  /** 原始文件名。 */
  name: string
  /** 原始文件大小，字节。 */
  size: number
}

/** Prompt 图片附件，包含 UI 展示用文件元信息。 */
export type PromptImageAttachment = PromptImage & {
  /** 原始文件路径；粘贴图片等 inline 附件可能没有磁盘路径。 */
  path?: string
  /** 原始文件名。 */
  name: string
  /** 原始文件大小，字节。 */
  size: number
  /** 图片处理提示，例如格式转换或缩放说明。 */
  hints: string[]
}

/** Prompt 文件引用候选。 */
export interface PromptFileReferenceCandidate {
  /** 传给 Pi @file 处理链路的文件参数。 */
  fileArg: string
  /** 相对 Project cwd 的展示路径。 */
  relativePath: string
  /** 文件绝对路径。 */
  absolutePath: string
  /** 候选展示标签。 */
  label: string
}

/** 文件引用补全输入。 */
export interface FileReferenceCompletionInput {
  /** 当前绑定的 thread ID。 */
  threadId?: string
  /** 未创建 thread 时使用的 Project ID。 */
  projectId?: string
  /** 光标前文本。 */
  textBeforeCursor: string
  /** 最大候选数。 */
  limit?: number
}

/** 文件引用补全结果。 */
export interface FileReferenceCompletionResult {
  /** 当前 @file token 起始位置；无补全上下文时为 undefined。 */
  from?: number
  /** 当前 @file token 结束位置；无补全上下文时为 undefined。 */
  to?: number
  /** 候选文件。 */
  candidates: PromptFileReferenceCandidate[]
}

/** 将 Pi AgentMessage 转换为不含 ID 的 Desktop message 内容。 */
export const toDesktopMessageContent = toPackageDesktopMessageContent

/** Pi AgentMessage。 */
export type { AgentMessage }

/** 包含线程 ID 的基础输入。 */
export interface ThreadIdInput {
  /** 线程 ID。 */
  threadId: string
}

/** Assistant 文本引用上下文。 */
export interface PromptQuoteContext {
  /** 来源消息 ID。 */
  messageId: string
  /** 来源 session entry ID，用于后续定位来源。 */
  sessionEntryId?: string
  /** 实际引用文本。 */
  text: string
}

/** 提示输入。 */
export interface PromptInput extends ThreadIdInput {
  /** 用户消息文本。 */
  message: string
  /** Pi @file 文件参数，由后端按 Pi @file 语义展开。 */
  fileArgs?: string[]
  /** Composer 中结构化记录的 skill 引用。 */
  skillReferences?: PromptSkillReference[]
  /** 从 assistant 消息中选取的文本引用上下文。 */
  quoteContexts?: PromptQuoteContext[]
  /** 附加图片数据。 */
  images?: PromptImage[]
  /** 附加图片文件，由后端按 Pi @file 语义展开。 */
  imageFiles?: PromptImageFile[]
  /** 流式行为：引导或跟进。 */
  streamingBehavior?: 'steer' | 'followUp'
}

/** 文本输入。 */
export interface TextInput extends ThreadIdInput {
  /** 用户消息文本。 */
  message: string
  /** Pi @file 文件参数，由后端按 Pi @file 语义展开。 */
  fileArgs?: string[]
  /** Composer 中结构化记录的 skill 引用。 */
  skillReferences?: PromptSkillReference[]
  /** 从 assistant 消息中选取的文本引用上下文。 */
  quoteContexts?: PromptQuoteContext[]
  /** 附加图片数据。 */
  images?: PromptImage[]
  /** 附加图片文件，由后端按 Pi @file 语义展开。 */
  imageFiles?: PromptImageFile[]
}

/** 资源路径选择模式。 */
export type ResourcePathSelectionMode = 'directory' | 'file' | 'any'

/** 选择资源路径输入。 */
export interface SelectResourcePathInput {
  /** 选择器标题。 */
  title?: string
  /** 选择文件、目录或二者皆可。 */
  mode?: ResourcePathSelectionMode
  /** 是否允许多选。 */
  multi?: boolean
  /** 默认打开路径。 */
  defaultPath?: string
}

/** Session 文件选择输入。 */
export interface SelectSessionFileInput {
  /** 选择器标题。 */
  title?: string
  /** 默认路径。 */
  defaultPath?: string
}

/** 显示资源路径输入。 */
export interface RevealResourcePathInput {
  /** 要在资源管理器中显示或打开的路径。 */
  path: string
  /** 操作模式：打开文件/目录，或在资源管理器中显示。 */
  mode?: 'open' | 'reveal'
}

/** 打开或定位 thread snapshot 中的变更文件。 */
export interface OpenChangedFileInput extends ThreadIdInput {
  /** 必须与可信 snapshot fileChanges 中的原始 path 完全匹配。 */
  changePath: string
  action: 'open' | 'reveal'
}

/** 变更文件启动结果，不回传本地路径。 */
export interface OpenChangedFileResult {
  action: OpenChangedFileInput['action']
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

/** 创建分支线程输入。 */
export interface ForkThreadInput extends ForkInput {
  /** 新线程标题；未传时由源线程标题派生。 */
  title?: string
}

/** 创建分支线程结果。 */
export interface ForkThreadResult {
  /** 是否被 hook 取消。 */
  cancelled: boolean
  /** 新分支线程快照；取消时不存在。 */
  snapshot?: ThreadSnapshot
}

/** Session tree 导航输入。 */
export interface NavigateTreeInput extends ThreadIdInput {
  /** 目标 entry ID。 */
  entryId: string
  /** 是否摘要离开的分支。 */
  summarize?: boolean
  /** 自定义摘要指令。 */
  customInstructions?: string
}

/** Session tree 导航结果。 */
export interface NavigateTreeResult {
  /** 最新线程快照。 */
  snapshot: ThreadSnapshot
  /** 需要回填到 composer 的文本，通常来自 user/custom message。 */
  editorText?: string
  /** 是否取消。 */
  cancelled?: boolean
  /** 是否被中止。 */
  aborted?: boolean
}

/** 加载 session tree 子节点输入。 */
export interface LoadSessionTreeChildrenInput extends ThreadIdInput {
  /** 父 entry ID；null 表示 roots。 */
  parentId: string | null
  /** 返回深度。 */
  maxDepth?: number
}

/** Session tree branch 视图过滤条件。 */
export type SessionTreeBranchFilter = 'default' | 'all' | 'user' | 'labeled' | 'no-tools'

/** 加载 session tree 扁平视图输入。 */
export interface LoadSessionTreeBranchesInput extends ThreadIdInput {
  /** 搜索关键字；为空时不搜索。 */
  query?: string
  /** 过滤条件；默认 default。 */
  filter?: SessionTreeBranchFilter
}

/** Session tree 扁平视图中的 entry 行。 */
export interface SessionTreeBranchEntryRow {
  /** 行类型。 */
  kind: 'entry'
  /** 行 ID。 */
  id: string
  /** Session entry ID。 */
  entryId: string
  /** 父 entry ID。 */
  parentId: string | null
  /** Entry 类型。 */
  type: string
  /** 创建时间（ISO 8601）。 */
  timestamp: string
  /** 简短展示标题。 */
  title: string
  /** 可选摘要文本。 */
  summary?: string
  /** 用户标签。 */
  label?: string
  /** 标签时间。 */
  labelTimestamp?: string
  /** 完整树深度。 */
  depth: number
  /** UI 缩进深度。 */
  visualDepth: number
  /** 子节点数量。 */
  childCount: number
  /** 是否是完整树 leaf。 */
  leaf: boolean
  /** 是否是分叉点。 */
  branchPoint: boolean
  /** 是否是当前 leaf。 */
  current: boolean
}

/** 加载 session tree 扁平视图结果。 */
export interface LoadSessionTreeBranchesResult {
  /** 扁平展示行。 */
  rows: SessionTreeBranchEntryRow[]
  /** 完整 session entry 数。 */
  totalEntries: number
  /** 查询/过滤命中的 entry 数。 */
  visibleEntries: number
  /** 当前 leaf entry ID。 */
  currentEntryId?: string | null
}

/** 加载 session tree 路径输入。 */
export interface LoadSessionTreePathInput extends ThreadIdInput {
  /** 目标 entry ID；未传则使用当前 leaf。 */
  entryId?: string
}

/** 设置 session entry label 输入。 */
export interface SetSessionEntryLabelInput extends ThreadIdInput {
  /** 目标 entry ID。 */
  entryId: string
  /** 新 label；空值表示清除。 */
  label?: string
}

/** 重命名线程输入。 */
export interface RenameThreadInput extends ThreadIdInput {
  /** 新名称。 */
  name: string
}

/** 设置线程标题输入。 */
export interface SetThreadTitleInput extends ThreadIdInput {
  /** 新标题。 */
  title: string
}

/** 设置模型输入。 */
export interface SetModelInput extends ThreadIdInput {
  /** 模型提供方。 */
  provider: string
  /** 模型 ID。 */
  modelId: string
}

/** 模型切换结果。 */
export type ModelCycleResult = Extract<
  RpcResponse,
  { command: 'cycle_model'; success: true }
>['data']

/** 设置思考级别输入。 */
export interface SetThinkingInput extends ThreadIdInput {
  /** 目标思考级别。 */
  level: ThinkingLevel
}

/** 思考级别切换结果。 */
export type ThinkingCycleResult = Extract<
  RpcResponse,
  { command: 'cycle_thinking_level'; success: true }
>['data']

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

/** Agent 资源命令信息。 */
export type AgentResourceCommandInfo = Extract<
  RpcResponse,
  { command: 'get_commands'; success: true }
>['data']['commands'][number]

/** Agent 内建 slash command 信息。 */
export interface BuiltinCommandInfo {
  /** 命令名，不含 slash。 */
  name: string
  /** 命令说明。 */
  description?: string
  /** 命令来源。 */
  source: 'builtin'
  /** 合成来源信息。 */
  sourceInfo: SourceInfo
}

/** 命令信息。 */
export type CommandInfo = AgentResourceCommandInfo | BuiltinCommandInfo

/** 模型信息。 */
export type ModelInfo = Extract<
  RpcResponse,
  { command: 'get_available_models'; success: true }
>['data']['models'][number]

/** 模型配置页中的模型状态。 */
export type ModelSettingsModelStatus = 'available' | 'missingAuth' | 'invalid' | 'disabled'

/** 模型配置来源。 */
export type ModelSettingsSource =
  'builtin' | 'global' | 'project' | 'runtime' | 'custom' | 'extension'

/** Provider 凭据状态。 */
export type ProviderCredentialState = 'configured' | 'missing' | 'invalid' | 'unknown'

/** Provider 凭据来源。 */
export type ProviderCredentialSource =
  'credentialStore' | 'env' | 'oauth' | 'runtime' | 'models_json_key' | 'models_json_command'

/** 模型设置诊断级别。 */
export type ModelSettingsDiagnosticSeverity = 'info' | 'warning' | 'error'

/** 模型设置诊断来源。 */
export type ModelSettingsDiagnosticSource =
  'settings' | 'auth' | 'modelRegistry' | 'resourceLoading' | 'customProvider'

/** 模型配置页模型条目。 */
export interface ModelSettingsModelItem {
  /** 模型提供方。 */
  provider: string
  /** 模型 ID。 */
  id: string
  /** 显示名。 */
  displayName?: string
  /** 上下文窗口。 */
  contextWindow?: number
  /** 最大输出 token。 */
  maxOutputTokens?: number
  /** 是否支持工具调用。 */
  supportsTools?: boolean
  /** 是否支持图片输入。 */
  supportsImages?: boolean
  /** 是否支持 thinking/reasoning。 */
  supportsReasoning?: boolean
  /** 支持的 thinking level。 */
  thinkingLevels?: ThinkingLevel[]
  /** 配置来源。 */
  source?: ModelSettingsSource
  /** 当前可用状态。 */
  status: ModelSettingsModelStatus
}

/** Provider 摘要。 */
export interface ModelProviderSummary {
  /** Provider ID。 */
  id: string
  /** Provider 显示名。 */
  displayName: string
  /** Provider 来源。 */
  source: ModelSettingsSource
  /** 总模型数。 */
  modelCount: number
  /** 可用模型数。 */
  availableModelCount: number
  /** 凭据状态。 */
  credentialStatus: ProviderCredentialState
}

/** Provider 凭据状态摘要，不包含密钥明文。 */
export interface ProviderCredentialStatus {
  /** Provider ID。 */
  provider: string
  /** 凭据状态。 */
  status: ProviderCredentialState
  /** 凭据来源。 */
  source?: ProviderCredentialSource
  /** 是否支持 OAuth 登录。 */
  oauthAvailable?: boolean
  /** 面向用户的状态说明。 */
  message?: string
}

/** 模型设置诊断信息。 */
export interface ModelSettingsDiagnostic {
  /** 诊断 ID。 */
  id: string
  /** 严重级别。 */
  severity: ModelSettingsDiagnosticSeverity
  /** 诊断来源。 */
  source: ModelSettingsDiagnosticSource
  /** 摘要。 */
  message: string
  /** 详情，不包含密钥明文。 */
  details?: string
}

/** 模型 registry 快照。 */
export interface ModelRegistrySnapshot {
  /** 模型列表。 */
  models: ModelSettingsModelItem[]
  /** Provider 摘要列表。 */
  providers: ModelProviderSummary[]
  /** models.json 加载错误。 */
  loadError?: string
  /** 刷新时间（ISO 8601）。 */
  refreshedAt: string
}

/** 自定义 provider 摘要。 */
export interface CustomProviderSummary {
  /** Provider ID。 */
  provider: string
  /** 显示名。 */
  name?: string
  /** API 地址。 */
  baseUrl?: string
  /** API key 配置值；用于二次编辑自定义 provider。 */
  apiKey?: string
  /** API 类型。 */
  api?: string
  /** 请求 headers；用于二次编辑自定义 provider。 */
  headers?: Record<string, string>
  /** provider 兼容配置。 */
  compat?: Record<string, unknown>
  /** 是否自动添加 Authorization bearer header。 */
  authHeader?: boolean
  /** 模型数量。 */
  modelCount: number
  /** 自定义模型列表。 */
  models?: CustomModelConfigInput[]
  /** 内置模型 override。 */
  modelOverrides?: Record<string, CustomModelOverrideInput>
  /** 是否为内置 provider override。 */
  overridesBuiltIn: boolean
  /** 是否配置了 API key 来源。 */
  hasApiKeyConfig: boolean
}

/** 模型设置快照。 */
export interface ModelSettingsSnapshot {
  /** 全局模型相关设置。 */
  settings: {
    /** 默认 provider。 */
    defaultProvider?: string
    /** 默认模型 ID。 */
    defaultModel?: string
    /** 默认 thinking level。 */
    defaultThinkingLevel?: ThinkingLevel
    /** scoped/cycling 模型模式。 */
    enabledModels?: string[]
  }
  /** 模型 registry 投影。 */
  registry: ModelRegistrySnapshot
  /** Provider 凭据状态。 */
  credentials: ProviderCredentialStatus[]
  /** 诊断信息。 */
  diagnostics: ModelSettingsDiagnostic[]
  /** 自定义 provider 摘要。 */
  customProviders: CustomProviderSummary[]
  /** 后端存储路径。 */
  storage: {
    /** agentDir 路径。 */
    agentDir: string
    /** settings.json 路径。 */
    settingsPath: string
    /** models.json 路径。 */
    modelsPath: string
  }
}

/** 更新模型设置输入。 */
export interface UpdateModelSettingsInput {
  /** 默认 provider。 */
  defaultProvider?: string
  /** 默认模型 ID。 */
  defaultModel?: string
  /** 默认 thinking level。 */
  defaultThinkingLevel?: ThinkingLevel
  /** scoped/cycling 模型模式。 */
  enabledModels?: string[]
}

/** 自定义模型配置输入。 */
export interface CustomModelConfigInput {
  /** 模型 ID。 */
  id: string
  /** 显示名。 */
  name?: string
  /** API 类型。 */
  api?: string
  /** 模型级 API 地址。 */
  baseUrl?: string
  /** 是否支持 reasoning。 */
  reasoning?: boolean
  /** thinking level 映射。 */
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>
  /** 输入类型。 */
  input?: Array<'text' | 'image'>
  /** 上下文窗口。 */
  contextWindow?: number
  /** 最大输出 token。 */
  maxTokens?: number
  /** 成本配置。 */
  cost?: {
    /** 输入成本。 */
    input: number
    /** 输出成本。 */
    output: number
    /** cache read 成本。 */
    cacheRead: number
    /** cache write 成本。 */
    cacheWrite: number
  }
  /** 请求 headers；后端返回时不得包含敏感原文。 */
  headers?: Record<string, string>
  /** provider/model 兼容配置。 */
  compat?: Record<string, unknown>
}

/** 自定义模型 override 输入。 */
export type CustomModelOverrideInput = Partial<
  Omit<CustomModelConfigInput, 'id' | 'api' | 'baseUrl'>
>

/** 新增或更新自定义 provider 输入。 */
export interface UpsertCustomProviderInput {
  /** Provider ID。 */
  provider: string
  /** 重命名前的 Provider ID；仅编辑现有 Provider 时提交。 */
  originalProvider?: string
  /** 显示名。 */
  name?: string
  /** API 地址。 */
  baseUrl?: string
  /** API key 配置值；只允许 renderer 提交，不允许后端回显。 */
  apiKey?: string
  /** API 类型。 */
  api?: string
  /** 请求 headers；只允许 renderer 提交，不允许后端回显敏感原文。 */
  headers?: Record<string, string>
  /** provider 兼容配置。 */
  compat?: Record<string, unknown>
  /** 是否自动添加 Authorization bearer header。 */
  authHeader?: boolean
  /** 自定义模型列表。 */
  models?: CustomModelConfigInput[]
  /** 内置模型 override。 */
  modelOverrides?: Record<string, CustomModelOverrideInput>
}

/** 保存 provider API key 到 Pi-compatible auth.json。 */
export interface SetProviderApiKeyInput {
  /** Provider ID。 */
  provider: string
  /** API key 或 Pi 支持的 config value（如 $ENV_VAR、${ENV_VAR}、!command）。 */
  key: string
  /** provider-scoped env 值。 */
  env?: Record<string, string>
}

/** Provider OAuth 登录输入。 */
export interface LoginProviderOAuthInput {
  /** Provider ID。 */
  provider: string
  /** OAuth provider 要求选择登录方式时的选项 ID；为空时使用第一项。 */
  selectOptionId?: string
}

/** OAuth 登录过程中需要 renderer 输入的请求。 */
export interface ModelOAuthPromptRequest {
  /** 请求 ID，用于响应关联。 */
  requestId: string
  /** Provider ID。 */
  provider: string
  /** 提示文案。 */
  message: string
  /** 输入框占位符。 */
  placeholder?: string
  /** 是否允许提交空值。 */
  allowEmpty?: boolean
  /** 是否为 OAuth callback/manual code fallback。 */
  manualCode?: boolean
}

/** OAuth prompt 响应。 */
export interface ModelOAuthPromptResponseInput {
  /** 请求 ID。 */
  requestId: string
  /** Provider ID。 */
  provider: string
  /** 用户输入；取消时可为空。 */
  value?: string
  /** 用户是否取消。 */
  cancelled?: boolean
}

/** Provider OAuth 登录事件。 */
export type ModelOAuthLoginEvent =
  | { type: 'started'; provider: string; providerName?: string }
  | { type: 'authUrl'; provider: string; url: string; instructions?: string }
  | {
      type: 'deviceCode'
      provider: string
      userCode: string
      verificationUri: string
      intervalSeconds?: number
      expiresInSeconds?: number
    }
  | { type: 'progress'; provider: string; message: string }
  | {
      type: 'selection'
      provider: string
      message: string
      selectedOptionId?: string
      options: Array<{ id: string; label: string }>
    }
  | ({ type: 'promptRequested' } & ModelOAuthPromptRequest)
  | { type: 'promptResolved'; provider: string; requestId: string }
  | { type: 'succeeded'; provider: string }
  | { type: 'failed'; provider: string; message: string }

/** Pi 消息排队模式。 */
export type AgentQueueMode = 'all' | 'one-at-a-time'

/** Pi provider transport 偏好。 */
export type AgentTransportMode = 'auto' | 'sse' | 'websocket' | 'websocket-cached'

/** Desktop 承载 Pi runtime 的 worker 模式。 */
export type AgentWorkerMode = 'utilityProcess' | 'nodeSidecar'

/** 默认项目 trust 策略。 */
export type AgentDefaultProjectTrust = 'ask' | 'always' | 'never'

/** 空编辑器双击 Escape 行为。 */
export type AgentDoubleEscapeAction = 'fork' | 'tree' | 'none'

/** Session tree 默认过滤模式。 */
export type AgentTreeFilterMode = 'default' | 'no-tools' | 'user-only' | 'labeled-only' | 'all'

/** Agent 设置诊断信息。 */
export interface AgentSettingsDiagnostic {
  /** 诊断 ID。 */
  id: string
  /** 严重级别。 */
  severity: ModelSettingsDiagnosticSeverity
  /** 诊断来源。 */
  source: 'settings'
  /** 摘要。 */
  message: string
  /** 详情。 */
  details?: string
}

/** Desktop 资源包摘要。 */
export interface ResourcePackageSummary {
  /** 原始 package source。 */
  source: string
  /** 配置作用域。 */
  scope: 'user' | 'project'
  /** 是否被当前环境过滤。 */
  filtered: boolean
  /** 已安装路径。 */
  installedPath?: string
}

/** 资源包操作输入。 */
export interface ResourcePackageInput {
  /** package source。 */
  source: string
  /** 是否写入 Project 本地 settings。 */
  local?: boolean
}

/** 资源包更新输入。 */
export interface UpdateResourcePackageInput {
  /** 不传表示更新全部配置包。 */
  source?: string
}

/** 资源包进度事件。 */
export interface ResourcePackageProgressEvent {
  type: 'start' | 'progress' | 'complete' | 'error'
  action: 'install' | 'remove' | 'update' | 'clone' | 'pull'
  source: string
  message?: string
}

export type UiDensity = 'compact' | 'standard' | 'comfortable'
export type ChatContentWidth = 'narrow' | 'standard' | 'wide'
export type MessageTimeDisplay = 'always' | 'hover' | 'hidden'
export type ToolExpansionMode = 'auto' | 'expanded' | 'collapsed'
export type SidebarDisplayMode = 'persistent' | 'auto'
export type MarkdownFontStyle = 'sans' | 'serif' | 'custom'
export type MotionPreference = 'full' | 'reduced'
export type AvatarStyle = 'pixel' | 'circle' | 'hidden'
export type UserMessageAlignment = 'right' | 'left'
export type ActivityDisplayMode = 'full' | 'compact' | 'hidden'
export type ActivityIndicatorStyle = 'pixels' | 'pulse' | 'hidden'

/** Desktop renderer UI 偏好。 */
export interface DesktopUiPreferences {
  /** 外观偏好。 */
  appearance?: {
    /** UI 字体大小。 */
    uiFontSize?: number
    /** 用户自定义 UI font-family。 */
    customUiFontFamily?: string
    /** 代码字体大小。 */
    codeFontSize?: number
    /** 用户自定义代码 font-family。 */
    customCodeFontFamily?: string
    /** 是否在聊天消息旁显示头像。 */
    showAvatars?: boolean
    /** 聊天界面密度。 */
    density?: UiDensity
    /** 聊天内容最大宽度。 */
    chatContentWidth?: ChatContentWidth
    /** 消息时间显示方式。 */
    messageTimeDisplay?: MessageTimeDisplay
    /** 代码块是否自动换行。 */
    wrapCode?: boolean
    /** 工具调用默认展开方式。 */
    toolExpansion?: ToolExpansionMode
    /** 工作区侧栏显示方式。 */
    sidebarDisplay?: SidebarDisplayMode
    /** Markdown 正文字体风格。 */
    markdownFontStyle?: MarkdownFontStyle
    /** 用户自定义 Markdown font-family。 */
    customMarkdownFontFamily?: string
    /** 界面动效偏好。 */
    motion?: MotionPreference
    /** 消息头像样式。 */
    avatarStyle?: AvatarStyle
    /** 用户消息对齐方式。 */
    userMessageAlignment?: UserMessageAlignment
    /** Agent activity 指示器显示方式。 */
    activityDisplay?: ActivityDisplayMode
    /** Agent activity 默认指示器样式。 */
    activityIndicatorStyle?: ActivityIndicatorStyle
    /** 用户自定义 Agent activity 文案。 */
    customActivityText?: string
  }
  /** Workspace 布局偏好。 */
  workspace?: {
    /** 左侧 sidebar 宽度。 */
    sidebarWidth?: number
  }
}

/** 更新 Desktop renderer UI 偏好。 */
export type UpdateDesktopUiPreferencesInput = Partial<DesktopUiPreferences>

/** Pi-compatible agent 设置快照。 */
export interface AgentSettingsSnapshot {
  /** 消息投递与连接设置。 */
  delivery: {
    /** streaming 期间 steering 消息投递模式。 */
    steeringMode: AgentQueueMode
    /** streaming 期间 follow-up 消息投递模式。 */
    followUpMode: AgentQueueMode
    /** Provider transport 偏好。 */
    transport: AgentTransportMode
  }
  /** 运行时可靠性设置。 */
  runtime: {
    /** Desktop worker 承载模式；Desktop-local，不写入 Pi settings.json。 */
    workerMode: AgentWorkerMode
    /** Node sidecar 可执行文件路径；Desktop-local，不写入 Pi settings.json。 */
    nodeSidecarExecPath?: string
    /** 自动上下文压缩。 */
    compactionEnabled: boolean
    /** 压缩预留 token。 */
    compactionReserveTokens: number
    /** 压缩保留最近 token。 */
    compactionKeepRecentTokens: number
    /** 分支摘要预留 token。 */
    branchSummaryReserveTokens: number
    /** 跳过分支摘要提示。 */
    branchSummarySkipPrompt: boolean
    /** 自动重试。 */
    retryEnabled: boolean
    /** Agent-level 最大重试次数。 */
    retryMaxRetries: number
    /** Agent-level 重试基础延迟。 */
    retryBaseDelayMs: number
    /** Provider SDK 请求 timeout。 */
    providerRetryTimeoutMs?: number
    /** Provider SDK 最大重试次数。 */
    providerRetryMaxRetries?: number
    /** Provider server-requested retry delay 上限。 */
    providerRetryMaxRetryDelayMs: number
    /** HTTP idle timeout，毫秒。 */
    httpIdleTimeoutMs: number
    /** WebSocket connect timeout，毫秒。 */
    websocketConnectTimeoutMs?: number
  }
  /** 显示与交互设置。 */
  display: {
    /** 主题名称或路径。 */
    theme?: string
    /** 启动时减少非必要输出。 */
    quietStartup: boolean
    /** 更新后折叠 changelog。 */
    collapseChangelog: boolean
    /** 隐藏 thinking block。 */
    hideThinkingBlock: boolean
    /** 空编辑器双击 Escape 行为。 */
    doubleEscapeAction: AgentDoubleEscapeAction
    /** Session tree 默认过滤模式。 */
    treeFilterMode: AgentTreeFilterMode
    /** 是否显示硬件光标。 */
    showHardwareCursor: boolean
    /** 输入编辑器水平 padding。 */
    editorPaddingX: number
    /** 自动补全最大可见项数。 */
    autocompleteMaxVisible: number
  }
  /** 安全和遥测设置。 */
  safety: {
    /** 项目本地资源默认 trust 策略。 */
    defaultProjectTrust: AgentDefaultProjectTrust
    /** 匿名安装/更新 telemetry。 */
    enableInstallTelemetry: boolean
    /** Analytics opt-in。 */
    enableAnalytics: boolean
    /** Skill slash commands。 */
    enableSkillCommands: boolean
    /** Anthropic Pro/Max extra usage 提示。 */
    warnAnthropicExtraUsage: boolean
    /** HTTP/HTTPS proxy。 */
    httpProxy?: string
  }
  /** 图片和终端呈现设置。 */
  media: {
    /** 发送前自动缩放图片。 */
    imageAutoResize: boolean
    /** 阻止图片发送给 provider。 */
    blockImages: boolean
    /** 终端内联图片显示。 */
    showImages: boolean
    /** 终端图片宽度，单位 cells。 */
    imageWidthCells: number
    /** 内容变短时清理终端空白行。 */
    clearOnShrink: boolean
    /** 终端进度指示。 */
    showTerminalProgress: boolean
  }
  /** 全局资源路径配置。 */
  resources: {
    /** npm/git package sources。 */
    packages: string[]
    /** 本地 extension 路径。 */
    extensions: string[]
    /** 本地 skill 路径。 */
    skills: string[]
    /** 本地 prompt template 路径。 */
    prompts: string[]
    /** 本地 theme 路径。 */
    themes: string[]
  }
  /** shell 与命令设置。 */
  shell: {
    /** 自定义 shell 路径。 */
    shellPath?: string
    /** bash 命令前缀。 */
    shellCommandPrefix?: string
    /** npm 命令 argv。 */
    npmCommand: string[]
    /** Session 存储目录。 */
    sessionDir?: string
  }
  /** 高级模型与渲染配置。 */
  advanced: {
    /** Thinking token budgets。 */
    thinkingBudgets: {
      minimal?: number
      low?: number
      medium?: number
      high?: number
    }
    /** Markdown code block indent。 */
    codeBlockIndent: string
  }
  /** 存储位置。 */
  storage: {
    /** Pi agentDir。 */
    agentDir: string
    /** settings.json 路径。 */
    settingsPath: string
  }
  /** 诊断信息。 */
  diagnostics: AgentSettingsDiagnostic[]
}

/** Desktop 派生的 skill command 信息，用于未创建 thread 时展示 $skill 候选。 */
export interface ResourceSkillCommandInfo {
  /** skill command 名称，例如 skill:review。 */
  name: string
  /** skill 描述，来自 SKILL.md frontmatter。 */
  description?: string
  /** 命令来源。 */
  source: 'skill'
  /** skill 文件来源信息。 */
  sourceInfo: SourceInfo
}

/** Pi-compatible resource / extension 发现快照，附带 desktop-only 展示元数据。 */
export type ResourceSnapshot = PackageResourcesSnapshot & {
  /** 已发现的 skill command 信息；desktop 用于新会话 $ 面板。 */
  skillCommands?: ResourceSkillCommandInfo[]
}

/** Hermes Memory 设置页可管理的记忆范围。 */
export type HermesMemoryTarget = 'memory' | 'user' | 'project' | 'failure'

/** 无需会话即可读取的 Hermes Memory 快照。 */
export interface HermesMemorySnapshot {
  type: 'hermes.snapshot'
  project: string | null
  entries: Record<HermesMemoryTarget, string[]>
  skills: Array<{
    skillId: string
    name: string
    description: string
    scope: string
    updated: string
  }>
  limits: { memory: number; user: number; project: number }
}

/** Hermes Memory 快照查询。cwd 用于解析项目记忆。 */
export interface HermesMemorySnapshotInput {
  cwd?: string
}

/** Hermes Memory 设置页写操作。 */
export type HermesMemoryMutationInput = {
  cwd?: string
  target: HermesMemoryTarget
} & (
  | { operation: 'add'; content: string }
  | { operation: 'replace'; oldText: string; content: string }
  | { operation: 'remove'; oldText: string }
)

/** 获取 Pi-compatible resource / extension 发现快照的输入。 */
export interface ResourceSnapshotInput {
  /** 可选 thread ID；提供时 main 会使用该 thread 的 runtime cwd 与 Project trust 状态。 */
  threadId?: string
  /** 可选项目 cwd；没有 thread 时用于按指定 Project 视角发现资源。 */
  cwd?: string
  /** 指定 cwd 是否按 trusted project 处理；未提供时默认不加载 project-local 资源。 */
  projectTrusted?: boolean
}

/** 获取项目级 extension 路径配置的输入。 */
export interface ProjectExtensionPathsInput {
  /** 项目 cwd。 */
  cwd: string
}

/** 更新项目级 extension 路径配置的输入。 */
export interface UpdateProjectExtensionPathsInput extends ProjectExtensionPathsInput {
  /** 写入项目 .pi/settings.json 的 extensions 配置。 */
  extensions: string[]
}

/** 更新 Pi-compatible agent 设置。 */
export interface UpdateAgentSettingsInput {
  delivery?: Partial<AgentSettingsSnapshot['delivery']>
  runtime?: Partial<AgentSettingsSnapshot['runtime']>
  display?: Partial<AgentSettingsSnapshot['display']>
  safety?: Partial<AgentSettingsSnapshot['safety']>
  media?: Partial<AgentSettingsSnapshot['media']>
  resources?: Partial<AgentSettingsSnapshot['resources']>
  shell?: Partial<AgentSettingsSnapshot['shell']>
  advanced?: Partial<AgentSettingsSnapshot['advanced']>
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
  /** 传递给 Pi extension command handler 的参数。 */
  args?: string
}

/** 运行命令结果。 */
export interface RunCommandResult {
  /** 用户可见的执行结果消息。 */
  message?: string
  /** 用户可见的结构化详情，适合展示长内容。 */
  details?: {
    /** 详情标题。 */
    title: string
    /** 详情正文。 */
    body: string
  }
  /** 是否需要刷新当前 thread snapshot。 */
  refreshSnapshot?: boolean
}

/** 扩展编辑器文本同步输入。 */
export interface ExtensionEditorTextInput extends ThreadIdInput {
  /** 当前编辑器纯文本。 */
  text: string
}

/** 扩展快捷键触发输入。 */
export interface ExtensionShortcutInput extends ThreadIdInput {
  /** Pi KeyId，例如 ctrl+shift+p。 */
  shortcut: string
}

/** 扩展快捷键触发结果。 */
export interface ExtensionShortcutResult {
  /** 是否有 extension 处理该快捷键。 */
  handled: boolean
}

/** 扩展 UI 响应输入。 */
export interface ExtensionUiResponseInput {
  /** 线程 ID。 */
  threadId: string
  /** 响应内容。 */
  response: PackageExtensionUiResponse
}

/** Desktop extension panel 消息输入。 */
export interface ExtensionPanelMessageInput extends ThreadIdInput {
  /** Panel ID。 */
  panelId: string
  /** 消息内容。 */
  message: unknown
}

/** Desktop extension panel 生命周期事件输入。 */
export interface ExtensionPanelLifecycleInput extends ThreadIdInput {
  /** 生命周期事件。 */
  event: PackageDesktopExtensionPanelLifecycle
}

/** Desktop extension panel state 缓存输入。 */
export interface ExtensionPanelStateInput extends ThreadIdInput {
  /** Panel ID。 */
  panelId: string
  /** JSON 可序列化 panel state。 */
  state: unknown
}

/** Desktop extension panel dispose 输入。 */
export interface ExtensionPanelDisposeInput extends ThreadIdInput {
  /** Panel ID。 */
  panelId: string
  /** Dispose 原因。 */
  reason: 'removed' | 'rendererUnmount' | 'threadRestart' | 'userClosed'
}

/** 外部 URL 打开输入。 */
export interface OpenExternalUrlInput {
  /** 要交给系统浏览器/应用打开的 URI。 */
  uri: string
}

/** 需要用户响应的扩展 UI 对话框请求。 */
export type ExtensionDialogRequest = PackageExtensionDialogRequest

/** 扩展 UI 请求。 */
export type ExtensionUiRequest = PackageExtensionUiRequest

/** Desktop extension panel projection. */
export type ExtensionPanelProjection = PackageExtensionPanelProjection

/** Desktop extension webview panel. */
export type DesktopExtensionWebviewPanel = PackageDesktopExtensionWebviewPanel

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
export type AgentSessionIpcEvent = PackageAgentSessionEvent & {
  /** 关联线程 ID。 */
  threadId: string
  /** 与当前 session tree 对应的 entry ID，仅 message_end 持久化后可用。 */
  sessionEntryId?: string
}

/** Desktop UI projection IPC 事件。 */
export type ProjectionIpcEvent = {
  /** Desktop UI projection 事件。 */
  type: 'projection'
  /** 关联线程 ID。 */
  threadId: string
  /** Projection 事件载荷。 */
  event: PackageDesktopProjectionEvent
}

/** Worker lifecycle IPC 事件。 */
export type WorkerIpcEvent = {
  /** Worker 生命周期事件。 */
  type: 'worker'
  /** 关联线程 ID。 */
  threadId?: string
  /** Worker 事件载荷。 */
  event: PackageWorkerLifecycleEvent
}

export type ThreadWorkerLifecycleIpcEvent =
  | {
      type: 'worker.run.started'
      workerId: string
      threadId: string
      cwd: string
      startedAt: number
    }
  | {
      type: 'worker.run.finished'
      workerId: string
      threadId: string
      reason: 'idle' | 'stop' | 'archive' | 'crash' | 'shutdown'
      startedAt: number
      exitedAt: number
      message?: string
      details?: unknown
    }
  | { type: 'worker.run.failed'; threadId?: string; message: string; createdAt: number }

/** Project metadata IPC 事件。 */
export type ProjectIpcEvent =
  | { type: 'project.created'; project: ProjectSummary }
  | { type: 'project.opened'; project: ProjectSummary }
  | { type: 'project.updated'; project: ProjectSummary }
  | { type: 'project.trustChanged'; project: ProjectSummary }

/** Coding Agent IPC 事件联合类型。 */
export type CodingAgentIpcEvent =
  | AgentSessionIpcEvent
  | ProjectionIpcEvent
  | WorkerIpcEvent
  | { type: 'threadSnapshot'; threadId: string; snapshot: ThreadSnapshot }
  | { type: 'threadWorker'; threadId?: string; event: ThreadWorkerLifecycleIpcEvent }
  | {
      /** Project metadata 事件。 */
      type: 'project'
      /** Project 事件载荷。 */
      event: ProjectIpcEvent
    }
  | {
      /** 模型设置 OAuth 登录事件。 */
      type: 'modelOAuth'
      /** OAuth 事件载荷。 */
      event: ModelOAuthLoginEvent
    }
  | {
      /** 资源包安装/更新进度事件。 */
      type: 'resourcePackage'
      /** 资源包事件载荷。 */
      event: ResourcePackageProgressEvent
    }

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
  listThreads(input?: ListThreadsInput): Promise<ThreadSummary[]>
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
  /** 选择并处理 prompt 图片附件；用户取消时返回 undefined。 */
  selectPromptImages(): Promise<PromptImageAttachment[] | undefined>
  /** 直接处理本地 prompt 图片文件。 */
  processPromptImageFiles(paths: string[]): Promise<PromptImageAttachment[]>
  /** 暂存并处理 prompt 图片附件。 */
  stagePromptImages(images: PromptImageDraft[]): Promise<PromptImageAttachment[]>
  /** 选择资源路径；用户取消时返回 undefined。 */
  selectResourcePath(input?: SelectResourcePathInput): Promise<string[] | undefined>
  /** 选择 Pi-compatible session 文件；用户取消时返回 undefined。 */
  selectSessionFile(input?: SelectSessionFileInput): Promise<string | undefined>
  /** 在系统资源管理器中显示资源路径。 */
  revealResourcePath(input: RevealResourcePathInput): Promise<void>
  /** 打开或定位当前 thread snapshot 中的变更文件。 */
  openChangedFile(input: OpenChangedFileInput): Promise<OpenChangedFileResult>
  /** 补全 prompt 中的 Pi @file 文件引用。 */
  completeFileReference(input: FileReferenceCompletionInput): Promise<FileReferenceCompletionResult>
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
  /** 从指定节点创建新的分支线程。 */
  forkThread(input: ForkThreadInput): Promise<ForkThreadResult>
  /** 克隆线程。 */
  clone(threadId: string): Promise<ThreadSnapshot>
  /** 在当前 session tree 内导航。 */
  navigateTree(input: NavigateTreeInput): Promise<NavigateTreeResult>
  /** 加载 session tree 子节点。 */
  loadSessionTreeChildren(
    input: LoadSessionTreeChildrenInput
  ): Promise<NonNullable<ThreadSnapshot['sessionTree']>>
  /** 加载 main 派生的扁平 tree 视图。 */
  loadSessionTreeBranches(
    input: LoadSessionTreeBranchesInput
  ): Promise<LoadSessionTreeBranchesResult>
  /** 加载 root 到指定 entry 的路径。 */
  loadSessionTreePath(input: LoadSessionTreePathInput): Promise<string[]>
  /** 设置 session entry label。 */
  setSessionEntryLabel(input: SetSessionEntryLabelInput): Promise<ThreadSnapshot>
  /** 设置线程标题。 */
  setThreadTitle(input: SetThreadTitleInput): Promise<ThreadSummary>
  /** 重命名线程。 */
  renameThread(input: RenameThreadInput): Promise<void>
  /** 归档线程。 */
  archiveThread(threadId: string): Promise<void>
  /** 恢复归档线程。 */
  restoreThread(threadId: string): Promise<void>
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
  runCommand(input: RunCommandInput): Promise<RunCommandResult | undefined>
  /** 同步编辑器文本给扩展运行时。 */
  syncExtensionEditorText(input: ExtensionEditorTextInput): Promise<void>
  /** 触发扩展快捷键。 */
  dispatchExtensionShortcut(input: ExtensionShortcutInput): Promise<boolean>
  /** 响应 UI 扩展请求。 */
  respondUi(input: ExtensionUiResponseInput): Promise<void>
  /** 向扩展派发 desktop panel 消息。 */
  sendExtensionPanelMessage(input: ExtensionPanelMessageInput): Promise<void>
  /** 向扩展派发 desktop panel 生命周期事件。 */
  sendExtensionPanelLifecycleEvent(input: ExtensionPanelLifecycleInput): Promise<void>
  /** 缓存 desktop panel state，用于 renderer reload 后恢复。 */
  saveExtensionPanelState(input: ExtensionPanelStateInput): Promise<void>
  /** 销毁 desktop extension panel。 */
  disposeExtensionPanel(input: ExtensionPanelDisposeInput): Promise<void>
  /** 受控打开外部 URL。 */
  openExternalUrl(input: OpenExternalUrlInput): Promise<void>
  /** 响应审批请求。 */
  respondApproval(input: ApprovalResponseInput): Promise<void>
  /** 获取 debug diagnostics。 */
  listDiagnostics(input?: DiagnosticsInput): Promise<unknown[]>
  /** 获取全局模型设置快照。 */
  getModelSettings(): Promise<ModelSettingsSnapshot>
  /** 更新全局模型设置。 */
  updateModelSettings(input: UpdateModelSettingsInput): Promise<ModelSettingsSnapshot>
  /** 获取全局模型 registry。 */
  listModelRegistry(): Promise<ModelRegistrySnapshot>
  /** 获取 provider 凭据状态。 */
  listProviderCredentials(): Promise<ProviderCredentialStatus[]>
  /** 获取模型设置诊断。 */
  listModelDiagnostics(): Promise<ModelSettingsDiagnostic[]>
  /** 获取自定义 provider 摘要。 */
  listCustomProviders(): Promise<CustomProviderSummary[]>
  /** 新增或更新自定义 provider。 */
  upsertCustomProvider(input: UpsertCustomProviderInput): Promise<ModelSettingsSnapshot>
  /** 删除自定义 provider。 */
  deleteCustomProvider(provider: string): Promise<ModelSettingsSnapshot>
  /** 保存 provider API key 到 Pi-compatible auth.json。 */
  setProviderApiKey(input: SetProviderApiKeyInput): Promise<ModelSettingsSnapshot>
  /** 使用 OAuth 登录 provider。 */
  loginProviderOAuth(input: LoginProviderOAuthInput): Promise<ModelSettingsSnapshot>
  /** 响应 OAuth 登录过程中的 renderer 输入请求。 */
  respondModelOAuthPrompt(input: ModelOAuthPromptResponseInput): Promise<void>
  /** 刷新模型 registry。 */
  refreshModelRegistry(): Promise<ModelSettingsSnapshot>
  /** 获取 Desktop UI 偏好。 */
  getDesktopUiPreferences(): Promise<DesktopUiPreferences>
  /** 更新 Desktop UI 偏好。 */
  updateDesktopUiPreferences(input: UpdateDesktopUiPreferencesInput): Promise<DesktopUiPreferences>
  /** 获取 Pi-compatible agent 设置。 */
  getAgentSettings(): Promise<AgentSettingsSnapshot>
  /** 更新 Pi-compatible agent 设置。 */
  updateAgentSettings(input: UpdateAgentSettingsInput): Promise<AgentSettingsSnapshot>
  /** 获取 Pi-compatible resource / extension 发现快照。 */
  getResourceSnapshot(input?: ResourceSnapshotInput): Promise<ResourceSnapshot>
  /** 获取无需活跃会话的 Hermes Memory 设置快照。 */
  getHermesMemorySnapshot(input?: HermesMemorySnapshotInput): Promise<HermesMemorySnapshot>
  /** 无需活跃会话地修改 Hermes Memory，并返回最新快照。 */
  mutateHermesMemory(input: HermesMemoryMutationInput): Promise<HermesMemorySnapshot>
  /** 获取项目级 extension 路径配置。 */
  getProjectExtensionPaths(input: ProjectExtensionPathsInput): Promise<string[]>
  /** 更新项目级 extension 路径配置。 */
  updateProjectExtensionPaths(input: UpdateProjectExtensionPathsInput): Promise<string[]>
  /** 列出 Pi package manager 配置包。 */
  listResourcePackages(): Promise<ResourcePackageSummary[]>
  /** 新增并持久化 package source。 */
  addResourcePackage(input: ResourcePackageInput): Promise<ResourcePackageSummary[]>
  /** 安装并持久化 package source。 */
  installResourcePackage(input: ResourcePackageInput): Promise<ResourcePackageSummary[]>
  /** 移除并持久化 package source。 */
  removeResourcePackage(input: ResourcePackageInput): Promise<ResourcePackageSummary[]>
  /** 更新已配置 package source。 */
  updateResourcePackage(input?: UpdateResourcePackageInput): Promise<ResourcePackageSummary[]>
  /** 注册事件监听器，返回取消订阅函数。 */
  onEvent(listener: (event: CodingAgentIpcEvent) => void): () => void
}
