import { computed, reactive, watch, type ComputedRef, type Ref } from 'vue'
import type {
  ExtensionSessionPanelTabId,
  SessionPanelOpenTab,
  SessionPanelTab,
  SessionPanelTabId
} from '../model/types'

const SESSION_PANEL_TABS_STORAGE_KEY = 'meta-agent.session-panel.tabs.v2'
const SESSION_PANEL_ACTIVE_TAB_STORAGE_KEY = 'meta-agent.session-panel.active-tab.v2'
const ORPHAN_SESSION_PANEL_TABS_KEY = '__orphan__'
const ADD_TAB_INSTANCE_ID = '__add-tab__'

function getStorageKey(baseKey: string, key: string): string {
  return `${baseKey}.${key}`
}

export function transferStoredSessionPanelTabsState(
  sourceSessionKey: string | undefined,
  targetSessionKey: string
): void {
  const sourceKey = sourceSessionKey || ORPHAN_SESSION_PANEL_TABS_KEY
  if (sourceKey === targetSessionKey) {
    return
  }

  try {
    for (const baseKey of [SESSION_PANEL_TABS_STORAGE_KEY, SESSION_PANEL_ACTIVE_TAB_STORAGE_KEY]) {
      const sourceStorageKey = getStorageKey(baseKey, sourceKey)
      const sourceValue = window.localStorage.getItem(sourceStorageKey)
      if (sourceValue !== null) {
        window.localStorage.setItem(getStorageKey(baseKey, targetSessionKey), sourceValue)
        window.localStorage.removeItem(sourceStorageKey)
      }
    }
  } catch {
    // localStorage 不可用时由目标 session 的默认 tab 状态兜底。
  }
}

interface SessionPanelTabsState {
  activeTabInstanceId: string
  attentionTabIds: SessionPanelTabId[]
  nextTabInstanceIndex: number
  openTabs: SessionPanelOpenTab[]
}

interface UseSessionPanelTabsStateResult {
  activeTabInstanceId: ComputedRef<string>
  activeTabId: ComputedRef<SessionPanelTabId | undefined>
  attentionTabIds: ComputedRef<SessionPanelTabId[]>
  availableTabs: ComputedRef<SessionPanelTab[]>
  clearTabAttention: (tabId: SessionPanelTabId) => void
  closeTab: (tabInstanceId: string) => void
  isAddPanelActive: ComputedRef<boolean>
  markTabAttention: (tabId: SessionPanelTabId) => void
  openAddPanel: () => void
  openTab: (tabId: SessionPanelTabId) => void
  openTabs: ComputedRef<SessionPanelOpenTab[]>
  selectOpenTab: (tabInstanceId: string) => void
  selectTab: (tabId: SessionPanelTabId) => void
}

export function useSessionPanelTabsState(
  sessionPanelTabs: Ref<SessionPanelTab[]>,
  sessionKey: Ref<string | undefined>
): UseSessionPanelTabsStateResult {
  const stateBySessionKey = reactive<Record<string, SessionPanelTabsState>>({})
  const orphanState = ensureState(ORPHAN_SESSION_PANEL_TABS_KEY)

  const activeStateKey = computed(() => sessionKey.value || ORPHAN_SESSION_PANEL_TABS_KEY)
  watch(activeStateKey, (key) => ensureState(key), { flush: 'sync', immediate: true })
  watch(
    sessionPanelTabs,
    () => {
      for (const [key, state] of Object.entries(stateBySessionKey)) {
        const normalizedOpenTabs = normalizeOpenTabs(state.openTabs)
        if (!isSameOpenTabs(state.openTabs, normalizedOpenTabs)) {
          state.openTabs = normalizedOpenTabs
          if (!isKnownTabInstance(state.activeTabInstanceId, state.openTabs)) {
            state.activeTabInstanceId = state.openTabs[0]?.instanceId ?? ADD_TAB_INSTANCE_ID
          }
          persistState(key, state)
        }
      }
    },
    { flush: 'sync' }
  )
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
    sessionPanelTabs.value.filter(
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
        const tab = findSessionPanelTab(entry.id)
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
    return sessionPanelTabs.value.some((tab) => tab.id === value) || isExtensionTabId(value)
  }

  function isExtensionTabId(value: unknown): value is ExtensionSessionPanelTabId {
    return typeof value === 'string' && value.startsWith('extension:') && value.length > 'extension:'.length
  }

  function findSessionPanelTab(tabId: SessionPanelTabId): SessionPanelTab | undefined {
    return sessionPanelTabs.value.find((item) => item.id === tabId) ?? createPendingExtensionTab(tabId)
  }

  function createPendingExtensionTab(tabId: SessionPanelTabId): SessionPanelTab | undefined {
    if (!isExtensionTabId(tabId)) {
      return undefined
    }
    return {
      id: tabId,
      label: tabId.slice('extension:'.length),
      allowMultiple: false
    }
  }

  function normalizeOpenTabs(openTabs: SessionPanelOpenTab[]): SessionPanelOpenTab[] {
    const usedInstanceIds = new Set<string>()
    const usedSingleInstanceTabIds = new Set<SessionPanelTabId>()
    return openTabs.flatMap((openTab, index): SessionPanelOpenTab[] => {
      const tab = findSessionPanelTab(openTab.id)
      if (!tab) {
        return []
      }
      if (!tab.allowMultiple && usedSingleInstanceTabIds.has(tab.id)) {
        return []
      }
      const instanceId = usedInstanceIds.has(openTab.instanceId)
        ? `tab-${index + 1}`
        : openTab.instanceId
      usedInstanceIds.add(instanceId)
      if (!tab.allowMultiple) {
        usedSingleInstanceTabIds.add(tab.id)
      }
      return [createOpenTabFromRegistration(tab, instanceId)]
    })
  }

  function isSameOpenTabs(left: SessionPanelOpenTab[], right: SessionPanelOpenTab[]): boolean {
    return (
      left.length === right.length &&
      left.every(
        (tab, index) =>
          tab.id === right[index]?.id &&
          tab.label === right[index]?.label &&
          tab.allowMultiple === right[index]?.allowMultiple &&
          tab.instanceId === right[index]?.instanceId
      )
    )
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
    const tab = findSessionPanelTab(tabId)
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
    const tab = findSessionPanelTab(tabId) ?? sessionPanelTabs.value[0]
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
