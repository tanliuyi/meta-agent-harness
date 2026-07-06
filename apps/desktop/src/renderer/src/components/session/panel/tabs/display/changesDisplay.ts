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

export function countFileChangeStats(fileChanges: FileChange[]): FileChangeStats {
  let additions = 0
  let deletions = 0
  for (const change of fileChanges) {
    additions += change.additions ?? 0
    deletions += change.deletions ?? 0
  }
  return { additions, deletions }
}

export function getFileChangeId(change: FileChange): string {
  return `${change.toolCallId ?? change.createdAt}:${change.path}`
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
