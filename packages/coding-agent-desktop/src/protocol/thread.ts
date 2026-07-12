/**
 * 定义 coding thread 的输入、状态与摘要类型。
 */

import type { CwdPath, IsoTime, SessionFile, ThreadId } from './identity.ts'
import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { RpcResponse, RpcSessionState } from '@earendil-works/pi-coding-agent'
import type { DesktopSessionTreeNode } from './snapshot.ts'
import type { ApprovalRequest } from './approval.ts'
import type { ExtensionDialogRequest } from './extension-ui.ts'

/** Thread 运行时状态。 */
export type ThreadRuntimeState =
  'new' | 'queued' | 'starting' | 'idle' | 'running' | 'stopping' | 'stopped' | 'error'

/** 启动 thread 的输入。 */
export interface StartThreadInput {
  /** 线程 ID（可选，未指定时由系统生成）。 */
  threadId?: ThreadId
  /** 当前工作目录。 */
  cwd: CwdPath
  /** Session 文件路径（可选）。 */
  sessionFile?: SessionFile
  /** 可选 cwd 覆盖；未设置时 resume 使用 JSONL session header cwd。 */
  cwdOverride?: CwdPath
  /** 线程标题。 */
  title?: string
  /** 新线程的初始模型；恢复已有 session 时通常不传。 */
  initialModel?: { provider: string; modelId: string }
  /** 新线程的初始 thinking level；恢复已有 session 时通常不传。 */
  thinkingLevel?: ThinkingLevel
  /** Agent 目录路径（可选）。 */
  agentDir?: string
  /** Project trust 覆盖；desktop host 已在 Project 层解析时传入。 */
  projectTrustOverride?: boolean
}

/** Thread 摘要。 */
export interface ThreadSummary {
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
  /** 创建时间（ISO 8601）。 */
  createdAt: IsoTime
  /** 最后更新时间（ISO 8601）。 */
  updatedAt: IsoTime
}

/** 当前 AgentSession live runtime state：复用 Pi RPC get_state，只追加 desktop runtime cwd。 */
export type ThreadLiveState = RpcSessionState & {
  /** 当前 runtime cwd，resume 时来自 Pi session header 或 cwdOverride。 */
  cwd: CwdPath
  /** 当前 session tree。 */
  sessionTree?: DesktopSessionTreeNode[]
  /** 当前 leaf entry ID。 */
  currentEntryId?: string | null
  /** 当前是否启用自动重试。 */
  autoRetryEnabled?: boolean
  /** 当前等待投递的消息队列。 */
  queue: {
    steering: string[]
    followUp: string[]
  }
  /** 当前等待响应的审批。 */
  approvals: ApprovalRequest[]
  /** 当前等待用户响应的扩展对话框。 */
  extensionDialogs: ExtensionDialogRequest[]
}

/** get_messages 命令返回的 Pi live messages。 */
export type ThreadMessagesResponse = Extract<
  RpcResponse,
  { command: 'get_messages'; success: true }
>['data'] & {
  /** 当前 branch 中与可渲染 message 对齐的 session entry IDs。 */
  messageEntryIds?: string[]
  /** Pi live messages。 */
  messages: AgentMessage[]
}
