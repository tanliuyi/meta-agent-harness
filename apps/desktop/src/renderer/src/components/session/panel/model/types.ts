import type { Component } from 'vue'
import type { SessionTreeBranchEntryRow } from '@shared/coding-agent/types'

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

export type SessionTreeEntryView = SessionTreeBranchEntryRow

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
