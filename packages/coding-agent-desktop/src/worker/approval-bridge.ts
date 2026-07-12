/**
 * 实现 desktop approval request 与 response 的 transport 关联。
 */

import type { ApprovalRequest, ApprovalResponse } from '../protocol/approval.ts'
import type { ThreadId } from '../protocol/identity.ts'
import type { WorkerEventEnvelope } from '../protocol/envelope.ts'

/** 等待中的审批请求。 */
interface PendingApproval {
  request: ApprovalRequest
  resolve: (response: ApprovalResponse) => void
  reject: (error: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

/**
 * 审批桥接，负责向 renderer 发送审批请求并接收响应。
 */
export class ApprovalBridge {
  private readonly threadId: ThreadId
  private readonly emit: (event: WorkerEventEnvelope) => void
  private readonly pending = new Map<string, PendingApproval>()

  /**
   * 创建 ApprovalBridge 实例。
   * @param threadId - 关联的 thread ID。
   * @param emit - 发送事件 envelope 的函数。
   */
  constructor(threadId: ThreadId, emit: (event: WorkerEventEnvelope) => void) {
    this.threadId = threadId
    this.emit = emit
  }

  /**
   * 发起审批请求。
   * @param input - 审批请求内容，不包含 threadId 与 createdAt。
   * @returns 审批响应 promise。
   */
  request(input: Omit<ApprovalRequest, 'threadId' | 'createdAt'>): Promise<ApprovalResponse> {
    const approval: ApprovalRequest = {
      ...input,
      threadId: this.threadId,
      createdAt: new Date().toISOString()
    }
    return new Promise<ApprovalResponse>((resolve, reject) => {
      const timer = approval.timeoutMs
        ? setTimeout(() => {
            this.pending.delete(approval.approvalId)
            this.emitDismissed(approval.approvalId, 'timeout')
            reject(new Error(`approval request timed out: ${approval.approvalId}`))
          }, approval.timeoutMs)
        : undefined
      this.pending.set(approval.approvalId, { request: approval, resolve, reject, timer })
      this.emit({
        kind: 'event',
        eventType: 'projection',
        threadId: this.threadId,
        event: { type: 'approval.requested', threadId: this.threadId, approval }
      })
    })
  }

  /** 获取当前等待响应的审批请求。 */
  listPending(): ApprovalRequest[] {
    return [...this.pending.keys()].flatMap((approvalId) => {
      const pending = this.pending.get(approvalId)
      return pending?.request ? [pending.request] : []
    })
  }

  /**
   * 响应指定审批请求。
   * @param response - 审批响应。
   */
  respond(response: ApprovalResponse): void {
    const pending = this.pending.get(response.approvalId)
    if (!pending) {
      throw new Error(`approval request not found: ${response.approvalId}`)
    }
    if (pending.timer) {
      clearTimeout(pending.timer)
    }
    this.pending.delete(response.approvalId)
    pending.resolve(response)
  }

  /**
   * 拒绝所有等待中的审批请求。
   * @param reason - 对外投影的取消原因。
   */
  rejectAll(reason: 'sessionInvalidated' | 'workerStopped'): void {
    for (const [id, pending] of this.pending) {
      if (pending.timer) {
        clearTimeout(pending.timer)
      }
      this.pending.delete(id)
      this.emitDismissed(id, reason)
      pending.reject(new Error(reason))
    }
  }

  private emitDismissed(
    approvalId: string,
    reason: 'timeout' | 'sessionInvalidated' | 'workerStopped'
  ): void {
    this.emit({
      kind: 'event',
      eventType: 'projection',
      threadId: this.threadId,
      event: { type: 'approval.dismissed', threadId: this.threadId, approvalId, reason }
    })
  }
}
