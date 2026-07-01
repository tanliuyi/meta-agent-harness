/**
 * 本文件定义 worker transport 中传输的命令、响应和事件 envelope。
 */

import type { AgentSessionEvent } from '../../core/agent-session.ts'
import type { DesktopError } from './error.ts'
import type { RequestId, ThreadId } from './identity.ts'
import type { CanonicalAgentCommand } from './commands/canonical.ts'
import type { DesktopControlCommand } from './commands/control.ts'
import type { DesktopProjectionEvent } from './events/projection.ts'
import type { WorkerLifecycleEvent } from './events/worker.ts'

export type WorkerCommand = CanonicalAgentCommand | DesktopControlCommand

export interface WorkerCommandEnvelope {
  kind: 'command'
  id: RequestId
  command: WorkerCommand
}

export interface WorkerResponseEnvelope<T = unknown> {
  kind: 'response'
  id: RequestId
  command: string
  success: boolean
  data?: T
  error?: DesktopError
}

export type WorkerEventEnvelope =
  | { kind: 'event'; eventType: 'canonical'; threadId: ThreadId; event: AgentSessionEvent }
  | { kind: 'event'; eventType: 'projection'; threadId: ThreadId; event: DesktopProjectionEvent }
  | { kind: 'event'; eventType: 'worker'; threadId?: ThreadId; event: WorkerLifecycleEvent }

export type WorkerEnvelope = WorkerCommandEnvelope | WorkerResponseEnvelope | WorkerEventEnvelope

export function createWorkerResponse<T>(
  id: RequestId,
  command: string,
  data: T
): WorkerResponseEnvelope<T> {
  return { kind: 'response', id, command, success: true, data }
}

export function createWorkerErrorResponse(
  id: RequestId,
  command: string,
  error: DesktopError
): WorkerResponseEnvelope {
  return { kind: 'response', id, command, success: false, error }
}
