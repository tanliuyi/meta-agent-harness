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

/** 可按文件聚合的变更投影字段。 */
export interface FileChangeProjection {
  /** 线程 ID。 */
  threadId: ThreadId
  /** 文件路径。 */
  path: string
  /** 变更类型。 */
  changeType: string
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
  createdAt?: IsoTime
}

/** Desktop 文件变更。 */
export interface DesktopFileChange extends FileChangeProjection {
  changeType: DesktopFileChangeType
  createdAt: IsoTime
}

/** 从 edit 工具结果派生文件变更所需的输入。 */
export interface DesktopEditFileChangeInput {
  /** 线程 ID。 */
  threadId: ThreadId
  /** edit 工具运行目录，用于统一绝对与相对路径。 */
  cwd?: string
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

/** 判断两个投影是否属于同一 thread 中的同一路径。 */
export function isSameFileChange(
  left: Pick<FileChangeProjection, 'threadId' | 'path'>,
  right: Pick<FileChangeProjection, 'threadId' | 'path'>
): boolean {
  return (
    left.threadId === right.threadId &&
    normalizeFileChangePath(left.path) === normalizeFileChangePath(right.path)
  )
}

/**
 * 合并同一文件的连续变更，保留首次出现位置所需的稳定字段。
 * @param existing - 已聚合的文件变更。
 * @param incoming - 新到达的文件变更。
 * @returns 合并后的文件变更。
 */
export function mergeFileChangeProjection<Change extends FileChangeProjection>(
  existing: Change,
  incoming: Change
): Change {
  return {
    ...existing,
    ...incoming,
    threadId: existing.threadId,
    path: existing.path,
    toolCallId: existing.toolCallId ?? incoming.toolCallId,
    diff: appendChangeText(existing.diff ?? existing.patch, incoming.diff ?? incoming.patch),
    patch: appendChangeText(existing.patch, incoming.patch),
    additions: addOptionalCounts(existing.additions, incoming.additions),
    deletions: addOptionalCounts(existing.deletions, incoming.deletions),
    firstChangedLine: getFirstChangedLine(existing.firstChangedLine, incoming.firstChangedLine),
    createdAt: existing.createdAt ?? incoming.createdAt
  } as Change
}

/**
 * 批量聚合 Desktop 文件变更。
 * @param changes - 按发生顺序排列的文件变更。
 * @returns 按文件首次出现顺序排列的聚合结果。
 */
export function mergeDesktopFileChanges(
  changes: readonly DesktopFileChange[]
): DesktopFileChange[] {
  const merged: DesktopFileChange[] = []
  const indexByFile = new Map<string, number>()
  for (const change of changes) {
    const key = getFileChangeKey(change)
    const existingIndex = indexByFile.get(key)
    if (existingIndex === undefined) {
      indexByFile.set(key, merged.length)
      merged.push(change)
      continue
    }
    const existing = merged[existingIndex]
    if (existing) {
      merged[existingIndex] = mergeFileChangeProjection(existing, change)
    }
  }
  return merged
}

/**
 * 将文件变更插入按文件聚合的 Desktop 列表。
 * @param changes - 已按文件聚合的变更列表。
 * @param incoming - 新到达的文件变更。
 * @returns 保持文件首次出现顺序的新列表。
 */
export function upsertDesktopFileChange(
  changes: readonly DesktopFileChange[],
  incoming: DesktopFileChange
): DesktopFileChange[] {
  const existingIndex = changes.findIndex((change) => isSameFileChange(change, incoming))
  if (existingIndex < 0) {
    return [...changes, incoming]
  }
  const next = [...changes]
  const existing = next[existingIndex]
  if (existing) {
    next[existingIndex] = mergeFileChangeProjection(existing, incoming)
  }
  return next
}

/** 从 Pi edit tool result 派生 desktop file change projection。 */
export function createDesktopFileChangeFromEditResult(
  input: DesktopEditFileChangeInput
): DesktopFileChange | undefined {
  if (input.toolName !== 'edit' || input.isError) {
    return undefined
  }
  const rawPath = readStringField(input.args, 'path') ?? readStringField(input.args, 'file_path')
  if (!rawPath) {
    return undefined
  }
  const path = normalizeFileChangePath(rawPath, input.cwd)
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

function getFileChangeKey(change: Pick<FileChangeProjection, 'threadId' | 'path'>): string {
  return `${change.threadId}\0${normalizeFileChangePath(change.path)}`
}

function normalizeFileChangePath(path: string, cwd?: string): string {
  const normalizedPath = resolvePathSegments(path)
  if (!cwd) return normalizedPath

  const normalizedCwd = resolvePathSegments(cwd).replace(/\/$/, '')
  const caseInsensitive = /^(?:[a-z]:\/|\/\/)/i.test(normalizedCwd)
  const comparablePath = caseInsensitive ? normalizedPath.toLowerCase() : normalizedPath
  const comparableCwd = caseInsensitive ? normalizedCwd.toLowerCase() : normalizedCwd
  if (comparablePath === comparableCwd) return ''
  if (comparablePath.startsWith(`${comparableCwd}/`)) {
    return normalizedPath.slice(normalizedCwd.length + 1)
  }
  return normalizedPath
}

function resolvePathSegments(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const drive = normalized.match(/^([a-z]:)(?:\/|$)/i)?.[1]
  const isUnc = normalized.startsWith('//')
  const isAbsolute = isUnc || normalized.startsWith('/') || Boolean(drive)
  const segments: string[] = []
  for (const segment of normalized.slice(drive?.length ?? 0).split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      const previous = segments.at(-1)
      if (previous && previous !== '..') {
        segments.pop()
      } else if (!isAbsolute) {
        segments.push(segment)
      }
      continue
    }
    segments.push(segment)
  }
  const prefix = drive ? `${drive}/` : isUnc ? '//' : isAbsolute ? '/' : ''
  return `${prefix}${segments.join('/')}`
}

function appendChangeText(
  existing: string | undefined,
  incoming: string | undefined
): string | undefined {
  if (!existing) return incoming
  if (!incoming) return existing
  return `${existing.replace(/\n+$/, '')}\n${incoming.replace(/^\n+|\n+$/g, '')}`
}

function addOptionalCounts(
  left: number | undefined,
  right: number | undefined
): number | undefined {
  if (left === undefined && right === undefined) return undefined
  return (left ?? 0) + (right ?? 0)
}

function getFirstChangedLine(
  existing: number | undefined,
  incoming: number | undefined
): number | undefined {
  if (existing === undefined) return incoming
  if (incoming === undefined) return existing
  return Math.min(existing, incoming)
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
