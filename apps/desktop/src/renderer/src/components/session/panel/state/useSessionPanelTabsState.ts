import { computed, reactive, watch, type Ref } from 'vue'
import type { SessionPanelOpenTab, SessionPanelTab, SessionPanelTabId } from '../model/types'

const SESSION_PANEL_TABS_STORAGE_KEY = 'meta-agent.session-panel.tabs.v2'
const SESSION_PANEL_ACTIVE_TAB_STORAGE_KEY = 'meta-agent.session-panel.active-tab.v2'
const ORPHAN_SESSION_PANEL_TABS_KEY = '__orphan__'
const ADD_TAB_INSTANCE_ID = '__add-tab__'

interface SessionPanelTabsState {
  activeTabInstanceId: string
  attentionTabIds: SessionPanelTabId[]
  nextTabInstanceIndex: number
  openTabs: SessionPanelOpenTab[]
}

export function useSessionPanelTabsState(
  sessionPanelTabs: SessionPanelTab[],
  sessionKey: Ref<string | undefined>
) {
  const stateBySessionKey = reactive<Record<string, SessionPanelTabsState>>({})
  const orphanState = ensureState(ORPHAN_SESSION_PANEL_TABS_KEY)

  const activeStateKey = computed(() => sessionKey.value || ORPHAN_SESSION_PANEL_TABS_KEY)
  watch(activeStateKey, (key) => ensureState(key), { flush: 'sync', immediate: true })
  const activeState = computed(() => stateBySessionKey[activeStateKey.value] ?? orphanState)

  const activeTabInstanceId = computed(() => activeState.value.activeTabInstanceId)
  const activeOpenTab = computed(() =>
    activeState.value.openTabs.find(
      (tab) => tab.instanceId === activeState.value.activeTabInstanceId
    )
  )
  const activeTabId = computed(() => activeOpenTab.value?.id)
  const isAddPanelActive = computed(
    () => activeState.value.activeTabInstanceId === ADD_TAB_INSTANCE_ID
  )
  const attentionTabIds = computed(() => activeState.value.attentionTabIds)
  const openTabs = computed(() => activeState.value.openTabs)
  const availableTabs = computed(() =>
    sessionPanelTabs.filter(
      (tab) =>
        tab.allowMultiple || !activeState.value.openTabs.some((openTab) => openTab.id === tab.id)
    )
  )

  function ensureState(key: string): SessionPanelTabsState {
    stateBySessionKey[key] ??= createState(key)
    return stateBySessionKey[key]
  }

  function createState(key: string): SessionPanelTabsState {
    const openTabs = readStoredTabs(key) ?? [createOpenTab('session', 1)]
    const nextTabInstanceIndex = getNextTabInstanceIndex(openTabs)
    const activeTabInstanceId = readStoredTab(key) ?? openTabs[0]?.instanceId ?? ADD_TAB_INSTANCE_ID
    return {
      activeTabInstanceId: isKnownTabInstance(activeTabInstanceId, openTabs)
        ? activeTabInstanceId
        : (openTabs[0]?.instanceId ?? ADD_TAB_INSTANCE_ID),
      attentionTabIds: [],
      nextTabInstanceIndex,
      openTabs
    }
  }

  function readStoredTab(key: string): string | undefined {
    const value = window.localStorage.getItem(
      getStorageKey(SESSION_PANEL_ACTIVE_TAB_STORAGE_KEY, key)
    )
    return value || undefined
  }

  function readStoredTabs(key: string): SessionPanelOpenTab[] | undefined {
    const value = window.localStorage.getItem(getStorageKey(SESSION_PANEL_TABS_STORAGE_KEY, key))
    if (!value) {
      return undefined
    }

    try {
      const parsed = JSON.parse(value)
      if (!Array.isArray(parsed)) {
        return undefined
      }
      const usedInstanceIds = new Set<string>()
      const usedSingleInstanceTabIds = new Set<SessionPanelTabId>()
      const openTabs = parsed.flatMap((entry, index): SessionPanelOpenTab[] => {
        if (!isStoredOpenTab(entry)) {
          return []
        }
        const tab = sessionPanelTabs.find((item) => item.id === entry.id)
        if (!tab) {
          return []
        }
        if (!tab.allowMultiple && usedSingleInstanceTabIds.has(tab.id)) {
          return []
        }
        const instanceId =
          entry.instanceId && !usedInstanceIds.has(entry.instanceId)
            ? entry.instanceId
            : `tab-${index + 1}`
        usedInstanceIds.add(instanceId)
        if (!tab.allowMultiple) {
          usedSingleInstanceTabIds.add(tab.id)
        }
        return [createOpenTabFromRegistration(tab, instanceId)]
      })
      return openTabs.length > 0 ? openTabs : undefined
    } catch {
      return undefined
    }
  }

  function isStoredOpenTab(
    value: unknown
  ): value is { id: SessionPanelTabId; instanceId?: string } {
    if (!value || typeof value !== 'object') {
      return false
    }
    const entry = value as Partial<SessionPanelOpenTab>
    return (
      isSessionPanelTabId(entry.id) &&
      (entry.instanceId === undefined || typeof entry.instanceId === 'string')
    )
  }

  function isSessionPanelTabId(value: unknown): value is SessionPanelTabId {
    return sessionPanelTabs.some((tab) => tab.id === value)
  }

  function persistState(key: string, state: SessionPanelTabsState): void {
    window.localStorage.setItem(
      getStorageKey(SESSION_PANEL_TABS_STORAGE_KEY, key),
      JSON.stringify(state.openTabs.map(({ id, instanceId }) => ({ id, instanceId })))
    )
    window.localStorage.setItem(
      getStorageKey(SESSION_PANEL_ACTIVE_TAB_STORAGE_KEY, key),
      state.activeTabInstanceId
    )
  }

  function getStorageKey(baseKey: string, key: string): string {
    return `${baseKey}.${key}`
  }

  function markTabAttention(tabId: SessionPanelTabId): void {
    const state = activeState.value
    if (activeTabId.value === tabId) {
      return
    }
    if (!state.attentionTabIds.includes(tabId)) {
      state.attentionTabIds = [...state.attentionTabIds, tabId]
      persistState(activeStateKey.value, state)
    }
  }

  function clearTabAttention(tabId: SessionPanelTabId): void {
    const state = activeState.value
    if (!state.attentionTabIds.includes(tabId)) {
      return
    }
    state.attentionTabIds = state.attentionTabIds.filter((id) => id !== tabId)
    persistState(activeStateKey.value, state)
  }

  function openAddPanel(): void {
    const state = activeState.value
    state.activeTabInstanceId = ADD_TAB_INSTANCE_ID
    persistState(activeStateKey.value, state)
  }

  function openTab(tabId: SessionPanelTabId): void {
    const state = activeState.value
    const tab = sessionPanelTabs.find((item) => item.id === tabId)
    const existingTab = state.openTabs.find((openTab) => openTab.id === tabId)
    if (tab && !tab.allowMultiple && existingTab) {
      selectOpenTab(existingTab.instanceId)
      return
    }
    const openTab = createOpenTab(tabId, state.nextTabInstanceIndex)
    state.nextTabInstanceIndex += 1
    state.openTabs = [...state.openTabs, openTab]
    state.activeTabInstanceId = openTab.instanceId
    clearTabAttention(tabId)
    persistState(activeStateKey.value, state)
  }

  function selectOpenTab(tabInstanceId: string): void {
    const state = activeState.value
    if (!isKnownTabInstance(tabInstanceId, state.openTabs)) {
      return
    }
    state.activeTabInstanceId = tabInstanceId
    const selectedTabId = state.openTabs.find((tab) => tab.instanceId === tabInstanceId)?.id
    if (selectedTabId) {
      clearTabAttention(selectedTabId)
    }
    persistState(activeStateKey.value, state)
  }

  function selectTab(tabId: SessionPanelTabId): void {
    const state = activeState.value
    const existingTab = state.openTabs.find((tab) => tab.id === tabId)
    if (existingTab) {
      selectOpenTab(existingTab.instanceId)
      return
    }
    openTab(tabId)
  }

  function closeTab(tabInstanceId: string): void {
    const state = activeState.value
    const currentIndex = state.openTabs.findIndex((tab) => tab.instanceId === tabInstanceId)
    if (currentIndex === -1) {
      return
    }
    const nextOpenTabs = state.openTabs.filter((tab) => tab.instanceId !== tabInstanceId)
    state.openTabs = nextOpenTabs
    if (state.activeTabInstanceId !== tabInstanceId) {
      persistState(activeStateKey.value, state)
      return
    }
    const nextActiveTab =
      nextOpenTabs[Math.min(currentIndex, nextOpenTabs.length - 1)] ??
      nextOpenTabs[currentIndex - 1]
    state.activeTabInstanceId = nextActiveTab?.instanceId ?? ADD_TAB_INSTANCE_ID
    persistState(activeStateKey.value, state)
  }

  function createOpenTab(tabId: SessionPanelTabId, instanceIndex: number): SessionPanelOpenTab {
    const tab = sessionPanelTabs.find((item) => item.id === tabId) ?? sessionPanelTabs[0]
    return createOpenTabFromRegistration(tab, `tab-${instanceIndex}`)
  }

  function createOpenTabFromRegistration(
    tab: SessionPanelTab,
    instanceId: string
  ): SessionPanelOpenTab {
    return {
      id: tab.id,
      label: tab.label,
      allowMultiple: tab.allowMultiple,
      instanceId
    }
  }

  function isKnownTabInstance(instanceId: string, openTabs: SessionPanelOpenTab[]): boolean {
    return (
      instanceId === ADD_TAB_INSTANCE_ID || openTabs.some((tab) => tab.instanceId === instanceId)
    )
  }

  function getNextTabInstanceIndex(openTabs: SessionPanelOpenTab[]): number {
    const maxStoredIndex = openTabs.reduce((maxIndex, tab) => {
      const match = /^tab-(\d+)$/.exec(tab.instanceId)
      return match ? Math.max(maxIndex, Number(match[1])) : maxIndex
    }, 0)
    return maxStoredIndex + 1
  }

  return {
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
  }
}
