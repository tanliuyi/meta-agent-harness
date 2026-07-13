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
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import {
  cloneExtensionPanelMessage,
  getNextExtensionPanelViewState,
  handleExtensionPanelHostMessage,
  postExtensionPanelMessage,
  postExtensionPanelState,
  postExtensionPanelTheme,
  postExtensionPanelVisibility
} from './display/extensionPanelHostBridge'
import {
  collectExtensionPanelThemePayload,
  getExtensionPanelAllowedNavigationOrigin,
  getExtensionPanelResolvedUrl,
  getExtensionPanelSandboxForAccess,
  prepareExtensionPanelHtml,
  prepareExtensionPanelUrlHost
} from './display/extensionPanelDisplay'

const props = defineProps<{
  panelId?: string
  threadId?: string
  visible?: boolean
}>()

const route = useRoute()
const workspaceSession = useWorkspaceSessionStore()
const agentSettings = useAgentSettingsStore()
const { resolvedTheme } = useTheme()
const frameRef = ref<HTMLIFrameElement | null>(null)
const componentActive = ref(false)
const panelThreadId = props.threadId ?? workspaceSession.activeSessionId
const lastVisibleState = ref<boolean | undefined>(undefined)
let messageListenerAttached = false
const panelRuntime = computed(() =>
  panelThreadId ? workspaceSession.runtimeByThreadId[panelThreadId] : undefined
)
const panel = computed(() =>
  props.panelId ? panelRuntime.value?.extensionPanels[props.panelId] : undefined
)
const panelMessage = computed(() =>
  props.panelId ? panelRuntime.value?.extensionPanelMessages[props.panelId] : undefined
)
const panelState = computed(() =>
  props.panelId ? panelRuntime.value?.extensionPanelStates[props.panelId] : undefined
)
const unrestrictedUrlAccess = computed(
  () => agentSettings.snapshot?.safety.extensionUrlAccess === 'full'
)
const iframeSandbox = computed(() =>
  getExtensionPanelSandboxForAccess(panel.value, unrestrictedUrlAccess.value)
)
const urlHostHtml = computed(() =>
  unrestrictedUrlAccess.value ? '' : prepareExtensionPanelUrlHost(panel.value)
)
const urlHostSource = computed(() =>
  unrestrictedUrlAccess.value
    ? (getExtensionPanelResolvedUrl(panel.value) ?? '')
    : urlHostHtml.value
      ? `data:text/html;charset=utf-8,${encodeURIComponent(urlHostHtml.value)}`
      : ''
)
const allowedNavigationOrigin = computed(() =>
  getExtensionPanelAllowedNavigationOrigin(panel.value)
)
const navigationBlocked = computed(
  () => panel.value?.source.type === 'url' && urlHostSource.value.length === 0
)
const panelVisible = computed(
  () =>
    componentActive.value &&
    props.visible !== false &&
    panelThreadId === workspaceSession.activeSessionId &&
    isWorkspaceRouteName(route.name)
)
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
    threadId: panelThreadId,
    panel: panel.value,
    hostActive: panelVisible.value,
    navigationBlocked: navigationBlocked.value,
    event,
    frameWindow: frameRef.value?.contentWindow,
    unrestrictedUrlAccess: unrestrictedUrlAccess.value,
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
    message: panelMessage.value,
    unrestrictedUrlAccess: unrestrictedUrlAccess.value
  })
}

function postPanelState(): void {
  postExtensionPanelState({
    target: frameRef.value?.contentWindow,
    panel: panel.value,
    navigationBlocked: navigationBlocked.value,
    state: panelState.value,
    unrestrictedUrlAccess: unrestrictedUrlAccess.value
  })
}

function postPanelTheme(): void {
  postExtensionPanelTheme({
    target: frameRef.value?.contentWindow,
    panel: panel.value,
    navigationBlocked: navigationBlocked.value,
    theme: panelTheme.value,
    unrestrictedUrlAccess: unrestrictedUrlAccess.value
  })
}

function postPanelVisibility(visible: boolean): void {
  postExtensionPanelVisibility({
    target: frameRef.value?.contentWindow,
    panel: panel.value,
    navigationBlocked: navigationBlocked.value,
    visible,
    unrestrictedUrlAccess: unrestrictedUrlAccess.value
  })
}

function sendPanelViewState(visible: boolean): void {
  const threadId = panelThreadId
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

function handleFrameLoad(): void {
  if (navigationBlocked.value) {
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

watch(panelTheme, async () => {
  await nextTick()
  postPanelTheme()
})

function setMessageListenerEnabled(enabled: boolean): void {
  if (enabled === messageListenerAttached) return
  messageListenerAttached = enabled
  if (enabled) window.addEventListener('message', handleWindowMessage)
  else window.removeEventListener('message', handleWindowMessage)
}

function syncPanelActivation(visible: boolean): void {
  if (visible) setMessageListenerEnabled(true)
  setPanelVisible(visible)
  if (!visible) setMessageListenerEnabled(false)
}

watch(panelVisible, syncPanelActivation, { flush: 'sync' })

onMounted(() => {
  if (!agentSettings.snapshot) void agentSettings.load()
  componentActive.value = true
  if (!panelVisible.value) {
    syncPanelActivation(false)
  }
})
onActivated(() => {
  componentActive.value = true
})
onDeactivated(() => {
  componentActive.value = false
})
onBeforeUnmount(() => {
  componentActive.value = false
  setMessageListenerEnabled(false)
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
        :src="urlHostSource"
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
