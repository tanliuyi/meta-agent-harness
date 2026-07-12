/**
 * 定义 thread snapshot 与 worker snapshot。
 */

import type { DesktopDiagnostic } from './diagnostic.ts'
import type { CwdPath, SessionFile, ThreadId, WorkerId } from './identity.ts'
import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { ModelIdentity } from './model.ts'
import type { ApprovalRequest } from './approval.ts'
import type { ExtensionDialogRequest } from './extension-ui.ts'
import type { DesktopFileChange, DesktopToolCall } from './tool.ts'
import type { ThreadRuntimeState } from './thread.ts'

/** Desktop session tree 节点。 */
export interface DesktopSessionTreeNode {
  /** Session entry ID。 */
  id: string
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
  /** 是否还有未加载的子节点。 */
  hasMoreChildren?: boolean
  /** 子节点。 */
  children: DesktopSessionTreeNode[]
}

/** Desktop 消息。 */
export interface DesktopMessage {
  /** 消息 ID。 */
  id: string
  /** 对应的 session entry ID；用于从 UI 对这条消息执行 tree/fork 操作。 */
  sessionEntryId?: string
  /** 消息角色。 */
  role: 'user' | 'assistant' | 'tool' | 'system'
  /** Agent 系统事件语义，用于展示非用户/工具/AI 正文的持久化事件。 */
  systemEvent?: DesktopSystemEvent
  /** 派生文本内容，仅供简化 UI 展示。 */
  text?: string
  /** 原始 Agent message，供 renderer 消费非文本结构。 */
  raw: AgentMessage
  /** 该 assistant message 发起的工具调用 ID 列表。 */
  toolCallIds?: string[]
  /** 创建时间（ISO 8601）。 */
  createdAt?: string
}

/** Desktop 系统消息语义。 */
export interface DesktopSystemEvent {
  /** 系统事件类型。 */
  kind: 'compaction' | 'branchSummary' | 'bashExecution' | 'custom' | 'agentEvent'
  /** 面向用户的事件标题。 */
  title: string
  /** 可选摘要说明。 */
  description?: string
  /** 短元信息标签。 */
  meta?: string[]
}

/** Thread snapshot。 */
export interface ThreadSnapshot {
  /** 线程 ID。 */
  threadId: ThreadId
  /** 当前工作目录。 */
  cwd: CwdPath
  /** Session 文件路径（可选）。 */
  sessionFile?: SessionFile
  /** 线程标题。 */
  title?: string
  /** 线程运行时状态。 */
  status: ThreadRuntimeState
  /** 当前模型身份（可选）。 */
  model?: ModelIdentity
  /** 当前 thinking 级别。 */
  thinkingLevel: ThinkingLevel
  /** 消息列表。 */
  messages: DesktopMessage[]
  /** 当前 session tree。 */
  sessionTree?: DesktopSessionTreeNode[]
  /** 当前 leaf entry ID。 */
  currentEntryId?: string | null
  /** 工具调用列表。 */
  toolCalls: DesktopToolCall[]
  /** 文件变更列表。 */
  fileChanges: DesktopFileChange[]
  /** 待审批请求列表。 */
  approvals: ApprovalRequest[]
  /** 等待用户响应的扩展对话框。 */
  extensionDialogs?: ExtensionDialogRequest[]
  /** 队列信息。 */
  queue: {
    /** Steering 队列。 */
    steering: string[]
    /** Follow-up 队列。 */
    followUp: string[]
  }
  /** 是否启用自动上下文压缩。 */
  autoCompactionEnabled?: boolean
  /** 是否启用自动重试。 */
  autoRetryEnabled?: boolean
  /** 上下文使用情况。 */
  context?: {
    /** 已使用 token 数。 */
    tokens?: number
    /** 上下文窗口大小。 */
    contextWindow?: number
    /** 使用百分比。 */
    percent?: number
  }
  /** 成本信息。 */
  cost?: {
    /** 总成本。 */
    total: number
  }
  /** 诊断信息列表。 */
  diagnostics: DesktopDiagnostic[]
}

/** Worker snapshot。 */
export interface WorkerSnapshot {
  /** Worker ID。 */
  workerId: WorkerId
  /** 关联线程 ID（可选）。 */
  threadId?: ThreadId
  /** Worker 状态。 */
  state: 'starting' | 'ready' | 'bound' | 'busy' | 'idle' | 'stopping' | 'exited' | 'crashed'
  /** 进程 ID（可选）。 */
  pid?: number
  /** 启动时间（ISO 8601）。 */
  startedAt?: string
  /** 最后活跃时间（ISO 8601）。 */
  lastActiveAt?: string
  /** 关联线程快照（可选）。 */
  thread?: ThreadSnapshot
  /** 诊断信息列表。 */
  diagnostics: DesktopDiagnostic[]
}
