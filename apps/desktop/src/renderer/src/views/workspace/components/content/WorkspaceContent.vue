<script setup lang="ts">
/**
 * WorkspaceContent.vue - Workspace 中间内容区域组件。
 *
 * 承载会话头部、聊天视图与可拖拽的会话面板，并提供会话上下文。
 */

import ChatView from '@renderer/components/chat/ChatView.vue'
import SessionHeader from '@renderer/components/session/SessionHeader.vue'
import ResizeDragShield from '@renderer/components/ui/resize-drag-shield/ResizeDragShield.vue'
import {
  provideSessionContext,
  type SessionInfo,
  type SessionPanelState
} from '@renderer/composables/useSessionContext'
import { useResizablePane } from '@renderer/composables/useResizablePane'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import {
  isWorkspaceRouteName,
  WORKSPACE_SESSION_ROUTE_NAME
} from '@renderer/router/workspace-route-host'
import { useElementSize } from '@vueuse/core'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MIN_WORKSPACE_MAIN_SESSION_WIDTH, WORKSPACE_RESIZER_WIDTH } from '../../workspace-layout'
import {
  createStableSessionInfo,
  createStableSessionPanelState
} from './state/workspace-content-state'

const workspaceSession = useWorkspaceSessionStore()
const route = useRoute()
const router = useRouter()
const startupReady = ref(false)
const SessionPanel = defineAsyncComponent(
  () => import('@renderer/components/session/SessionPanel.vue')
)

// workspaceSession.loadThreads(undefined, { deferActiveSnapshot: true, restoreActiveThread: false })

/** 内容区容器元素引用。 */
const workspaceContentRef = ref<HTMLElement | null>(null)
const { width: workspaceContentWidth } = useElementSize(workspaceContentRef)
const shouldRenderSessionPanel = ref(false)
let sessionPanelRenderRaf: number | undefined

/** 当前活跃会话对象。 */
const activeSession = computed(() => workspaceSession.activeSession)

/** 当前会话面板状态。 */
const sessionPanel = computed<SessionPanelState>((previous) =>
  createStableSessionPanelState(
    {
      maxWidth: workspaceSession.maxSessionPanelWidth,
      minWidth: workspaceSession.minSessionPanelWidth,
      panel: workspaceSession.activeSessionPanel
    },
    previous
  )
)

const sessionInfo = computed<SessionInfo>((previous) =>
  createStableSessionInfo(activeSession.value, previous)
)

const hasSessionPanelContext = computed(
  () => Boolean(activeSession.value) || workspaceSession.isNewSessionActive
)
const isSessionPanelOpen = computed(() => hasSessionPanelContext.value && sessionPanel.value.open)

function toggleSessionPanel(): void {
  workspaceSession.setActiveSessionPanelOpen(!sessionPanel.value.open)
}

/** SessionPanel 在保留主会话最小宽度后可使用的最大宽度。 */
const sessionPanelLayoutMaxWidth = computed(() => {
  if (!workspaceContentWidth.value) {
    return sessionPanel.value.maxWidth ?? Number.MAX_SAFE_INTEGER
  }

  const availableWidth =
    workspaceContentWidth.value - WORKSPACE_RESIZER_WIDTH - MIN_WORKSPACE_MAIN_SESSION_WIDTH

  return Math.max(0, Math.min(sessionPanel.value.maxWidth ?? availableWidth, availableWidth))
})

function clampSessionPanelWidth(width: number): number {
  return Math.min(sessionPanelLayoutMaxWidth.value, Math.max(sessionPanel.value.minWidth, width))
}

const sessionPanelLayoutWidth = computed(() => clampSessionPanelWidth(sessionPanel.value.width))
const sessionPanelLayoutMinWidth = computed(() =>
  Math.min(sessionPanel.value.minWidth, sessionPanelLayoutMaxWidth.value)
)

/** 内容区布局变量。 */
const workspaceContentStyle = computed(() => ({
  '--workspace-main-session-min-width': `${MIN_WORKSPACE_MAIN_SESSION_WIDTH}px`,
  '--session-panel-resizer-width': `${WORKSPACE_RESIZER_WIDTH}px`,
  '--session-panel-width': `${sessionPanelLayoutWidth.value}px`
}))

/**
 * 向子组件提供会话上下文。
 */
provideSessionContext({
  panel: sessionPanel,
  session: sessionInfo,
  setPanelOpen: workspaceSession.setActiveSessionPanelOpen,
  setPanelWidth: (width) =>
    workspaceSession.setActiveSessionPanelWidth(clampSessionPanelWidth(width))
})

const routeSessionId = computed(() => {
  const sessionId = route.params.sessionId
  return isWorkspaceRouteName(route.name) && typeof sessionId === 'string' ? sessionId : undefined
})

async function activateRouteSession(sessionId: string | undefined): Promise<void> {
  if (!startupReady.value || !sessionId) return

  if (sessionId === 'new') {
    workspaceSession.setContextActiveThreadId(undefined)
    return
  }

  if (!workspaceSession.sessions[sessionId]) {
    workspaceSession.setContextActiveThreadId(undefined)
    await router.replace({
      name: WORKSPACE_SESSION_ROUTE_NAME,
      params: { sessionId: 'new' }
    })
    return
  }

  if (workspaceSession.activeSessionId !== sessionId) {
    await workspaceSession.setActiveSessionId(sessionId)
  }
}

watch(routeSessionId, (sessionId) => {
  void activateRouteSession(sessionId)
})

watch(
  () => workspaceSession.activeSessionId,
  (sessionId) => {
    if (!startupReady.value || !isWorkspaceRouteName(route.name)) return

    const nextSessionId = sessionId ?? 'new'
    if (routeSessionId.value === nextSessionId) return

    void router.replace({
      name: WORKSPACE_SESSION_ROUTE_NAME,
      params: { sessionId: nextSessionId }
    })
  }
)

/** 组件挂载时加载 Project、thread metadata，并激活路由指定的会话。 */
onMounted(async () => {
  sessionPanelRenderRaf = requestAnimationFrame(() => {
    sessionPanelRenderRaf = undefined
    shouldRenderSessionPanel.value = true
  })

  activateRouteSession(routeSessionId.value)
})

onBeforeUnmount(() => {
  if (sessionPanelRenderRaf !== undefined) {
    cancelAnimationFrame(sessionPanelRenderRaf)
  }
})

/**
 * 创建会话面板可拖拽调整大小的行为。
 */
const {
  handleResizerKeydown: handleSessionPanelResizerKeydown,
  isResizing: isSessionPanelResizing,
  startResize: startSessionPanelResize
} = useResizablePane({
  getPointerValue: (event) => {
    const contentRect = workspaceContentRef.value?.getBoundingClientRect()

    if (!contentRect) {
      return sessionPanel.value.width
    }

    return clampSessionPanelWidth(contentRect.right - event.clientX)
  },
  getValue: computed(() => clampSessionPanelWidth(sessionPanel.value.width)),
  setValue: (width) => workspaceSession.setActiveSessionPanelWidth(clampSessionPanelWidth(width))
})
</script>

<template>
  <section
    ref="workspaceContentRef"
    class="workspace-content"
    :class="{
      'workspace-content--resizing-session-panel': isSessionPanelResizing,
      'workspace-content--session-panel-open': isSessionPanelOpen
    }"
    :style="workspaceContentStyle"
  >
    <div class="workspace-content__main-session">
      <div class="workspace-content__session-header">
        <SessionHeader />
      </div>
      <ChatView class="workspace-content__chat" />
    </div>

    <div
      v-if="isSessionPanelOpen"
      class="workspace-content__session-panel-resizer"
      :class="{ 'workspace-content__session-panel-resizer--active': isSessionPanelResizing }"
      role="separator"
      aria-label="调整会话面板宽度"
      aria-orientation="vertical"
      :aria-valuemin="sessionPanelLayoutMinWidth"
      :aria-valuemax="sessionPanelLayoutMaxWidth"
      :aria-valuenow="sessionPanelLayoutWidth"
      tabindex="0"
      @pointerdown="startSessionPanelResize"
      @keydown="handleSessionPanelResizerKeydown"
    />

    <ResizeDragShield v-if="isSessionPanelResizing" />

    <SessionPanel
      v-if="shouldRenderSessionPanel"
      class="workspace-content__session-panel"
      :class="{ 'workspace-content__session-panel--collapsed': !isSessionPanelOpen }"
      :collapsed="!isSessionPanelOpen"
      :disabled="!hasSessionPanelContext"
      @toggle="toggleSessionPanel"
    />
  </section>
</template>

<style lang="scss" scoped>
@use './workspace.scss' as *;
</style>
