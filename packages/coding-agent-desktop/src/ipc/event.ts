/**
 * 本文件定义 Electron preload IPC 转发给 renderer 的事件结构。
 */

import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { ThreadId } from '../protocol/identity.ts'
import type { ThreadSnapshot } from '../protocol/snapshot.ts'
import type { DesktopProjectionEvent } from '../protocol/events/projection.ts'
import type { WorkerLifecycleEvent } from '../protocol/events/worker.ts'

/**
 * 定义 Electron preload IPC 转发给 renderer 的事件结构。
 * 包含 canonical 会话事件、projection 事件、worker 生命周期事件与 snapshot 更新。
 */
export type DesktopIpcEvent =
  /** Pi canonical agent 会话事件。 */
  | { type: 'canonical'; threadId: ThreadId; event: AgentSessionEvent }
  /** Desktop UI projection 事件。 */
  | { type: 'projection'; threadId: ThreadId; event: DesktopProjectionEvent }
  /** Worker 生命周期事件。 */
  | { type: 'worker'; threadId?: ThreadId; event: WorkerLifecycleEvent }
  /** Thread snapshot 更新事件。 */
  | { type: 'threadSnapshot'; threadId: ThreadId; snapshot: ThreadSnapshot }
