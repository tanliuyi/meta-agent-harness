import type { ThreadSortMode } from '@renderer/composables/useWorkspaceViewSettings'
import type { WorkspaceSession } from '@renderer/stores/workspace-session'

export interface ProjectThreadItem {
  thread: WorkspaceSession
  depth: number
}

export interface ProjectExpansion {
  displayCount: number
  hasExpanded: boolean
}

export function getExpandedProjectThreadCount(
  expansion: ProjectExpansion,
  totalCount: number,
  increment = 10
): number {
  const remaining = totalCount - expansion.displayCount
  return expansion.displayCount + Math.min(increment, remaining)
}

export function getExpandButtonText(totalCount: number, displayCount: number): string {
  const remaining = totalCount - displayCount
  if (remaining >= 10) {
    return `展开 10 条 (${remaining} 条)`
  }
  if (remaining > 0) {
    return `展开 ${remaining} 条`
  }
  return ''
}

export function getProjectThreads(
  threads: WorkspaceSession[],
  sortMode: ThreadSortMode
): ProjectThreadItem[] {
  if (sortMode === 'recent') {
    return threads.map((thread) => ({ thread, depth: 0 }))
  }
  return getThreadedProjectThreads(threads)
}

function getThreadedProjectThreads(threads: WorkspaceSession[]): ProjectThreadItem[] {
  const childrenByParentId = new Map<string, WorkspaceSession[]>()
  const threadIds = new Set(threads.map((thread) => thread.threadId))
  for (const thread of threads) {
    const parentThreadId = (thread.snapshot?.lineage ?? thread.lineage)?.parentThreadId
    if (!parentThreadId || !threadIds.has(parentThreadId)) {
      continue
    }
    childrenByParentId.set(parentThreadId, [
      ...(childrenByParentId.get(parentThreadId) ?? []),
      thread
    ])
  }
  const ordered: ProjectThreadItem[] = []
  const visited = new Set<string>()
  const appendThread = (thread: WorkspaceSession, depth: number): void => {
    if (visited.has(thread.threadId)) {
      return
    }
    visited.add(thread.threadId)
    ordered.push({ thread, depth })
    for (const child of childrenByParentId.get(thread.threadId) ?? []) {
      appendThread(child, depth + 1)
    }
  }
  for (const thread of threads) {
    const parentThreadId = (thread.snapshot?.lineage ?? thread.lineage)?.parentThreadId
    if (!parentThreadId || !threadIds.has(parentThreadId)) {
      appendThread(thread, 0)
    }
  }
  for (const thread of threads) {
    appendThread(thread, 0)
  }
  return ordered
}
