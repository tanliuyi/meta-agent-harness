<script setup lang="ts">
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch
} from 'vue'
import { useRoute } from 'vue-router'
import { useTheme } from '@renderer/composables/useTheme'
import { isWorkspaceRouteName } from '@renderer/router/workspace-route-host'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import {
  cloneExtensionPanelMessage,
  getNextExtensionPanelViewState,
  handleExtensionPanelHostMessage,
  isExtensionPanelNavigationBlocked,
  postExtensionPanelMessage,
  postExtensionPanelState,
  postExtensionPanelTheme,
  postExtensionPanelVisibility
} from './display/extensionPanelHostBridge'
import {
  collectExtensionPanelThemePayload,
  getExtensionPanelAllowedNavigationOrigin,
  getExtensionPanelSandbox,
  getExtensionPanelResolvedUrl,
  prepareExtensionPanelHtml
} from './display/extensionPanelDisplay'

const props = defineProps<{
  panelId?: string
}>()

const route = useRoute()
const workspaceSession = useWorkspaceSessionStore()
const { resolvedTheme } = useTheme()
const frameRef = ref<HTMLIFrameElement | null>(null)
const componentActive = ref(true)
const panelThreadId = ref<string | undefined>(workspaceSession.activeSessionId)
const lastVisibleState = ref<boolean | undefined>(undefined)
const navigationBlocked = ref(false)
const panel = computed(() =>
  props.panelId ? workspaceSession.activeExtensionPanels[props.panelId] : undefined
)
const panelMessage = computed(() =>
  props.panelId ? workspaceSession.activeExtensionPanelMessages[props.panelId] : undefined
)
const panelState = computed(() =>
  props.panelId ? workspaceSession.activeExtensionPanelStates[props.panelId] : undefined
)
const iframeSandbox = computed(() => getExtensionPanelSandbox(panel.value))
const urlSource = computed(() => getExtensionPanelResolvedUrl(panel.value) ?? '')
const allowedNavigationOrigin = computed(() =>
  getExtensionPanelAllowedNavigationOrigin(panel.value)
)
const panelVisible = computed(() => componentActive.value && isWorkspaceRouteName(route.name))
const panelTheme = computed(() =>
  collectExtensionPanelThemePayload({
    theme: resolvedTheme.value,
    root: document.documentElement
  })
)
const initialScriptPanelTheme = panelTheme.value
const initialScriptPanelState =
  panelState.value === undefined ? undefined : cloneExtensionPanelMessage(panelState.value)
const htmlSource = computed(() => {
  const currentPanel = panel.value
  if (!currentPanel) {
    return ''
  }
  const shouldUpdateHtmlTheme =
    currentPanel.source.type === 'html' && !currentPanel.source.permissions?.enableScripts
  return prepareExtensionPanelHtml(
    currentPanel,
    shouldUpdateHtmlTheme ? panelTheme.value : initialScriptPanelTheme,
    initialScriptPanelState
  )
})

function handleWindowMessage(event: MessageEvent): void {
  const result = handleExtensionPanelHostMessage({
    panelId: props.panelId,
    threadId: workspaceSession.activeSessionId,
    panel: panel.value,
    navigationBlocked: navigationBlocked.value,
    event,
    frameWindow: frameRef.value?.contentWindow,
    setPanelState: (threadId, panelId, state) =>
      workspaceSession.setExtensionPanelState(threadId, panelId, state),
    openExternalUrl: (uri) => void window.api.codingAgent.openExternalUrl({ uri }),
    sendPanelMessage: (threadId, panelId, message) =>
      void window.api.codingAgent.sendExtensionPanelMessage({
        threadId,
        panelId,
        message
      })
  })
  if (result === 'state-rejected') {
    console.warn('Ignoring invalid extension panel state')
  }
}

function postCurrentPanelMessage(): void {
  postExtensionPanelMessage({
    target: frameRef.value?.contentWindow,
    panel: panel.value,
    navigationBlocked: navigationBlocked.value,
    message: panelMessage.value
  })
}

function postPanelState(): void {
  postExtensionPanelState({
    target: frameRef.value?.contentWindow,
    panel: panel.value,
    navigationBlocked: navigationBlocked.value,
    state: panelState.value
  })
}

function postPanelTheme(): void {
  postExtensionPanelTheme({
    target: frameRef.value?.contentWindow,
    panel: panel.value,
    navigationBlocked: navigationBlocked.value,
    theme: panelTheme.value
  })
}

function postPanelVisibility(visible: boolean): void {
  postExtensionPanelVisibility({
    target: frameRef.value?.contentWindow,
    panel: panel.value,
    navigationBlocked: navigationBlocked.value,
    visible
  })
}

function sendPanelViewState(visible: boolean): void {
  const threadId = panelThreadId.value ?? workspaceSession.activeSessionId
  const next = getNextExtensionPanelViewState({
    panelId: props.panelId,
    threadId,
    panel: panel.value,
    lastVisibleState: lastVisibleState.value,
    visible
  })
  lastVisibleState.value = next.nextLastVisibleState
  if (!next.event || !threadId) {
    return
  }
  void window.api.codingAgent.sendExtensionPanelLifecycleEvent({
    threadId,
    event: next.event
  })
}

function setPanelVisible(visible: boolean): void {
  postPanelVisibility(visible)
  sendPanelViewState(visible)
}

function getReadableFrameLocation(): string | undefined {
  try {
    return frameRef.value?.contentWindow?.location.href
  } catch {
    return undefined
  }
}

function refreshNavigationBlocked(): boolean {
  const currentPanel = panel.value
  if (!currentPanel || currentPanel.source.type !== 'url') {
    navigationBlocked.value = false
    return false
  }
  navigationBlocked.value = isExtensionPanelNavigationBlocked({
    panel: currentPanel,
    readableFrameLocation: getReadableFrameLocation(),
    urlSource: urlSource.value
  })
  return navigationBlocked.value
}

function handleFrameLoad(): void {
  if (refreshNavigationBlocked()) {
    return
  }
  postPanelState()
  postPanelTheme()
  postCurrentPanelMessage()
  setPanelVisible(panelVisible.value)
}

watch(
  () => panelMessage.value?.sequence,
  () => postCurrentPanelMessage()
)

watch(
  () => [props.panelId, urlSource.value] as const,
  () => {
    refreshNavigationBlocked()
  },
  { immediate: true }
)

watch(panelTheme, async () => {
  await nextTick()
  postPanelTheme()
})

watch(
  () => route.name,
  () => setPanelVisible(panelVisible.value),
  { flush: 'sync' }
)

window.addEventListener('message', handleWindowMessage)
onMounted(() => {
  panelThreadId.value ??= workspaceSession.activeSessionId
  setPanelVisible(panelVisible.value)
})
onActivated(() => {
  componentActive.value = true
  setPanelVisible(panelVisible.value)
})
onDeactivated(() => {
  componentActive.value = false
  setPanelVisible(false)
})
onBeforeUnmount(() => {
  componentActive.value = false
  setPanelVisible(false)
  window.removeEventListener('message', handleWindowMessage)
})
</script>

<template>
  <section class="session-section extension-webview-panel" role="tabpanel">
    <header class="session-section__header">
      <div>
        <p class="session-section__eyebrow">Extension Panel</p>
        <h2>{{ panel?.title ?? 'Extension' }}</h2>
      </div>
    </header>

    <div v-if="panel" class="extension-webview-panel__frame-wrap">
      <div v-if="navigationBlocked" class="extension-webview-panel__blocked" role="alert">
        <strong>Panel navigation blocked.</strong>
        <span v-if="allowedNavigationOrigin">Allowed origin: {{ allowedNavigationOrigin }}</span>
      </div>
      <iframe
        v-if="panel.source.type === 'url'"
        v-show="!navigationBlocked"
        ref="frameRef"
        class="extension-webview-panel__frame"
        :sandbox="iframeSandbox"
        :src="urlSource"
        :title="panel.title"
        @load="handleFrameLoad"
      />
      <iframe
        v-else
        v-show="!navigationBlocked"
        ref="frameRef"
        class="extension-webview-panel__frame"
        :sandbox="iframeSandbox"
        :srcdoc="htmlSource"
        :title="panel.title"
        @load="handleFrameLoad"
      />
    </div>

    <p v-else class="extension-webview-panel__empty">Panel removed.</p>
  </section>
</template>

<style scoped lang="scss">
.extension-webview-panel {
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  padding: 0;

  & .session-section__header {
    padding: var(--space-4) var(--space-4) 0;
  }
}

.extension-webview-panel__frame-wrap {
  min-height: 0;
  overflow: hidden;
  background: var(--color-surface);
}

.extension-webview-panel__frame {
  width: 100%;
  height: 100%;
  border: 0;
  background: #fff;
}

.extension-webview-panel__blocked {
  display: grid;
  gap: 0.35rem;
  place-content: center;
  height: 100%;
  padding: 1rem;
  color: var(--color-text);
  text-align: center;
}

.extension-webview-panel__blocked span {
  color: var(--color-text-muted);
  font-size: 0.8125rem;
}

.extension-webview-panel__empty {
  margin: 0;
  color: var(--color-text-muted);
}
</style>
