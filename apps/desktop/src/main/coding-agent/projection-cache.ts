/**
 * 本文件负责维护 worker projection events 的临时 UI cache。
 */

import type { CodingThreadStore } from './thread-store'
import type { WorkerEnvelope } from './worker-types'
import type { DesktopProjectionEvent } from '../../../../../packages/coding-agent/src/desktop/protocol/events/projection'

/**
 * 缓存 worker projection event。
 * @param store - Thread metadata/projection cache。
 * @param envelope - worker event envelope。
 */
export function cacheWorkerProjectionEvent(
  store: CodingThreadStore,
  envelope: WorkerEnvelope
): void {
  if (envelope.kind !== 'event') {
    return
  }
  try {
    if (envelope.eventType === 'projection' && envelope.threadId) {
      cacheProjectionEvent(store, envelope.threadId, envelope.event)
    }
  } catch (error) {
    writeIndexDiagnostic(store, envelope.threadId, error)
  }
}

/**
 * 缓存 desktop projection event。
 * @param store - Thread metadata/projection cache。
 * @param threadId - 线程 ID。
 * @param event - projection event。
 */
function cacheProjectionEvent(
  store: CodingThreadStore,
  threadId: string,
  event: DesktopProjectionEvent
): void {
  switch (event.type) {
    case 'approval.requested':
      store.recordApprovalRequest({
        approvalId: event.approval.approvalId,
        threadId,
        status: 'pending',
        request: event.approval,
        createdAt: event.approval.createdAt
      })
      return
    case 'file.changed':
      cacheFileChange(store, threadId, event)
      return
    case 'thread.error':
      store.recordDiagnostic({
        threadId,
        source: event.diagnostic.source ?? 'projection',
        severity: event.diagnostic.severity,
        message: event.diagnostic.message,
        details: event.diagnostic.details,
        createdAt: event.diagnostic.createdAt
      })
      return
  }
}

/**
 * 缓存文件变更事件。
 * @param store - Thread metadata/projection cache。
 * @param threadId - 线程 ID。
 * @param event - projection event。
 */
function cacheFileChange(
  store: CodingThreadStore,
  threadId: string,
  event: Extract<DesktopProjectionEvent, { type: 'file.changed' }>
): void {
  const fileChange = event.change
  store.recordFileChange({
    threadId,
    toolCallId: fileChange.toolCallId,
    path: fileChange.path,
    changeType: fileChange.changeType,
    diff: fileChange.diff,
    patch: fileChange.patch,
    additions: fileChange.additions,
    deletions: fileChange.deletions,
    firstChangedLine: fileChange.firstChangedLine,
    createdAt: fileChange.createdAt
  })
}

/**
 * 尽力记录 projection cache 错误。
 * @param store - Thread metadata/projection cache。
 * @param threadId - 线程 ID。
 * @param error - 错误。
 */
function writeIndexDiagnostic(
  store: CodingThreadStore,
  threadId: string | undefined,
  error: unknown
): void {
  try {
    store.recordDiagnostic({
      threadId,
      source: 'projection_cache',
      severity: 'error',
      message: error instanceof Error ? error.message : String(error)
    })
  } catch {
    // projection cache 不能影响 streaming event 转发。
  }
}

/**
 * 读取字符串字段。
 * @param value - 值。
 * @returns 字符串或 undefined。
 */
