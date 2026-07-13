<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  ArrowLeft,
  ArrowRight,
  Chrome,
  Github,
  Globe2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Server,
  X
} from 'lucide-vue-next'
import BaseIconButton from '@renderer/components/base/BaseIconButton.vue'
import { useSessionContext } from '@renderer/composables/useSessionContext'
import type { ExtensionSessionPanelTabId } from '@renderer/components/session/panel/model/types'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import BrowserPreviewPage from './BrowserPreviewPage.vue'
import { resolveBrowserAddress } from './state/browserAddress'
import { assertBrowserCommandResultBudget } from './state/browserCommandBudget'
import { migrateLegacyBrowserPreviewStorage } from './state/browserPreviewMigration'
import { decideBrowserReveal } from './state/browserRevealPolicy'
import {
  addBrowserTab,
  closeBrowserTab,
  createBrowserCommandLifecycle,
  createBrowserGuideTab,
  createBrowserTab,
  enqueueSerialBrowserCommand,
  isBrowserPageTab,
  MAX_BROWSER_TABS,
  normalizeBrowserUrl,
  requireBrowserTab,
  restoreBrowserTabs,
  switchBrowserTab,
  type BrowserTab,
  type BrowserTabsState
} from './state/browserPreviewTabs'

type BrowserCommand = {
  type: 'browser.command'
  requestId: string
  command: string
  payload?: unknown
}

type BrowserPageState = {
  browserId: string
  title: string
  url: string
  loading: boolean
  webContentsId?: number
}

type BrowserPageHandle = {
  executeCommand: (message: BrowserCommand) => Promise<unknown>
  getWebContentsId: () => number | undefined
  stop: () => void
}

const props = defineProps<{
  panelId?: string
  sessionScope: string
  threadId?: string
  visible?: boolean
}>()
const emit = defineEmits<{
  attention: [threadId: string]
  busyChange: [busy: boolean]
  close: [sessionScope: string]
}>()
const store = useWorkspaceSessionStore()
const { panel, openPanelTab } = useSessionContext()
const legacyStorageScope = props.panelId || 'default'
const storageScope = `${legacyStorageScope}:${props.sessionScope}`
const tabsStorageKey = `meta-agent.browser-preview.tabs:${storageScope}`
const pageRefs = new Map<string, BrowserPageHandle>()
const processedCommandRequestIds = new Set<string>()
let commandExecutionQueue: Promise<void> = Promise.resolve()
const PAGE_COMMAND_TIMEOUT_MS = 25_000
const PANEL_COLLAPSE_COOLDOWN_MS = 10_000
const autoRevealedThreadIds = new Set<string>()
const lastPanelCollapsedAtByThreadId = new Map<string, number>()
let removeOpenRequestedListener: (() => void) | undefined
let inFlightCommandCount = 0
const guideAddress = ref('')
const guideError = ref('')
const guideShortcuts = [
  { label: 'Localhost', url: 'http://127.0.0.1:3000', icon: Server },
  { label: 'Vite', url: 'http://127.0.0.1:5173', icon: Server },
  { label: 'GitHub', url: 'https://github.com', icon: Github }
] as const

function beginBrowserCommand(): void {
  inFlightCommandCount += 1
  if (inFlightCommandCount === 1) emit('busyChange', true)
}

function finishBrowserCommand(): void {
  inFlightCommandCount = Math.max(0, inFlightCommandCount - 1)
  if (inFlightCommandCount === 0) emit('busyChange', false)
}

watch(
  () => [store.activeSessionId, panel.value.open] as const,
  ([threadId, open], [previousThreadId, previousOpen]) => {
    if (threadId && threadId === previousThreadId && previousOpen && !open) {
      lastPanelCollapsedAtByThreadId.set(threadId, Date.now())
    }
  }
)

function browserPanelTabId(): ExtensionSessionPanelTabId | undefined {
  return props.panelId ? `extension:${props.panelId}` : undefined
}

function applyBrowserRevealPolicy(threadId: string, command: string): void {
  const decision = decideBrowserReveal({
    command,
    activeThread: store.activeSessionId === threadId,
    browserVisible: Boolean(props.visible),
    panelOpen: panel.value.open,
    autoRevealed: autoRevealedThreadIds.has(threadId),
    recentlyCollapsed:
      Date.now() - (lastPanelCollapsedAtByThreadId.get(threadId) ?? Number.NEGATIVE_INFINITY) <
      PANEL_COLLAPSE_COOLDOWN_MS
  })
  if (decision === 'attention') {
    emit('attention', threadId)
    return
  }
  if (decision !== 'reveal') return

  const tabId = browserPanelTabId()
  if (!tabId) return
  autoRevealedThreadIds.add(threadId)
  openPanelTab(tabId)
}

function createBrowserId(): string {
  return `tab-${crypto.randomUUID().slice(0, 8)}`
}

migrateLegacyBrowserPreviewStorage({
  createBrowserId,
  legacyScope: legacyStorageScope,
  storage: localStorage,
  targetScope: storageScope
})

function readStoredTabs(): BrowserTabsState {
  try {
    const restored = restoreBrowserTabs(JSON.parse(localStorage.getItem(tabsStorageKey) || ''))
    if (restored) return restored
  } catch {
    // Invalid persisted state falls back to empty.
  }
  return { tabs: [], activeBrowserId: '' }
}

const tabsState = reactive<BrowserTabsState>(readStoredTabs())
const pageTabs = computed(() => tabsState.tabs.filter(isBrowserPageTab))
const activeGuideTab = computed(() =>
  tabsState.tabs.find((tab) => tab.kind === 'guide' && tab.id === tabsState.activeBrowserId)
)

function persistTabs(): void {
  const persistedTabs = tabsState.tabs.filter(isBrowserPageTab)
  localStorage.setItem(
    tabsStorageKey,
    JSON.stringify({
      activeBrowserId: persistedTabs.some((tab) => tab.id === tabsState.activeBrowserId)
        ? tabsState.activeBrowserId
        : '',
      tabs: persistedTabs.map(({ id, url }) => ({ id, url }))
    })
  )
}

function tabSummary(tab: BrowserTab): {
  browserId: string
  title: string
  url: string
  loading: boolean
  active: boolean
} {
  return {
    browserId: tab.id,
    title: tab.title,
    url: tab.url,
    loading: tab.loading,
    active: tab.id === tabsState.activeBrowserId
  }
}

function openGuideTab(): BrowserTab {
  guideAddress.value = ''
  guideError.value = ''
  return addBrowserTab(tabsState, createBrowserGuideTab(createBrowserId()))
}

function openBrowserTab(url?: unknown, activate = true): BrowserTab {
  const activeTab = tabsState.tabs.find((tab) => tab.id === tabsState.activeBrowserId)
  if (activate && activeTab?.kind === 'guide') closeBrowserTab(tabsState, activeTab.id)
  const tab = addBrowserTab(
    tabsState,
    createBrowserTab(createBrowserId(), normalizeBrowserUrl(url)),
    activate
  )
  persistTabs()
  return tab
}

function submitGuideAddress(): void {
  try {
    guideError.value = ''
    openBrowserTab(resolveBrowserAddress(guideAddress.value))
  } catch (cause) {
    guideError.value = cause instanceof Error ? cause.message : String(cause)
  }
}

function activateBrowserTab(browserId: string): BrowserTab {
  const tab = switchBrowserTab(tabsState, browserId)
  persistTabs()
  return tab
}

async function removeBrowserTab(browserId: string): Promise<BrowserTab> {
  const tab = closeBrowserTab(tabsState, browserId)
  pageRefs.get(browserId)?.stop()
  pageRefs.delete(browserId)
  persistTabs()
  if (tabsState.tabs.length === 0) {
    await nextTick()
    if (tabsState.tabs.length === 0) emit('close', props.sessionScope)
  }
  return tab
}

function updatePageState(state: BrowserPageState): void {
  const tab = tabsState.tabs.find((entry) => entry.id === state.browserId)
  if (!tab) return
  tab.title = state.title
  tab.url = state.url
  tab.loading = state.loading
  tab.webContentsId = state.webContentsId
  persistTabs()
}

function setPageRef(browserId: string, value: unknown): void {
  if (value) pageRefs.set(browserId, value as BrowserPageHandle)
  else pageRefs.delete(browserId)
}

function tabLabel(tab: BrowserTab): string {
  if (tab.kind === 'guide') return tab.title
  if (tab.title && !['Browser', 'New tab'].includes(tab.title)) return tab.title
  try {
    return new URL(tab.url).host || 'New tab'
  } catch {
    return 'New tab'
  }
}

function browserIdentity(browserId: string, value: unknown): unknown {
  if (Array.isArray(value)) return { browserId, entries: value }
  if (value && typeof value === 'object') return { ...value, browserId }
  return { browserId, value }
}

async function executeBrowserCommand(message: BrowserCommand): Promise<unknown> {
  const payload = (message.payload || {}) as Record<string, unknown>
  if (message.command === 'open') {
    const tab = openBrowserTab(payload.url, payload.activate !== false)
    await nextTick()
    return tabSummary(tab)
  }
  if (message.command === 'tabs') {
    return { tabs: tabsState.tabs.map(tabSummary), activeBrowserId: tabsState.activeBrowserId }
  }
  if (message.command === 'switch') {
    const tab = activateBrowserTab(String(payload.browserId || ''))
    return tabSummary(tab)
  }
  if (message.command === 'close') {
    const closed = await removeBrowserTab(String(payload.browserId || ''))
    return {
      closedBrowserId: closed.id,
      activeBrowserId: tabsState.activeBrowserId,
      tabs: tabsState.tabs.map(tabSummary)
    }
  }

  const tab = requireBrowserTab(
    tabsState,
    typeof payload.browserId === 'string' ? payload.browserId : undefined
  )
  const page = pageRefs.get(tab.id)
  if (!page) throw new Error(`Browser tab is not ready: ${tab.id}`)
  const result = browserIdentity(tab.id, await page.executeCommand(message))
  assertBrowserCommandResultBudget(message.command, result)
  return result
}

async function sendResult(
  threadId: string,
  requestId: string,
  operation: () => Promise<unknown>
): Promise<void> {
  if (!props.panelId) return
  try {
    const value = await operation()
    await window.api.codingAgent.sendExtensionPanelMessage({
      threadId,
      panelId: props.panelId,
      message: { type: 'browser.result', requestId, ok: true, value }
    })
  } catch (cause) {
    await window.api.codingAgent.sendExtensionPanelMessage({
      threadId,
      panelId: props.panelId,
      message: {
        type: 'browser.result',
        requestId,
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause)
      }
    })
  }
}

const panelCommands = computed(() => {
  if (!props.panelId || !props.threadId) return []
  const entry = store.runtimeByThreadId[props.threadId]?.extensionPanelMessages[props.panelId]
  if (!entry) return []
  return (entry.messages ?? [{ sequence: entry.sequence, message: entry.message }]).map(
    ({ sequence, message }) => ({
      threadId: props.threadId!,
      sequence,
      message: message as Partial<BrowserCommand>
    })
  )
})

function enqueueBrowserCommand(threadId: string, message: BrowserCommand): void {
  applyBrowserRevealPolicy(threadId, message.command)
  beginBrowserCommand()
  const queued = enqueueSerialBrowserCommand(commandExecutionQueue, async () => {
    const lifecycle = createBrowserCommandLifecycle(
      executeBrowserCommand(message).then((value) => {
        assertBrowserCommandResultBudget(message.command, value)
        return value
      }),
      message.command,
      PAGE_COMMAND_TIMEOUT_MS
    )
    try {
      await sendResult(threadId, message.requestId, () => lifecycle.response)
    } finally {
      await lifecycle.settled
    }
  }).catch((cause: unknown) => console.error('Failed to send Browser command result', cause))
  commandExecutionQueue = queued
  void queued.finally(() => {
    finishBrowserCommand()
  })
}

watch(
  () => props.visible,
  (visible) => {
    if (visible && tabsState.tabs.length === 0) openGuideTab()
  },
  { immediate: true }
)

watch(
  panelCommands,
  (commands) => {
    const consumedSequences = new Map<string, number>()
    for (const { threadId, sequence, message } of commands) {
      consumedSequences.set(threadId, Math.max(consumedSequences.get(threadId) ?? 0, sequence))
      if (
        message.type !== 'browser.command' ||
        typeof message.requestId !== 'string' ||
        typeof message.command !== 'string' ||
        processedCommandRequestIds.has(message.requestId)
      ) {
        continue
      }
      processedCommandRequestIds.add(message.requestId)
      if (processedCommandRequestIds.size > 1000) {
        const oldestRequestId = processedCommandRequestIds.values().next().value
        if (oldestRequestId) processedCommandRequestIds.delete(oldestRequestId)
      }
      try {
        enqueueBrowserCommand(threadId, message as BrowserCommand)
      } catch (cause) {
        void sendResult(threadId, message.requestId, async () => {
          throw cause
        })
      }
    }
    for (const [threadId, sequence] of consumedSequences) {
      store.consumeExtensionPanelMessages(threadId, props.panelId!, sequence)
    }
  },
  { flush: 'sync', immediate: true }
)

onMounted(() => {
  removeOpenRequestedListener = window.api.browserPreview.onOpenRequested((request) => {
    const ownsOpener = [...pageRefs.values()].some(
      (page) => page.getWebContentsId() === request.openerWebContentsId
    )
    if (!ownsOpener) return
    try {
      openBrowserTab(request.url)
    } catch (cause) {
      console.warn('Ignoring Browser popup request', cause)
    }
  })
})

onBeforeUnmount(() => {
  removeOpenRequestedListener?.()
  for (const page of pageRefs.values()) page.stop()
})
</script>

<template>
  <section class="browser-preview-host" role="tabpanel">
    <nav class="browser-preview-tabs" role="tablist" aria-label="Browser tabs">
      <div
        v-for="tab in tabsState.tabs"
        :key="tab.id"
        class="browser-preview-tab"
        :class="{ 'is-active': tab.id === tabsState.activeBrowserId }"
      >
        <button
          type="button"
          class="browser-preview-tab__select"
          role="tab"
          :aria-selected="tab.id === tabsState.activeBrowserId"
          :title="tab.url ? `${tabLabel(tab)} - ${tab.url}` : tabLabel(tab)"
          @click="activateBrowserTab(tab.id)"
        >
          <LoaderCircle v-if="tab.loading" class="browser-preview-tab__loading" />
          <Globe2 v-else />
          <span>{{ tabLabel(tab) }}</span>
        </button>
        <button
          type="button"
          class="browser-preview-tab__close"
          :aria-label="`Close ${tabLabel(tab)}`"
          @click="removeBrowserTab(tab.id)"
        >
          <X />
        </button>
      </div>
      <BaseIconButton
        label="New browser tab"
        :disabled="tabsState.tabs.length >= MAX_BROWSER_TABS"
        @click="openGuideTab()"
      >
        <Plus :size="14" />
      </BaseIconButton>
    </nav>

    <BrowserPreviewPage
      v-for="tab in pageTabs"
      v-show="tab.id === tabsState.activeBrowserId"
      :key="tab.id"
      :ref="(value) => setPageRef(tab.id, value)"
      :browser-id="tab.id"
      :initial-url="tab.url"
      :active="visible && tab.id === tabsState.activeBrowserId"
      :session-scope="storageScope"
      :thread-id="threadId"
      @state="updatePageState"
    />
    <div v-if="activeGuideTab" class="browser-preview-guide">
      <div class="browser-preview-guide__toolbar">
        <BaseIconButton label="Back" size="small" disabled>
          <ArrowLeft :size="12" />
        </BaseIconButton>
        <BaseIconButton label="Forward" size="small" disabled>
          <ArrowRight :size="12" />
        </BaseIconButton>
        <BaseIconButton label="Reload" size="small" disabled>
          <RefreshCw :size="12" />
        </BaseIconButton>
        <form class="browser-preview-guide__address" @submit.prevent="submitGuideAddress">
          <Globe2 aria-hidden="true" />
          <input
            v-model="guideAddress"
            aria-label="Address and search bar"
            autocomplete="off"
            placeholder="Search Google or enter a URL"
            :spellcheck="false"
          />
        </form>
      </div>
      <div class="browser-preview-new-tab-page">
        <div class="browser-preview-new-tab-page__brand">
          <Chrome aria-hidden="true" />
          <h1>Browser</h1>
        </div>
        <form class="browser-preview-new-tab-page__search" @submit.prevent="submitGuideAddress">
          <Search aria-hidden="true" />
          <input
            v-model="guideAddress"
            aria-label="Search Google or enter a URL"
            autocomplete="off"
            placeholder="Search Google or enter a URL"
            :spellcheck="false"
          />
        </form>
        <p v-if="guideError" class="browser-preview-new-tab-page__error" role="alert">
          {{ guideError }}
        </p>
        <div class="browser-preview-new-tab-page__shortcuts" aria-label="Shortcuts">
          <button
            v-for="shortcut in guideShortcuts"
            :key="shortcut.url"
            type="button"
            @click="openBrowserTab(shortcut.url)"
          >
            <span><component :is="shortcut.icon" aria-hidden="true" /></span>
            {{ shortcut.label }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.browser-preview-host {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  background: var(--color-surface);
}

.browser-preview-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  height: 30px;
  padding: 3px 6px;
  overflow-x: auto;
  overflow-y: hidden;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background);
  scrollbar-width: thin;
}

.browser-preview-tab {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  width: clamp(96px, 18cqi, 176px);
  height: 24px;
  min-width: 0;
  color: var(--color-text-muted);
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  background: transparent;
}

.browser-preview-tab:hover,
.browser-preview-tab.is-active {
  color: var(--color-text);
  border-color: var(--color-border);
  background: var(--color-surface-raised);
}

.browser-preview-tab__select {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 5px;
  min-width: 0;
  height: 100%;
  padding: 0 3px 0 7px;
  color: inherit;
  font: inherit;
  font-size: var(--font-size-ui-xs);
  background: transparent;
  border: 0;
  cursor: pointer;
}

.browser-preview-tab__select span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.browser-preview-tab__select svg,
.browser-preview-tab__close svg {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
}

.browser-preview-tab__close {
  display: grid;
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  place-items: center;
  padding: 0;
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs);
  cursor: pointer;
}

.browser-preview-tab__close:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.browser-preview-tab__loading {
  animation: browser-tab-spin 1s linear infinite;
}

@keyframes browser-tab-spin {
  to {
    transform: rotate(360deg);
  }
}

.browser-preview-guide {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.browser-preview-guide__toolbar {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: 4px 8px;
  background: var(--color-background);
  border-bottom: 1px solid var(--color-border);
}

.browser-preview-guide__address {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 7px;
  min-width: 120px;
  height: 26px;
  padding: 0 8px;
  background: var(--color-surface-raised);
  border: 1px solid transparent;
  border-radius: 6px;
}

.browser-preview-guide__address:focus-within {
  background: var(--color-surface);
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary) 28%, transparent);
}

.browser-preview-guide__address > svg {
  flex: none;
  width: 13px;
  height: 13px;
  color: var(--color-text-muted);
}

.browser-preview-guide__address input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  color: var(--color-text);
  font: inherit;
  font-size: 11px;
  letter-spacing: 0;
  outline: none;
  background: transparent;
  border: 0;
}

.browser-preview-new-tab-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  min-width: 0;
  height: 100%;
  padding: 32px;
  overflow: auto;
  color: var(--color-text);
  background: var(--color-surface);
}

.browser-preview-new-tab-page__brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.browser-preview-new-tab-page__brand > svg {
  width: 40px;
  height: 40px;
  color: var(--color-primary);
}

.browser-preview-new-tab-page__brand h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  letter-spacing: 0;
}

.browser-preview-new-tab-page__search {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(100%, 560px);
  height: 44px;
  padding: 0 14px;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: var(--shadow-sm);
}

.browser-preview-new-tab-page__search:focus-within {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent);
}

.browser-preview-new-tab-page__search > svg {
  flex: none;
  width: 17px;
  height: 17px;
  color: var(--color-text-muted);
}

.browser-preview-new-tab-page__search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-ui-sm);
  letter-spacing: 0;
  outline: none;
  background: transparent;
  border: 0;
}

.browser-preview-new-tab-page__error {
  width: min(100%, 560px);
  margin: -14px 0 0;
  color: var(--color-destructive);
  font-size: var(--font-size-ui-xs);
}

.browser-preview-new-tab-page__shortcuts {
  display: grid;
  grid-template-columns: repeat(3, 76px);
  gap: 12px;
  justify-content: center;
}

.browser-preview-new-tab-page__shortcuts button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 76px;
  min-width: 0;
  padding: 8px 4px;
  overflow: hidden;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--font-size-ui-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
  background: transparent;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}

.browser-preview-new-tab-page__shortcuts button:hover {
  color: var(--color-text);
  background: var(--color-surface-hover);
}

.browser-preview-new-tab-page__shortcuts button > span {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  color: var(--color-text);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: 50%;
}

.browser-preview-new-tab-page__shortcuts svg {
  width: 17px;
  height: 17px;
}
</style>
