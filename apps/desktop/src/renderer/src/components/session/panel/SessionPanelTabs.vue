<script setup lang="ts">
import { computed, defineAsyncComponent, watch } from 'vue'
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
import { shouldRetainExtensionPanelContext } from './tabs/display/extensionPanelDisplay'

defineProps<{
  collapsed?: boolean
}>()

const workspaceSession = useWorkspaceSessionStore()
const { panelTabRequest } = useSessionContext()

const extensionPanelTabPrefix = 'extension:'
const ExtensionWebviewPanelTab = defineAsyncComponent(
  () => import('./tabs/ExtensionWebviewPanelTab.vue')
)

const sessionPanelTabs = computed(() => {
  const builtInTabs = getSessionPanelTabRegistrations()
  const extensionTabs = Object.values(workspaceSession.activeExtensionPanels)
    .slice()
    .sort(
      (left, right) =>
        (left.order ?? 0) - (right.order ?? 0) || left.title.localeCompare(right.title)
    )
    .map((panel) => ({
      id: `${extensionPanelTabPrefix}${panel.id}` as const,
      label: panel.title,
      allowMultiple: false
    }))
  return [...builtInTabs, ...extensionTabs]
})

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
const extensionDialogCount = computed(() => workspaceSession.activeExtensionDialogs.length)
const tabCounts = computed<SessionPanelTabCountMap>((previous) =>
  createStableSessionPanelTabCounts(
    {
      approvals: pendingApprovalsCount.value,
      changes: workspaceSession.activeSnapshot?.fileChanges.length ?? 0,
      commands: workspaceSession.activeCommandsLoaded
        ? workspaceSession.activeCommands.length
        : undefined,
      extensionStatuses: workspaceSession.activeExtensionStatuses,
      extensionDialogs: workspaceSession.activeExtensionDialogs.length,
      extensionNotifications: workspaceSession.activeExtensionNotifications.length,
      extensionTitle: workspaceSession.activeExtensionTitle,
      extensionWorking:
        Boolean(workspaceSession.activeExtensionWorkingMessage) ||
        workspaceSession.activeExtensionWorkingVisible === false ||
        Boolean(workspaceSession.activeExtensionWorkingIndicator),
      tree: workspaceSession.activeSnapshot?.sessionTree?.length ?? 0
    },
    previous
  )
)

const activeExtensionPanelId = computed(() => {
  const tabId = activeTabId.value
  return tabId?.startsWith(extensionPanelTabPrefix)
    ? tabId.slice(extensionPanelTabPrefix.length)
    : undefined
})
const activeExtensionPanel = computed(() =>
  activeExtensionPanelId.value
    ? workspaceSession.activeExtensionPanels[activeExtensionPanelId.value]
    : undefined
)
const shouldKeepActiveTabAlive = computed(
  () =>
    !activeExtensionPanelId.value || shouldRetainExtensionPanelContext(activeExtensionPanel.value)
)

const activeTabComponent = computed(() => {
  if (activeExtensionPanelId.value) {
    return ExtensionWebviewPanelTab
  }
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

watch(extensionDialogCount, (count, previousCount) => {
  if (count > previousCount) {
    markTabAttention('extensions')
  }
})

function handleCloseTab(tabInstanceId: string): void {
  const tab = openTabs.value.find((item) => item.instanceId === tabInstanceId)
  closeTab(tabInstanceId)
  if (!tab?.id.startsWith(extensionPanelTabPrefix) || !workspaceSession.activeSessionId) {
    return
  }
  workspaceSession.disposeExtensionPanel(
    workspaceSession.activeSessionId,
    tab.id.slice(extensionPanelTabPrefix.length)
  )
}
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
      @close="handleCloseTab"
      @open-add-panel="openAddPanel"
      @select="selectOpenTab"
    />
    <slot name="actions" />
  </header>

  <div v-show="!collapsed" class="session-panel__body">
    <ScrollArea v-if="isAddPanelActive" class="session-panel__tab-picker-scroll">
      <div class="session-panel__tab-picker" role="tabpanel">
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
    </ScrollArea>
    <KeepAlive>
      <component
        :is="activeTabComponent"
        v-if="!collapsed && !isAddPanelActive && activeTabComponent && shouldKeepActiveTabAlive"
        :key="activeTabKey"
        :panel-id="activeExtensionPanelId"
      />
    </KeepAlive>
    <component
      :is="activeTabComponent"
      v-if="!collapsed && !isAddPanelActive && activeTabComponent && !shouldKeepActiveTabAlive"
      :key="activeTabKey"
      :panel-id="activeExtensionPanelId"
    />
  </div>
</template>
