/**
 * 定义 desktop 后端统一诊断结构。
 */

import type { IsoTime, ThreadId, WorkerId } from './identity.ts'

/** 诊断严重级别。 */
export type DiagnosticSeverity = 'debug' | 'info' | 'warning' | 'error'

/** Desktop 诊断信息。 */
export interface DesktopDiagnostic {
  /** 诊断唯一标识。 */
  id: string
  /** 严重级别。 */
  severity: DiagnosticSeverity
  /** 诊断消息。 */
  message: string
  /** 来源组件。 */
  source: 'worker' | 'pool' | 'ipc' | 'storage' | 'protocol' | 'runtime'
  /** 关联线程 ID。 */
  threadId?: ThreadId
  /** 关联 worker ID。 */
  workerId?: WorkerId
  /** 额外细节。 */
  details?: unknown
  /** 创建时间（ISO 8601）。 */
  createdAt: IsoTime
}
