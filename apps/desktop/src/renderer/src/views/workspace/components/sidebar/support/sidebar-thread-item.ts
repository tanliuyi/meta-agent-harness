import type { Component } from 'vue'
import type { WorkspaceSession } from '@renderer/stores/workspace-session'
import type { ThreadSnapshot } from '@shared/coding-agent/types'
import { Archive, Copy, GitBranch, LocateFixed, Pencil } from '@lucide/vue'

type SessionTreeNode = NonNullable<ThreadSnapshot['sessionTree']>[number]

export type ThreadMenuActionId =
  'copy-id' | 'rename' | 'open-parent' | 'locate-current-leaf' | 'archive'

export interface ThreadMenuItem {
  id: ThreadMenuActionId
  label: string
  icon?: Component
  disabled?: boolean
  danger?: boolean
}

export interface ThreadMenuSection {
  label?: string
  items: ThreadMenuItem[]
}

export interface ThreadLeafShortcut {
  id: string
  label: string
  meta: string
}

export function isThreadMenuActionId(actionId: string): actionId is ThreadMenuActionId {
  return (
    actionId === 'copy-id' ||
    actionId === 'rename' ||
    actionId === 'open-parent' ||
    actionId === 'locate-current-leaf' ||
    actionId === 'archive'
  )
}

export function getThreadStatusIndicator(
  status: WorkspaceSession['status']
): 'running' | 'error' | undefined {
  if (status === 'running' || status === 'error') {
    return status
  }

  return undefined
}

export function getThreadStatusLabel(status: WorkspaceSession['status']): string | undefined {
  const indicator = getThreadStatusIndicator(status)
  return indicator === undefined ? undefined : indicator === 'running' ? '运行中' : '错误'
}

export function getThreadMenuSections(thread: WorkspaceSession): ThreadMenuSection[] {
  const lineage = thread.snapshot?.lineage ?? thread.lineage
  const currentEntryId = thread.snapshot?.currentEntryId
  return [
    {
      items: [
        { id: 'copy-id', label: '复制 Thread ID', icon: Copy },
        { id: 'rename', label: '重命名会话', icon: Pencil },
        {
          id: 'open-parent',
          label: '打开来源对话',
          icon: GitBranch,
          disabled: !lineage || lineage.parentSessionMissing || lineage.unavailable
        },
        {
          id: 'locate-current-leaf',
          label: '在 Tree 中定位当前 leaf',
          icon: LocateFixed,
          disabled: !currentEntryId
        }
      ]
    },
    {
      items: [{ id: 'archive', label: '归档会话', icon: Archive, danger: true }]
    }
  ]
}

export function getThreadLineageLabel(thread: WorkspaceSession): string | undefined {
  const lineage = thread.snapshot?.lineage ?? thread.lineage
  if (!lineage) {
    return undefined
  }
  if (lineage.unavailable) {
    return 'Fork source unavailable'
  }
  if (lineage.parentThreadTitle) {
    return `Forked from ${lineage.parentThreadTitle}${lineage.parentThreadArchivedAt ? ' (archived)' : ''}`
  }
  if (lineage.parentSessionFile) {
    return lineage.parentSessionMissing
      ? 'Fork source missing'
      : `Forked from ${getFileName(lineage.parentSessionFile)}`
  }
  return undefined
}

export function getThreadLeafShortcuts(thread: WorkspaceSession): ThreadLeafShortcut[] {
  const snapshot = thread.snapshot
  if (!snapshot?.sessionTree?.length) {
    return []
  }
  const labeledNodes = collectSessionTreeNodes(snapshot.sessionTree)
    .filter((node) => node.label && node.id !== snapshot.currentEntryId)
    .slice(0, 3)
  return labeledNodes.map((node) => ({
    id: node.id,
    label: node.label || node.title,
    meta: 'Labeled'
  }))
}

export function formatUpdatedAtDistance(updatedAt: string, now: number): string | undefined {
  const updatedAtTime = Date.parse(updatedAt)

  if (Number.isNaN(updatedAtTime)) {
    return undefined
  }

  const minutes = Math.max(1, Math.floor((now - updatedAtTime) / 60_000))

  if (minutes >= 60 * 24) {
    return `${Math.floor(minutes / (60 * 24))} 天`
  }

  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)} 小时`
  }

  return `${minutes} 分`
}

function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath
}

function collectSessionTreeNodes(nodes: SessionTreeNode[]): SessionTreeNode[] {
  const result: SessionTreeNode[] = []
  const stack = [...nodes]
  while (stack.length > 0) {
    const node = stack.shift()!
    result.push(node)
    stack.unshift(...node.children)
  }
  return result
}
