import type { SessionPanelTabCountMap } from '../model/types'

export interface SessionPanelTabCountInput {
  approvals: number
  changes: number
  commands?: number
  extensionStatuses: Record<string, string | undefined>
  extensionUiRequests: Record<string, unknown>
  extensionWidgets: Record<string, unknown>
  tree: number
}

export function createStableSessionPanelTabCounts(
  input: SessionPanelTabCountInput,
  previous?: SessionPanelTabCountMap
): SessionPanelTabCountMap {
  const next: SessionPanelTabCountMap = {
    approvals: input.approvals,
    changes: input.changes,
    commands: input.commands,
    extensions:
      countRecordKeys(input.extensionUiRequests) +
      countTruthyRecordValues(input.extensionStatuses) +
      countRecordKeys(input.extensionWidgets),
    tree: input.tree
  }

  if (previous && isSameSessionPanelTabCountMap(previous, next)) {
    return previous
  }

  return next
}

export function countRecordKeys(value: Record<string, unknown>): number {
  return Object.keys(value).length
}

export function countTruthyRecordValues(value: Record<string, unknown>): number {
  return Object.values(value).filter(Boolean).length
}

function isSameSessionPanelTabCountMap(
  left: SessionPanelTabCountMap,
  right: SessionPanelTabCountMap
): boolean {
  return (
    left.session === right.session &&
    left.changes === right.changes &&
    left.tree === right.tree &&
    left.commands === right.commands &&
    left.extensions === right.extensions &&
    left.approvals === right.approvals
  )
}
