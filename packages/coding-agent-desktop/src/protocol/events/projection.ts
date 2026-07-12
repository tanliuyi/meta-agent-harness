/**
 * 定义 desktop UI projection event。
 */

import type { ApprovalRequest } from '../approval.ts'
import type { DesktopDiagnostic } from '../diagnostic.ts'
import type { ExtensionPanelProjection } from '../extension-panel.ts'
import type { ExtensionUiRequest } from '../extension-ui.ts'
import type { ThreadId } from '../identity.ts'
import type { DesktopFileChange } from '../tool.ts'
import type { ThreadRuntimeState } from '../thread.ts'

/** Desktop UI projection 事件联合类型。 */
export type DesktopProjectionEvent =
  | {
      /** 事件类型：线程状态变化。 */
      type: 'thread.stateChanged'
      /** 线程 ID。 */
      threadId: ThreadId
      /** 新的运行时状态。 */
      status: ThreadRuntimeState
    }
  | {
      /** 事件类型：线程发生错误。 */
      type: 'thread.error'
      /** 线程 ID。 */
      threadId: ThreadId
      /** 诊断信息。 */
      diagnostic: DesktopDiagnostic
    }
  | {
      /** 事件类型：文件已变更。 */
      type: 'file.changed'
      /** 线程 ID。 */
      threadId: ThreadId
      /** 文件变更信息。 */
      change: DesktopFileChange
    }
  | {
      /** 事件类型：审批已请求。 */
      type: 'approval.requested'
      /** 线程 ID。 */
      threadId: ThreadId
      /** 审批请求。 */
      approval: ApprovalRequest
    }
  | {
      /** 事件类型：审批请求已由 host 取消。 */
      type: 'approval.dismissed'
      /** 线程 ID。 */
      threadId: ThreadId
      /** 被取消的审批 ID。 */
      approvalId: string
      /** 取消原因。 */
      reason: 'timeout' | 'sessionInvalidated' | 'workerStopped'
    }
  | {
      /** 事件类型：扩展 UI 已请求。 */
      type: 'extensionUi.requested'
      /** 线程 ID。 */
      threadId: ThreadId
      /** 扩展 UI 请求。 */
      request: ExtensionUiRequest
    }
  | {
      /** 事件类型：扩展 UI 请求已由 host 取消。 */
      type: 'extensionUi.dismissed'
      /** 线程 ID。 */
      threadId: ThreadId
      /** 被取消的请求 ID。 */
      requestId: string
      /** 取消原因。 */
      reason: 'aborted' | 'timeout' | 'sessionInvalidated' | 'workerStopped'
    }
  | (ExtensionPanelProjection & {
      /** 线程 ID。 */
      threadId: ThreadId
    })
