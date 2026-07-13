import type { VirtualItem } from '@tanstack/vue-virtual'
import type { ThreadSnapshot } from '@shared/coding-agent/types'

export type FileChange = ThreadSnapshot['fileChanges'][number]

export interface FileChangeStats {
  additions: number
  deletions: number
}

export interface VirtualFileChangeRow {
  virtualItem: VirtualItem
  change: FileChange
}

export interface DiffLineRange {
  start: number
  end: number
}

export const CHANGE_FILE_SUMMARY_HEIGHT = 33
export const CHANGE_FILE_DIFF_BORDER_HEIGHT = 1
export const CHANGE_FILE_DIFF_LINE_HEIGHT = 20
export const CHANGE_FILE_EMPTY_DIFF_HEIGHT = 36
export const CHANGE_FILE_LINE_OVERSCAN = 12

export function createVirtualFileChangeRows(
  virtualItems: VirtualItem[],
  fileChanges: FileChange[]
): VirtualFileChangeRow[] {
  const rows: VirtualFileChangeRow[] = []
  for (const virtualItem of virtualItems) {
    const change = fileChanges[virtualItem.index]
    if (change) {
      rows.push({ virtualItem, change })
    }
  }
  return rows
}

export function countFileChangeStats(
  fileChanges: FileChange[],
  startIndex = 0,
  initialStats: FileChangeStats = { additions: 0, deletions: 0 }
): FileChangeStats {
  let additions = initialStats.additions
  let deletions = initialStats.deletions
  for (let index = startIndex; index < fileChanges.length; index += 1) {
    const change = fileChanges[index]
    additions += change?.additions ?? 0
    deletions += change?.deletions ?? 0
  }
  return { additions, deletions }
}

export function getFileChangeLayoutSize(
  lineCount: number,
  expanded: boolean,
  hasDiff: boolean,
  lineScale = 1
): number {
  if (!expanded) {
    return CHANGE_FILE_SUMMARY_HEIGHT
  }
  const contentHeight = hasDiff
    ? Math.max(CHANGE_FILE_DIFF_LINE_HEIGHT, (lineCount * CHANGE_FILE_DIFF_LINE_HEIGHT) / lineScale)
    : CHANGE_FILE_EMPTY_DIFF_HEIGHT
  return CHANGE_FILE_SUMMARY_HEIGHT + CHANGE_FILE_DIFF_BORDER_HEIGHT + contentHeight
}

export function getVisibleDiffLineRange(
  fileStart: number,
  lineCount: number,
  scrollTop: number,
  viewportHeight: number,
  lineScale = 1
): DiffLineRange {
  const diffStart = fileStart + CHANGE_FILE_SUMMARY_HEIGHT + CHANGE_FILE_DIFF_BORDER_HEIGHT
  const diffHeight = Math.max(
    CHANGE_FILE_DIFF_LINE_HEIGHT,
    (lineCount * CHANGE_FILE_DIFF_LINE_HEIGHT) / lineScale
  )
  const visibleStart = Math.max(scrollTop, diffStart)
  const visibleEnd = Math.min(scrollTop + viewportHeight, diffStart + diffHeight)
  if (visibleEnd <= visibleStart) {
    return { start: 0, end: 0 }
  }
  const firstVisibleLine = Math.floor(
    ((visibleStart - diffStart) * lineScale) / CHANGE_FILE_DIFF_LINE_HEIGHT
  )
  const visibleLineCount = Math.ceil(
    ((visibleEnd - visibleStart) * lineScale) / CHANGE_FILE_DIFF_LINE_HEIGHT
  )
  const start = Math.max(0, Math.min(lineCount, firstVisibleLine - CHANGE_FILE_LINE_OVERSCAN))
  const end = Math.max(
    start,
    Math.min(lineCount, firstVisibleLine + visibleLineCount + CHANGE_FILE_LINE_OVERSCAN)
  )
  return { start, end }
}

export function getFileChangeId(change: FileChange): string {
  return normalizeFilePath(change.path).replace(/^(?:\.\/)+/, '')
}

export function formatFileChangePath(path: string, workspacePath: string | undefined): string {
  const normalizedPath = normalizeFilePath(path)
  const normalizedWorkspacePath = normalizeFilePath(workspacePath ?? '').replace(/\/$/, '')
  const workspaceDirectory = normalizedWorkspacePath.split('/').filter(Boolean).at(-1)
  if (!workspaceDirectory) {
    return normalizedPath.replace(/^\.\//, '')
  }

  if (normalizedPath.toLowerCase() === normalizedWorkspacePath.toLowerCase()) {
    return ''
  }

  const workspacePrefix = `${normalizedWorkspacePath}/`
  const isWorkspaceAbsolutePath = normalizedPath
    .toLowerCase()
    .startsWith(workspacePrefix.toLowerCase())
  if (!isWorkspaceAbsolutePath && /^(?:\/|[a-z]:\/)/i.test(normalizedPath)) {
    return normalizedPath
  }

  const relativePath = isWorkspaceAbsolutePath
    ? normalizedPath.slice(workspacePrefix.length)
    : normalizedPath.replace(/^\.\//, '')
  const workspaceDirectoryPrefix = `${workspaceDirectory}/`
  return relativePath.toLowerCase().startsWith(workspaceDirectoryPrefix.toLowerCase())
    ? relativePath.slice(workspaceDirectoryPrefix.length)
    : relativePath
}

function normalizeFilePath(path: string): string {
  return path.replace(/\\/g, '/')
}

export function getReviewDiff(change: FileChange | undefined): string | undefined {
  return change?.diff || change?.patch
}

export function formatAdditions(value: number | undefined): string {
  return `+${value ?? 0}`
}

export function formatDeletions(value: number | undefined): string {
  return `-${value ?? 0}`
}
