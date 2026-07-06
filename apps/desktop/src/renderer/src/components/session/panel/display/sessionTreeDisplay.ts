import type {
  SessionTreeBranchEntryRow,
  SessionTreeBranchSegmentRow
} from '@shared/coding-agent/types'
import type { SessionTreeDisplayRow, SessionTreeEntryView } from '../model/types'

export type TreeEntryMenuItem = {
  id: string
  label: string
  shortcut?: string
  disabled?: boolean
  danger?: boolean
}

export type TreeEntryMenuSection = {
  label?: string
  items: TreeEntryMenuItem[]
}

export function toBranchEntryDisplayRow(
  row: SessionTreeBranchEntryRow
): Extract<SessionTreeDisplayRow, { kind: 'entry' }> {
  return {
    kind: 'entry',
    id: row.id,
    depth: row.depth,
    visualDepth: row.visualDepth,
    row: {
      id: row.entryId,
      parentId: row.parentId,
      type: row.type,
      timestamp: row.timestamp,
      title: row.title,
      summary: row.summary,
      label: row.label,
      labelTimestamp: row.labelTimestamp,
      depth: row.depth,
      visualDepth: row.visualDepth,
      childCount: row.childCount,
      leaf: row.leaf,
      branchPoint: row.branchPoint,
      current: row.current
    }
  }
}

export function toTreeSegmentDisplayRow(row: SessionTreeBranchSegmentRow): SessionTreeDisplayRow {
  return {
    kind: 'segment',
    id: row.id,
    count: row.count,
    depth: row.depth,
    visualDepth: row.visualDepth
  }
}

export function canForkTreeEntry(entry: SessionTreeEntryView): boolean {
  return entry.type !== 'truncated'
}

export function canNavigateTreeEntry(entry: SessionTreeEntryView): boolean {
  return entry.type !== 'truncated'
}

export function getSessionTreeIndent(
  visualDepth: number,
  maxVisibleTreeDepth: number,
  treeIndentPx: number
): string {
  return `${Math.min(visualDepth, maxVisibleTreeDepth) * treeIndentPx}px`
}

export function isCompressedTreeDepth(visualDepth: number, maxVisibleTreeDepth: number): boolean {
  return visualDepth > maxVisibleTreeDepth
}

export function getNavigateTreeActionLabel(entry: SessionTreeEntryView): string {
  return entry.type === 'message' && entry.title.startsWith('user:') ? '从这里编辑' : '从这里继续'
}

export function getTreeEntryTitle(entry: SessionTreeEntryView): string {
  if (entry.label) {
    return entry.label
  }
  return entry.title.replace(/^(user|assistant|tool|toolResult):\s*/i, '').trim() || entry.title
}

export function getTreeEntryKindLabel(entry: SessionTreeEntryView): string {
  if (entry.type === 'message') {
    if (entry.title.startsWith('user:')) {
      return '用户'
    }
    if (entry.title.startsWith('assistant:')) {
      return '助手'
    }
    return '消息'
  }
  switch (entry.type) {
    case 'label':
      return '标签'
    case 'model_change':
      return '模型'
    case 'thinking_level_change':
      return 'Thinking'
    case 'compaction':
      return '压缩'
    case 'branch_summary':
      return '摘要'
    case 'custom_message':
      return '自定义消息'
    case 'custom':
      return '自定义'
    case 'truncated':
      return '未加载'
    default:
      return entry.type
  }
}

export function getTreeEntryTone(
  entry: SessionTreeEntryView,
  currentEntryId: string | null | undefined
): string {
  if (entry.current || entry.id === currentEntryId) {
    return 'current'
  }
  if (entry.label) {
    return 'labeled'
  }
  if (entry.type === 'message' && entry.title.startsWith('user:')) {
    return 'user'
  }
  if (entry.type === 'message' && entry.title.startsWith('assistant:')) {
    return 'assistant'
  }
  return 'default'
}

export function getTreeEntryMenuSections(entry: SessionTreeEntryView): TreeEntryMenuSection[] {
  return [
    {
      label: getTreeEntryTitle(entry),
      items: [
        {
          id: 'navigate',
          label: getNavigateTreeActionLabel(entry),
          disabled: !canNavigateTreeEntry(entry)
        },
        {
          id: 'fork',
          label: '创建分支会话',
          disabled: !canForkTreeEntry(entry)
        }
      ]
    },
    {
      items: [
        { id: 'label', label: entry.label ? '编辑标签' : '添加标签' },
        {
          id: 'clear-label',
          label: '清除标签',
          disabled: !entry.label
        },
        { id: 'copy-id', label: '复制 Entry ID' }
      ]
    }
  ]
}
