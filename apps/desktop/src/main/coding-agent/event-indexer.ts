/**
 * 本文件负责把 worker/canonical/projection events 索引到 SQLite projection 表。
 */

import type { CodingThreadStore } from './thread-store'
import type { WorkerEnvelope } from './worker-types'

/**
 * 索引 worker event。
 * @param store - Thread store。
 * @param envelope - worker event envelope。
 */
export function indexWorkerEvent(store: CodingThreadStore, envelope: WorkerEnvelope): void {
  if (envelope.kind !== 'event') {
    return
  }
  try {
    if (envelope.eventType === 'canonical' && envelope.threadId) {
      indexCanonicalEvent(store, envelope.threadId, envelope.event)
      return
    }
    if (envelope.eventType === 'projection' && envelope.threadId) {
      indexProjectionEvent(store, envelope.threadId, envelope.event)
    }
  } catch (error) {
    writeIndexDiagnostic(store, envelope.threadId, error)
  }
}

/**
 * 索引 canonical event 的可恢复摘要。
 * @param store - Thread store。
 * @param threadId - 线程 ID。
 * @param event - canonical event。
 */
function indexCanonicalEvent(store: CodingThreadStore, threadId: string, event: unknown): void {
  if (!isRecord(event)) {
    return
  }
  if (event.type === 'message_update') {
    const message = isRecord(event.message) ? event.message : undefined
    const role = normalizeMessageRole(message?.role)
    if (!role) {
      return
    }
    store.saveMessageIndex({
      threadId,
      sessionEntryId: getString(event.entryId) ?? getString(event.messageId) ?? crypto.randomUUID(),
      role,
      summary: extractText(message?.content) ?? extractText(event.delta),
      createdAt: normalizeTimestamp(event.timestamp)
    })
  }
}

/**
 * 索引 desktop projection event。
 * @param store - Thread store。
 * @param threadId - 线程 ID。
 * @param event - projection event。
 */
function indexProjectionEvent(store: CodingThreadStore, threadId: string, event: unknown): void {
  if (!isRecord(event)) {
    return
  }
  switch (event.type) {
    case 'approval.requested':
      if (isRecord(event.approval)) {
        const approvalId = getString(event.approval.approvalId)
        if (approvalId) {
          store.saveApprovalRequest({
            approvalId,
            threadId,
            status: 'pending',
            request: event.approval,
            createdAt: getString(event.approval.createdAt)
          })
        }
      }
      return
    case 'approval.resolved':
      if (getString(event.approvalId)) {
        store.resolveApproval(
          getString(event.approvalId)!,
          event.response,
          getString(event.status) ?? 'resolved'
        )
      }
      return
    case 'tool.call':
    case 'tool.updated':
      indexToolCall(store, threadId, event)
      return
    case 'file.changed':
      indexFileChange(store, threadId, event)
      return
    case 'diagnostic':
      store.saveDiagnostic({
        threadId,
        source: getString(event.source) ?? 'projection',
        severity: getString(event.severity) ?? 'info',
        message: getString(event.message) ?? 'projection diagnostic',
        details: event.details,
        createdAt: getString(event.createdAt)
      })
      return
  }
}

/**
 * 索引工具调用事件。
 * @param store - Thread store。
 * @param threadId - 线程 ID。
 * @param event - projection event。
 */
function indexToolCall(store: CodingThreadStore, threadId: string, event: Record<string, unknown>): void {
  const toolCall = isRecord(event.toolCall) ? event.toolCall : event
  const toolCallId = getString(toolCall.toolCallId) ?? getString(toolCall.id)
  const toolName = getString(toolCall.toolName) ?? getString(toolCall.name)
  if (!toolCallId || !toolName) {
    return
  }
  store.saveToolCall({
    threadId,
    toolCallId,
    toolName,
    status: getString(toolCall.status) ?? 'running',
    args: toolCall.args,
    resultSummary: getString(toolCall.resultSummary),
    startedAt: getString(toolCall.startedAt),
    finishedAt: getString(toolCall.finishedAt)
  })
}

/**
 * 索引文件变更事件。
 * @param store - Thread store。
 * @param threadId - 线程 ID。
 * @param event - projection event。
 */
function indexFileChange(store: CodingThreadStore, threadId: string, event: Record<string, unknown>): void {
  const fileChange = isRecord(event.fileChange) ? event.fileChange : event
  const path = getString(fileChange.path)
  if (!path) {
    return
  }
  store.saveFileChange({
    threadId,
    toolCallId: getString(fileChange.toolCallId),
    path,
    changeType: getString(fileChange.changeType) ?? 'updated',
    patch: getString(fileChange.patch),
    createdAt: getString(fileChange.createdAt)
  })
}

/**
 * 尽力记录索引错误。
 * @param store - Thread store。
 * @param threadId - 线程 ID。
 * @param error - 错误。
 */
function writeIndexDiagnostic(store: CodingThreadStore, threadId: string | undefined, error: unknown): void {
  try {
    store.saveDiagnostic({
      threadId,
      source: 'event_indexer',
      severity: 'error',
      message: error instanceof Error ? error.message : String(error)
    })
  } catch {
    // projection indexing 不能影响 streaming event 转发。
  }
}

/**
 * 归一化消息角色。
 * @param role - 原始角色。
 * @returns role 或 undefined。
 */
function normalizeMessageRole(role: unknown): string | undefined {
  if (typeof role !== 'string') {
    return undefined
  }
  if (role === 'toolResult') {
    return 'tool'
  }
  return role
}

/**
 * 提取文本。
 * @param value - 值。
 * @returns 文本。
 */
function extractText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (!Array.isArray(value)) {
    return undefined
  }
  const text = value
    .filter((part): part is { type: string; text: string } => {
      return isRecord(part) && part.type === 'text' && typeof part.text === 'string'
    })
    .map((part) => part.text)
    .join('')
  return text || undefined
}

/**
 * 归一化 timestamp。
 * @param value - timestamp。
 * @returns ISO 字符串或 undefined。
 */
function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    return new Date(value).toISOString()
  }
  return undefined
}

/**
 * 读取字符串字段。
 * @param value - 值。
 * @returns 字符串或 undefined。
 */
function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * 判断是否普通对象。
 * @param value - 值。
 * @returns 是否对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
