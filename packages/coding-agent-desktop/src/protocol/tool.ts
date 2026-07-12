/**
 * 定义 desktop projection 使用的工具与文件变更结构。
 */

import type { IsoTime, ThreadId } from './identity.ts'

/** Desktop 工具调用状态。 */
export type DesktopToolStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** Desktop 工具调用。 */
export interface DesktopToolCall {
  /** 线程 ID。 */
  threadId: ThreadId
  /** 工具调用 ID。 */
  toolCallId: string
  /** 工具名称。 */
  toolName: string
  /** 当前状态。 */
  status: DesktopToolStatus
  /** 调用参数。 */
  args?: unknown
  /** 流式工具更新的局部结果。 */
  partialResult?: unknown
  /** 原始工具结果。 */
  result?: unknown
  /** 结果摘要。 */
  resultSummary?: string
  /** 原始工具执行事件或投影事件。 */
  rawEvent?: unknown
  /** 开始时间（ISO 8601）。 */
  startedAt?: IsoTime
  /** 结束时间（ISO 8601）。 */
  finishedAt?: IsoTime
}

/** Desktop 文件变更类型。 */
export type DesktopFileChangeType = 'created' | 'updated' | 'deleted' | 'renamed'

/** Desktop 文件变更。 */
export interface DesktopFileChange {
  /** 线程 ID。 */
  threadId: ThreadId
  /** 文件路径。 */
  path: string
  /** 变更类型。 */
  changeType: DesktopFileChangeType
  /** 关联工具调用 ID（可选）。 */
  toolCallId?: string
  /** 适合 UI 展示的 diff（可选）。 */
  diff?: string
  /** 文件变更 diff（可选）。 */
  patch?: string
  /** 新增行数（可选）。 */
  additions?: number
  /** 删除行数（可选）。 */
  deletions?: number
  /** 新文件中的首个变更行号（可选）。 */
  firstChangedLine?: number
  /** 变更时间（ISO 8601）。 */
  createdAt: IsoTime
}

/** 从 edit 工具结果派生文件变更所需的输入。 */
export interface DesktopEditFileChangeInput {
  /** 线程 ID。 */
  threadId: ThreadId
  /** 工具调用 ID（可选）。 */
  toolCallId?: string
  /** 工具名称。 */
  toolName: string
  /** 工具调用参数。 */
  args?: unknown
  /** 工具结果。 */
  result?: unknown
  /** 工具是否失败。 */
  isError?: boolean
  /** 事件时间。 */
  createdAt?: IsoTime
}

/** 从 Pi edit tool result 派生 desktop file change projection。 */
export function createDesktopFileChangeFromEditResult(
  input: DesktopEditFileChangeInput
): DesktopFileChange | undefined {
  if (input.toolName !== 'edit' || input.isError) {
    return undefined
  }
  const path = readStringField(input.args, 'path') ?? readStringField(input.args, 'file_path')
  if (!path) {
    return undefined
  }
  const result = isRecord(input.result) ? input.result : undefined
  const details = isRecord(result?.details) ? result.details : undefined
  const diff = readStringField(details, 'diff')
  const patch = readStringField(details, 'patch')
  if (!diff && !patch) {
    return undefined
  }
  const stats = countDiffStats(diff, patch)
  const firstChangedLine = readNumberField(details, 'firstChangedLine')
  return {
    threadId: input.threadId,
    path,
    changeType: 'updated',
    toolCallId: input.toolCallId,
    diff,
    patch,
    additions: stats.additions,
    deletions: stats.deletions,
    firstChangedLine,
    createdAt: input.createdAt ?? new Date().toISOString()
  }
}

function countDiffStats(
  diff: string | undefined,
  patch: string | undefined
): { additions: number; deletions: number } {
  if (diff) {
    let additions = 0
    let deletions = 0
    for (const line of diff.split('\n')) {
      if (/^\+\s*\d+\s/.test(line)) additions++
      if (/^-\s*\d+\s/.test(line)) deletions++
    }
    return { additions, deletions }
  }
  let additions = 0
  let deletions = 0
  for (const line of (patch ?? '').split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++
    if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }
  return { additions, deletions }
}

function readStringField(value: unknown, field: string): string | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const raw = value[field]
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

function readNumberField(value: unknown, field: string): number | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const raw = value[field]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
