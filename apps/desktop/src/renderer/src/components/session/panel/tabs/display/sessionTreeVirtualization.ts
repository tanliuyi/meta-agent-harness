export const SESSION_TREE_COMPACT_ROW_SIZE_PX = 32
export const SESSION_TREE_SUMMARY_ROW_SIZE_PX = 48

type SessionTreeVirtualEntry = {
  id: string
  summary?: string
}

export interface SessionTreeEndFollowState {
  shouldFollow: boolean
  userScrollLocked: boolean
}

/**
 * Estimate the two stable Tree row layouts before ResizeObserver measures them.
 */
export function estimateSessionTreeRowSize(entry: SessionTreeVirtualEntry | undefined): number {
  return entry?.summary ? SESSION_TREE_SUMMARY_ROW_SIZE_PX : SESSION_TREE_COMPACT_ROW_SIZE_PX
}

/**
 * Resolve end following without allowing a locked user scroll to be reclaimed.
 */
export function resolveSessionTreeEndFollowState(
  distanceToEnd: number,
  userScrollLocked: boolean,
  nearEndDistance: number,
  stickyEndDistance: number
): SessionTreeEndFollowState {
  if (distanceToEnd <= stickyEndDistance) {
    return { shouldFollow: true, userScrollLocked: false }
  }
  if (userScrollLocked) {
    return { shouldFollow: false, userScrollLocked: true }
  }
  return {
    shouldFollow: distanceToEnd < nearEndDistance,
    userScrollLocked: false
  }
}

/**
 * Keep TanStack measurements scoped to a session and row layout.
 */
export function getSessionTreeVirtualItemKey(
  sessionId: string | undefined,
  entry: SessionTreeVirtualEntry | undefined,
  index: number
): string {
  const sessionKey = sessionId ?? 'draft'
  const entryKey = entry?.id ?? index
  const layoutKey = entry?.summary ? 'summary' : 'compact'
  return `${sessionKey}:${entryKey}:${layoutKey}`
}
