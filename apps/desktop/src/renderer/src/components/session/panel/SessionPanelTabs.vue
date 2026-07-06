<script setup lang="ts">
import { computed, watch } from 'vue'
import ScrollArea from '@renderer/components/ui/scroll-area/ScrollArea.vue'
import { useSessionContext } from '@renderer/composables/useSessionContext'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import SessionPanelTabBar from './SessionPanelTabBar.vue'
import type { SessionPanelTabCountMap } from './model/types'
import { countRecordKeys, createStableSessionPanelTabCounts } from './state/sessionPanelCounts'
import {
  getSessionPanelTabComponent,
  getSessionPanelTabRegistrations
} from './state/sessionPanelTabRegistry'
import { useSessionPanelTabsState } from './state/useSessionPanelTabsState'

defineProps<{
  collapsed?: boolean
}>()

const workspaceSession = useWorkspaceSessionStore()
const { panelTabRequest } = useSessionContext()

const sessionPanelTabs = getSessionPanelTabRegistrations()

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
} = useSessionPanelTabsState(
  sessionPanelTabs,
  computed(() => workspaceSession.activeSessionId)
)

const pendingApprovalsCount = computed(() =>
  countRecordKeys(workspaceSession.activePendingApprovals)
)
const extensionUiRequestCount = computed(() =>
  countRecordKeys(workspaceSession.activeExtensionUiRequests)
)
const tabCounts = computed<SessionPanelTabCountMap>((previous) =>
  createStableSessionPanelTabCounts(
    {
      approvals: pendingApprovalsCount.value,
      changes: workspaceSession.activeSnapshot?.fileChanges.length ?? 0,
      commands: workspaceSession.activeCommandsLoaded
        ? workspaceSession.activeCommands.length
        : undefined,
      extensionStatuses: workspaceSession.activeExtensionStatuses,
      extensionUiRequests: workspaceSession.activeExtensionUiRequests,
      extensionWidgets: workspaceSession.activeExtensionWidgets,
      tree: workspaceSession.activeSnapshot?.sessionTree?.length ?? 0
    },
    previous
  )
)

const activeTabComponent = computed(() => {
  return activeTabId.value ? getSessionPanelTabComponent(activeTabId.value) : undefined
})

const activeTabKey = computed(() => {
  const sessionId = workspaceSession.activeSessionId ?? '__orphan__'
  return `${sessionId}:${activeTabInstanceId.value}`
})

watch(
  panelTabRequest,
  (request) => {
    if (request) {
      selectTab(request.tabId)
    }
  },
  { immediate: true }
)

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

watch(pendingApprovalsCount, (count, previousCount) => {
  if (count > previousCount) {
    markTabAttention('approvals')
  }
})

watch(extensionUiRequestCount, (count, previousCount) => {
  if (count > previousCount) {
    markTabAttention('extensions')
  }
})
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
