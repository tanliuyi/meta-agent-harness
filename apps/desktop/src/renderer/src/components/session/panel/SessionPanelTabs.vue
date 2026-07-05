<script setup lang="ts">
import { computed, defineAsyncComponent, watch } from 'vue'
import type { Component } from 'vue'
import ScrollArea from '@renderer/components/ui/scroll-area/ScrollArea.vue'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import SessionPanelTabBar from './SessionPanelTabBar.vue'
import type { SessionPanelTab, SessionPanelTabCountMap, SessionPanelTabId } from './types'
import { useSessionPanelTabsState } from './useSessionPanelTabsState'

defineProps<{
  collapsed?: boolean
}>()

const workspaceSession = useWorkspaceSessionStore()

const sessionPanelTabs: SessionPanelTab[] = [
  { id: 'session', label: 'Session' },
  { id: 'changes', label: 'Changes' },
  { id: 'tree', label: 'Tree' },
  { id: 'commands', label: 'Commands' },
  { id: 'extensions', label: 'Extensions' },
  { id: 'approvals', label: 'Approvals' }
]

const tabComponentMap = {
  approvals: defineAsyncComponent(() => import('./tabs/ApprovalsTab.vue')),
  changes: defineAsyncComponent(() => import('./tabs/ChangesTab.vue')),
  commands: defineAsyncComponent(() => import('./tabs/CommandsTab.vue')),
  extensions: defineAsyncComponent(() => import('./tabs/ExtensionsTab.vue')),
  session: defineAsyncComponent(() => import('./tabs/SessionOverviewTab.vue')),
  tree: defineAsyncComponent(() => import('./tabs/SessionTreeTab.vue'))
} satisfies Record<SessionPanelTabId, Component>

const {
  activeTabInstanceId,
  activeTabId,
  attentionTabIds,
  availableTabs,
  clearTabAttention,
  closeTab,
  isAddPanelActive,
  markTabAttention,
  openAddPanel,
  openTab,
  openTabs,
  selectOpenTab,
  selectTab
} = useSessionPanelTabsState(sessionPanelTabs, computed(() => workspaceSession.activeSessionId))

const pendingApprovalsCount = computed(
  () => Object.keys(workspaceSession.activePendingApprovals).length
)
const extensionUiRequestCount = computed(
  () => Object.keys(workspaceSession.activeExtensionUiRequests).length
)
const extensionStatusCount = computed(
  () => Object.values(workspaceSession.activeExtensionStatuses).filter(Boolean).length
)
const extensionWidgetCount = computed(
  () => Object.keys(workspaceSession.activeExtensionWidgets).length
)
const sessionTreeEntryCount = computed(
  () => workspaceSession.activeSnapshot?.sessionTree?.length ?? 0
)

const tabCounts = computed<SessionPanelTabCountMap>(() => ({
  approvals: pendingApprovalsCount.value,
  changes: workspaceSession.activeSnapshot?.fileChanges.length ?? 0,
  commands: workspaceSession.activeCommandsLoaded
    ? workspaceSession.activeCommands.length
    : undefined,
  extensions:
    extensionUiRequestCount.value + extensionStatusCount.value + extensionWidgetCount.value,
  tree: sessionTreeEntryCount.value
}))

const activeTabComponent = computed(() => {
  return activeTabId.value ? tabComponentMap[activeTabId.value] : undefined
})

const activeTabKey = computed(() => {
  const sessionId = workspaceSession.activeSessionId ?? '__orphan__'
  return `${sessionId}:${activeTabInstanceId.value}`
})

watch(
  () => workspaceSession.treeFocusRequest,
  (request) => {
    if (request) {
      selectTab('tree')
    }
  }
)

watch(activeTabId, (tabId) => {
  if (tabId) {
    clearTabAttention(tabId)
  }
})

watch(
  pendingApprovalsCount,
  (count, previousCount) => {
    if (count > previousCount) {
      markTabAttention('approvals')
    }
  }
)

watch(
  extensionUiRequestCount,
  (count, previousCount) => {
    if (count > previousCount) {
      markTabAttention('extensions')
    }
  }
)
</script>

<template>
  <header class="session-panel__header">
    <SessionPanelTabBar
      :active-tab-instance-id="activeTabInstanceId"
      :attention-tab-ids="attentionTabIds"
      :collapsed="collapsed"
      :counts="tabCounts"
      :is-add-panel-active="isAddPanelActive"
      :open-tabs="openTabs"
      @close="closeTab"
      @open-add-panel="openAddPanel"
      @select="selectOpenTab"
    />
    <slot name="actions" />
  </header>

  <div v-if="!collapsed" class="session-panel__body">
    <ScrollArea class="session-panel__scroll">
      <div v-if="isAddPanelActive" class="session-panel__tab-picker" role="tabpanel">
        <button
          v-for="tab in availableTabs"
          :key="tab.id"
          type="button"
          class="session-panel__tab-picker-item"
          @click="openTab(tab.id)"
        >
          <span>{{ tab.label }}</span>
          <small v-if="tabCounts[tab.id]">{{ tabCounts[tab.id] }}</small>
        </button>
      </div>
      <KeepAlive v-else-if="activeTabComponent">
        <component :is="activeTabComponent" :key="activeTabKey" />
      </KeepAlive>
    </ScrollArea>
  </div>
</template>
