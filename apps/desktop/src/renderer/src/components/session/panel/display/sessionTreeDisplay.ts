import type { Component } from 'vue'
import { Copy, CornerDownRight, Eraser, GitFork, Tag } from 'lucide-vue-next'
import type { SessionTreeEntryView } from '../model/types'

export type TreeEntryMenuItem = {
  id: string
  label: string
  shortcut?: string
  icon?: Component
  disabled?: boolean
  danger?: boolean
}

export type TreeEntryMenuSection = {
  label?: string
  items: TreeEntryMenuItem[]
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
      return '我'
    }
    if (entry.title.startsWith('assistant:')) {
      return 'AI'
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
          icon: CornerDownRight,
          disabled: !canNavigateTreeEntry(entry)
        },
        {
          id: 'fork',
          label: '创建分支会话',
          icon: GitFork,
          disabled: !canForkTreeEntry(entry)
        }
      ]
    },
    {
      items: [
        { id: 'label', label: entry.label ? '编辑标签' : '添加标签', icon: Tag },
        {
          id: 'clear-label',
          label: '清除标签',
          icon: Eraser,
          disabled: !entry.label
        },
        { id: 'copy-id', label: '复制 Entry ID', icon: Copy }
      ]
    }
  ]
}
