/**
 * 定义 desktop 后端审批请求与响应结构。
 */

import type { IsoTime, ThreadId } from './identity.ts'

/** 审批风险等级。 */
export type ApprovalRisk = 'low' | 'medium' | 'high'

/** 审批作用域。 */
export type ApprovalScope = 'once' | 'thread' | 'workspace'

/** 审批请求。 */
export interface ApprovalRequest {
  /** 审批唯一标识。 */
  approvalId: string
  /** 所属线程 ID。 */
  threadId: ThreadId
  /** 待审批的操作描述。 */
  action: string
  /** 风险等级。 */
  risk: ApprovalRisk
  /** 审批作用域。 */
  scope: ApprovalScope
  /** 可选的选项列表。 */
  choices?: string[]
  /** 审批主题（摘要）。 */
  subject?: string
  /** 默认操作：允许或拒绝。 */
  defaultAction: 'allow' | 'deny'
  /** 超时时间，单位毫秒。 */
  timeoutMs?: number
  /** 创建时间（ISO 8601）。 */
  createdAt: IsoTime
}

/** 审批响应。 */
export interface ApprovalResponse {
  /** 审批唯一标识。 */
  approvalId: string
  /** 是否允许执行。 */
  allow: boolean
  /** 审批作用域。 */
  scope: ApprovalScope
  /** 选中的选项。 */
  choice?: string
  /** 拒绝或说明原因。 */
  reason?: string
}
