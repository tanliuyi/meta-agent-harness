import { defineAsyncComponent } from 'vue'
import type { Component } from 'vue'
import type { SessionPanelTabId, SessionPanelTabRegistration } from '../model/types'

const sessionPanelTabRegistry = new Map<SessionPanelTabId, SessionPanelTabRegistration>()

export function registerSessionPanelTab(registration: SessionPanelTabRegistration): void {
  sessionPanelTabRegistry.set(registration.id, registration)
}

export function getSessionPanelTabRegistrations(): SessionPanelTabRegistration[] {
  return Array.from(sessionPanelTabRegistry.values())
}

export function getSessionPanelTabComponent(tabId: SessionPanelTabId): Component | undefined {
  return sessionPanelTabRegistry.get(tabId)?.component
}

registerSessionPanelTab({
  id: 'session',
  label: '会话',
  allowMultiple: false,
  component: defineAsyncComponent(() => import('../tabs/SessionOverviewTab.vue'))
})

registerSessionPanelTab({
  id: 'changes',
  label: '变更',
  allowMultiple: false,
  component: defineAsyncComponent(() => import('../tabs/ChangesTab.vue'))
})

registerSessionPanelTab({
  id: 'tree',
  label: '会话树',
  allowMultiple: false,
  component: defineAsyncComponent(() => import('../tabs/SessionTreeTab.vue'))
})

registerSessionPanelTab({
  id: 'commands',
  label: '命令',
  allowMultiple: false,
  component: defineAsyncComponent(() => import('../tabs/CommandsTab.vue'))
})

registerSessionPanelTab({
  id: 'extensions',
  label: '扩展',
  allowMultiple: false,
  component: defineAsyncComponent(() => import('../tabs/ExtensionsTab.vue'))
})

registerSessionPanelTab({
  id: 'approvals',
  label: '审批',
  allowMultiple: false,
  component: defineAsyncComponent(() => import('../tabs/ApprovalsTab.vue'))
})
