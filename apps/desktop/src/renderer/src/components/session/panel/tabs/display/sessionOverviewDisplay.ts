import type { BaseDropdownMenuSection } from '@renderer/components/base/BaseDropdownMenu.vue'
import type { ThreadSnapshot } from '@shared/coding-agent/types'
import { getFileName } from '../../shared/utils'

export function getSessionLineageLabel(
  lineage: ThreadSnapshot['lineage'] | undefined
): string | undefined {
  if (!lineage) {
    return undefined
  }
  if (lineage.unavailable) {
    return 'Fork source unavailable'
  }
  if (lineage.parentThreadTitle) {
    return lineage.parentThreadArchivedAt
      ? `${lineage.parentThreadTitle} (archived)`
      : lineage.parentThreadTitle
  }
  if (lineage.parentSessionFile) {
    return lineage.parentSessionMissing
      ? 'Fork source missing'
      : getFileName(lineage.parentSessionFile)
  }
  return undefined
}

export function getSessionModelLabel(model: ThreadSnapshot['model'] | undefined): string {
  if (!model) {
    return '-'
  }
  return model.displayName || `${model.provider}/${model.id}`
}

export function createSessionActionMenuSections(
  hasActiveThread: boolean,
  hasCurrentEntry: boolean,
  previous?: BaseDropdownMenuSection[]
): BaseDropdownMenuSection[] {
  if (
    previous &&
    previous[0]?.items[0]?.disabled === !hasActiveThread &&
    previous[1]?.items[0]?.disabled === !hasActiveThread &&
    previous[1]?.items[2]?.disabled === (!hasActiveThread || !hasCurrentEntry)
  ) {
    return previous
  }

  return [
    {
      items: [
        { id: 'export', label: 'Export', disabled: !hasActiveThread },
        { id: 'import', label: 'Import', disabled: !hasActiveThread },
        { id: 'switch', label: 'Switch file', disabled: !hasActiveThread }
      ]
    },
    {
      items: [
        { id: 'clone', label: 'Clone', disabled: !hasActiveThread },
        { id: 'new', label: 'New session', disabled: !hasActiveThread },
        {
          id: 'fork',
          label: '创建分支会话',
          disabled: !hasActiveThread || !hasCurrentEntry
        }
      ]
    }
  ]
}

export function formatRetryDelay(delayMs: number): string {
  if (delayMs < 1000) {
    return `${delayMs}ms`
  }
  return `${Math.round(delayMs / 1000)}s`
}
