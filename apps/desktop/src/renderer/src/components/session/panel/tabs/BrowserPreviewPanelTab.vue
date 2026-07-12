<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, watch } from 'vue'
import { Globe2, LoaderCircle, Plus, X } from 'lucide-vue-next'
import BaseIconButton from '@renderer/components/base/BaseIconButton.vue'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import BrowserPreviewPage from './BrowserPreviewPage.vue'
import {
  addBrowserTab,
  closeBrowserTab,
  createBrowserTab,
  DEFAULT_BROWSER_URL,
  MAX_BROWSER_TABS,
  normalizeBrowserUrl,
  requireBrowserTab,
  restoreBrowserTabs,
  switchBrowserTab,
  withBrowserCommandTimeout,
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

const props = defineProps<{ panelId?: string }>()
const store = useWorkspaceSessionStore()
const storageScope = props.panelId || 'default'
const tabsStorageKey = `meta-agent.browser-preview.tabs:${storageScope}`
const pageRefs = new Map<string, BrowserPageHandle>()
const processedCommandRequestIds = new Set<string>()
const commandExecutionQueues = new Map<string, Promise<void>>()
const PAGE_COMMAND_TIMEOUT_MS = 25_000
let removeOpenRequestedListener: (() => void) | undefined

function createBrowserId(): string {
  return `tab-${crypto.randomUUID().slice(0, 8)}`
}

function readStoredTabs(): BrowserTabsState {
  try {
    const restored = restoreBrowserTabs(JSON.parse(localStorage.getItem(tabsStorageKey) || ''))
    if (restored) return restored
  } catch {
    // Invalid persisted state falls back to one tab.
  }
  let initialUrl = DEFAULT_BROWSER_URL
  try {
    initialUrl = normalizeBrowserUrl(
      localStorage.getItem(`meta-agent.browser-preview.url:${storageScope}`) || DEFAULT_BROWSER_URL
    )
  } catch {
    // Invalid legacy URL falls back to the default page.
  }
  const tab = createBrowserTab(createBrowserId(), initialUrl)
  return { tabs: [tab], activeBrowserId: tab.id }
}

const tabsState = reactive<BrowserTabsState>(readStoredTabs())

function persistTabs(): void {
  localStorage.setItem(
    tabsStorageKey,
    JSON.stringify({
      activeBrowserId: tabsState.activeBrowserId,
      tabs: tabsState.tabs.map(({ id, url }) => ({ id, url }))
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

function openBrowserTab(url?: unknown, activate = true): BrowserTab {
  const tab = addBrowserTab(
    tabsState,
    createBrowserTab(createBrowserId(), normalizeBrowserUrl(url)),
    activate
  )
  persistTabs()
  return tab
}

function activateBrowserTab(browserId: string): BrowserTab {
  const tab = switchBrowserTab(tabsState, browserId)
  persistTabs()
  return tab
}

function removeBrowserTab(browserId: string): BrowserTab {
  const tab = closeBrowserTab(tabsState, browserId)
  pageRefs.get(browserId)?.stop()
  pageRefs.delete(browserId)
  persistTabs()
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
    const closed = removeBrowserTab(String(payload.browserId || ''))
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
  return browserIdentity(tab.id, await page.executeCommand(message))
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
  if (!props.panelId) return []
  return Object.entries(store.runtimeByThreadId).flatMap(([threadId, runtime]) => {
    const entry = runtime.extensionPanelMessages[props.panelId!]
    if (!entry) return []
    return (entry.messages ?? [{ sequence: entry.sequence, message: entry.message }]).map(
      ({ sequence, message }) => ({
        threadId,
        sequence,
        message: message as Partial<BrowserCommand>
      })
    )
  })
})

function enqueueBrowserCommand(threadId: string, message: BrowserCommand): void {
  const payload = (message.payload || {}) as Record<string, unknown>
  const isPageCommand = !['open', 'tabs', 'switch', 'close'].includes(message.command)
  const targetBrowserId = isPageCommand
    ? requireBrowserTab(
        tabsState,
        typeof payload.browserId === 'string' ? payload.browserId : undefined
      ).id
    : undefined
  const routedMessage = targetBrowserId
    ? { ...message, payload: { ...payload, browserId: targetBrowserId } }
    : message
  const queueKey = targetBrowserId ? `page:${targetBrowserId}` : 'browser-controls'
  const previous = commandExecutionQueues.get(queueKey) ?? Promise.resolve()
  const queued = previous
    .catch(() => undefined)
    .then(() =>
      sendResult(threadId, message.requestId, () =>
        withBrowserCommandTimeout(
          executeBrowserCommand(routedMessage),
          message.command,
          PAGE_COMMAND_TIMEOUT_MS
        )
      )
    )
    .catch((cause: unknown) => console.error('Failed to send Browser command result', cause))
  commandExecutionQueues.set(queueKey, queued)
  void queued.finally(() => {
    if (commandExecutionQueues.get(queueKey) === queued) commandExecutionQueues.delete(queueKey)
  })
}

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
          :title="`${tabLabel(tab)} - ${tab.url}`"
          @click="activateBrowserTab(tab.id)"
        >
          <LoaderCircle v-if="tab.loading" class="browser-preview-tab__loading" />
          <Globe2 v-else />
          <span>{{ tabLabel(tab) }}</span>
        </button>
        <button
          type="button"
          class="browser-preview-tab__close"
          :disabled="tabsState.tabs.length === 1"
          :aria-label="`Close ${tabLabel(tab)}`"
          @click="removeBrowserTab(tab.id)"
        >
          <X />
        </button>
      </div>
      <BaseIconButton
        label="New browser tab"
        size="medium"
        :disabled="tabsState.tabs.length >= MAX_BROWSER_TABS"
        @click="openBrowserTab()"
      >
        <Plus :size="14" />
      </BaseIconButton>
    </nav>

    <BrowserPreviewPage
      v-for="tab in tabsState.tabs"
      v-show="tab.id === tabsState.activeBrowserId"
      :key="tab.id"
      :ref="(value) => setPageRef(tab.id, value)"
      :browser-id="tab.id"
      :initial-url="tab.url"
      @state="updatePageState"
    />
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

.browser-preview-tab__close:disabled {
  opacity: 0;
  pointer-events: none;
}

.browser-preview-tab__loading {
  animation: browser-tab-spin 1s linear infinite;
}

@keyframes browser-tab-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
