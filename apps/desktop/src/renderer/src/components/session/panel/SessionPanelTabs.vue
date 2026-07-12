<script setup lang="ts">
import { computed, defineAsyncComponent, reactive, watch } from 'vue'
import ScrollArea from '@renderer/components/ui/scroll-area/ScrollArea.vue'
import { useSessionContext } from '@renderer/composables/useSessionContext'
import { useAppStore } from '@renderer/stores/app'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import SessionPanelTabBar from './SessionPanelTabBar.vue'
import type { ExtensionSessionPanelTabId, SessionPanelTabCountMap } from './model/types'
import { countRecordKeys, createStableSessionPanelTabCounts } from './state/sessionPanelCounts'
import {
  getSessionPanelTabComponent,
  getSessionPanelTabRegistrations
} from './state/sessionPanelTabRegistry'
import { useSessionPanelTabsState } from './state/useSessionPanelTabsState'
import { shouldRetainExtensionPanelContext } from './tabs/display/extensionPanelDisplay'
import { getBrowserSessionScope } from './tabs/state/browserPreviewTabs'
import {
  reconcileBrowserSessionInstances,
  type BrowserSessionInstance
} from './tabs/state/browserSessionInstances'

const props = defineProps<{
  collapsed?: boolean
}>()

const app = useAppStore()
const workspaceSession = useWorkspaceSessionStore()
const { panelTabRequest } = useSessionContext()

const extensionPanelTabPrefix = 'extension:'
const ExtensionWebviewPanelTab = defineAsyncComponent(
  () => import('./tabs/ExtensionWebviewPanelTab.vue')
)
const BrowserPreviewPanelTab = defineAsyncComponent(
  () => import('./tabs/BrowserPreviewPanelTab.vue')
)
const MemoryPanelTab = defineAsyncComponent(
  () => import('@renderer/views/settings/memory/MemorySettingsView.vue')
)

const sessionPanelTabs = computed(() => {
  const builtInTabs = getSessionPanelTabRegistrations()
  const extensionTabs = Object.values(workspaceSession.activeExtensionPanels)
    .filter(
      (panel) =>
        panel.source.type !== 'native' ||
        panel.source.component === 'browser-preview' ||
        panel.source.component === 'memory'
    )
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
  computed(() => workspaceSession.activeSessionPanelTabsKey)
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
const isNativeMemoryPanelActive = computed(
  () =>
    activeExtensionPanel.value?.source.type === 'native' &&
    activeExtensionPanel.value.source.component === 'memory'
)
const persistentBrowserPanelId = computed(
  () =>
    Object.values(workspaceSession.activeExtensionPanels).find(
      (panel) =>
        panel.source.type === 'native' &&
        panel.source.component === 'browser-preview' &&
        panel.retainContextWhenHidden
    )?.id
)
const isPersistentBrowserPanelActive = computed(
  () =>
    Boolean(persistentBrowserPanelId.value) &&
    activeExtensionPanelId.value === persistentBrowserPanelId.value
)

const browserSessionInstances = reactive<BrowserSessionInstance[]>([])
const busyBrowserSessionScopes = reactive(new Set<string>())
let browserSessionAccessSequence = 0
const activeBrowserSessionScope = computed(() =>
  getBrowserSessionScope(
    workspaceSession.activeSessionPanelTabsKey,
    workspaceSession.activeSessionId
  )
)

watch(
  () => ({
    active: isPersistentBrowserPanelActive.value,
    activeScope: activeBrowserSessionScope.value,
    activeThreadId: workspaceSession.activeSessionId,
    runtimeThreadIds: Object.keys(workspaceSession.runtimeByThreadId),
    sessionThreadIds: Object.keys(workspaceSession.sessions),
    busyScopes: [...busyBrowserSessionScopes],
    threadIdsWithBrowserMessages: Object.entries(workspaceSession.runtimeByThreadId)
      .filter(([, runtime]) => {
        const entry = runtime.extensionPanelMessages['browser-preview']
        return Boolean(entry && (entry.messages ? entry.messages.length > 0 : true))
      })
      .map(([threadId]) => threadId)
  }),
  ({
    active,
    activeScope,
    activeThreadId,
    runtimeThreadIds,
    sessionThreadIds,
    busyScopes,
    threadIdsWithBrowserMessages
  }) => {
    const now = ++browserSessionAccessSequence
    const validThreadIds = [...new Set([...sessionThreadIds, ...runtimeThreadIds])]
    const toInstance = (threadId: string, lastUsedAt = 0): BrowserSessionInstance => ({
      lastUsedAt,
      scope: getBrowserSessionScope(threadId, threadId),
      threadId
    })
    const nextInstances = reconcileBrowserSessionInstances(browserSessionInstances, {
      activeInstance: active
        ? {
            lastUsedAt: now,
            scope: activeScope,
            ...(activeThreadId ? { threadId: activeThreadId } : {})
          }
        : undefined,
      activeScope,
      busyScopes,
      currentDraftScope: activeThreadId ? undefined : activeScope,
      now,
      requiredThreadInstances: threadIdsWithBrowserMessages.map((threadId) =>
        toInstance(threadId, now)
      ),
      validThreadInstances: validThreadIds.map(toInstance)
    })
    browserSessionInstances.splice(0, browserSessionInstances.length, ...nextInstances)
  },
  { flush: 'sync', immediate: true }
)

const shouldKeepActiveTabAlive = computed(() => {
  if (!activeExtensionPanelId.value) return true
  return shouldRetainExtensionPanelContext(activeExtensionPanel.value)
})

const isPersistentBrowserPanelVisible = computed(
  () => !props.collapsed && !isAddPanelActive.value && isPersistentBrowserPanelActive.value
)

const activeTabComponent = computed(() => {
  if (isPersistentBrowserPanelActive.value) return undefined
  if (activeExtensionPanel.value?.source.type === 'native') {
    return activeExtensionPanel.value.source.component === 'memory' ? MemoryPanelTab : undefined
  }
  if (activeExtensionPanelId.value) return ExtensionWebviewPanelTab
  return activeTabId.value ? getSessionPanelTabComponent(activeTabId.value) : undefined
})

const activeTabKey = computed(
  () => `${workspaceSession.activeSessionPanelTabsKey}:${activeTabInstanceId.value}`
)

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

watch(
  () => [workspaceSession.activeSessionPanelTabsKey, activeTabId.value, props.collapsed] as const,
  ([, tabId, collapsed]) => {
    if (tabId && !collapsed) clearTabAttention(tabId)
  }
)

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

function handleBrowserAttention(threadId: string): void {
  const panelId = persistentBrowserPanelId.value
  if (!panelId) return
  markTabAttention(
    `${extensionPanelTabPrefix}${panelId}` as ExtensionSessionPanelTabId,
    threadId,
    props.collapsed || threadId !== workspaceSession.activeSessionId
  )
}

function handleBrowserBusyChange(scope: string, busy: boolean): void {
  if (busy) busyBrowserSessionScopes.add(scope)
  else busyBrowserSessionScopes.delete(scope)
}

function handleCloseTab(tabInstanceId: string): void {
  const tab = openTabs.value.find((item) => item.instanceId === tabInstanceId)
  closeTab(tabInstanceId)
  if (!tab?.id.startsWith(extensionPanelTabPrefix) || !workspaceSession.activeSessionId) {
    return
  }
  const panelId = tab.id.slice(extensionPanelTabPrefix.length)
  const panel = workspaceSession.activeExtensionPanels[panelId]
  if (panel?.source.type === 'native' && panel.source.component === 'browser-preview') {
    return
  }
  workspaceSession.disposeExtensionPanel(workspaceSession.activeSessionId, panelId)
}
</script>

<template>
  <header class="session-panel__header" :class="{ 'session-panel__header--darwin': app.isMac }">
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
    <slot name="actions" :has-attention="attentionTabIds.length > 0" />
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
    <template v-if="persistentBrowserPanelId">
      <BrowserPreviewPanelTab
        v-for="instance in browserSessionInstances"
        v-show="
          !isAddPanelActive &&
          isPersistentBrowserPanelActive &&
          instance.scope === activeBrowserSessionScope
        "
        :key="instance.scope"
        :panel-id="persistentBrowserPanelId"
        :session-scope="instance.scope"
        :thread-id="instance.threadId"
        :visible="isPersistentBrowserPanelVisible && instance.scope === activeBrowserSessionScope"
        @attention="handleBrowserAttention"
        @busy-change="handleBrowserBusyChange(instance.scope, $event)"
      />
    </template>
    <KeepAlive>
      <component
        :is="activeTabComponent"
        v-if="!collapsed && !isAddPanelActive && activeTabComponent && shouldKeepActiveTabAlive"
        :key="activeTabKey"
        :compact="isNativeMemoryPanelActive"
        :panel-id="activeExtensionPanelId"
      />
    </KeepAlive>
    <component
      :is="activeTabComponent"
      v-if="!collapsed && !isAddPanelActive && activeTabComponent && !shouldKeepActiveTabAlive"
      :key="activeTabKey"
      :compact="isNativeMemoryPanelActive"
      :panel-id="activeExtensionPanelId"
    />
  </div>
</template>
