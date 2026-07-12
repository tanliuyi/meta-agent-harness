/**
 * 本文件定义 preload 暴露给 renderer 的 coding agent API 形状。
 */

import type { ApprovalResponse } from '../protocol/approval.ts'
import type { WorkerCommand } from '../protocol/envelope.ts'
import type { ExtensionUiResponse } from '../protocol/extension-ui.ts'
import type { ThreadId } from '../protocol/identity.ts'
import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { ThreadSnapshot } from '../protocol/snapshot.ts'
import type { StartThreadInput, ThreadSummary } from '../protocol/thread.ts'
import type { DesktopIpcEvent } from './event.ts'

/**
 * 定义 preload 暴露给 renderer 的 coding agent API 形状。
 * 包含线程生命周期、命令发送、UI 与审批响应、以及事件监听。
 */
export interface CodingAgentApi {
  /** 创建新的 coding thread。 */
  createThread(input: StartThreadInput): Promise<ThreadSnapshot>
  /** 停止指定 thread。 */
  stopThread(threadId: ThreadId): Promise<void>
  /** 列出所有 thread 摘要。 */
  listThreads(): Promise<ThreadSummary[]>
  /** 获取指定 thread 的 snapshot。 */
  getSnapshot(threadId: ThreadId): Promise<ThreadSnapshot>
  /** 向指定 thread 发送 worker 命令。 */
  send(threadId: ThreadId, command: WorkerCommand): Promise<unknown>
  /** 设置指定 thread 的 thinking 级别。 */
  setThinkingLevel(threadId: ThreadId, level: ThinkingLevel): Promise<void>
  /** 响应 extension UI 请求。 */
  respondUi(response: ExtensionUiResponse): Promise<void>
  /** 响应审批请求。 */
  respondApproval(response: ApprovalResponse): Promise<void>
  /** 注册事件监听器，返回取消订阅函数。 */
  onEvent(listener: (event: DesktopIpcEvent) => void): () => void
}
