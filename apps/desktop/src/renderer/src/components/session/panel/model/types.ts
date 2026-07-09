import type { Component } from 'vue'
import type { SessionTreeViewMode } from '@shared/coding-agent/types'

export type OnOffValue = 'on' | 'off'
export type SessionTreeFilter = 'default' | 'all' | 'user' | 'labeled' | 'no-tools'
export type BuiltInSessionPanelTabId =
  'session' | 'changes' | 'tree' | 'commands' | 'extensions' | 'approvals'
export type ExtensionSessionPanelTabId = `extension:${string}`
export type SessionPanelTabId = BuiltInSessionPanelTabId | ExtensionSessionPanelTabId

export interface SessionPanelTab {
  id: SessionPanelTabId
  label: string
  allowMultiple: boolean
}

export interface SessionPanelTabRegistration extends SessionPanelTab {
  component: Component
}

export interface SessionPanelOpenTab extends SessionPanelTab {
  instanceId: string
}

export type SessionPanelTabCountMap = Partial<Record<SessionPanelTabId, number>>

export interface SessionTreeEntryView {
  id: string
  parentId: string | null
  type: string
  timestamp: string
  title: string
  summary?: string
  label?: string
  labelTimestamp?: string
  depth: number
  visualDepth: number
  childCount: number
  leaf: boolean
  branchPoint: boolean
  current: boolean
  hasMoreChildren?: boolean
}

export type SessionTreeDisplayRow =
  | {
      kind: 'entry'
      id: string
      depth: number
      visualDepth: number
      row: SessionTreeEntryView
    }
  | {
      kind: 'segment'
      id: string
      count: number
      depth: number
      visualDepth: number
    }

export const sessionTreeViewOptions: Array<{ label: string; value: SessionTreeViewMode }> = [
  { label: 'Branches', value: 'branches' },
  { label: 'Entries', value: 'entries' }
]

export const sessionTreeFilterOptions: Array<{ label: string; value: SessionTreeFilter }> = [
  { label: 'Default', value: 'default' },
  { label: 'All', value: 'all' },
  { label: 'User', value: 'user' },
  { label: 'Labeled', value: 'labeled' },
  { label: 'No tools', value: 'no-tools' }
]

export const onOffOptions: Array<{ label: string; value: OnOffValue }> = [
  { label: 'On', value: 'on' },
  { label: 'Off', value: 'off' }
]
