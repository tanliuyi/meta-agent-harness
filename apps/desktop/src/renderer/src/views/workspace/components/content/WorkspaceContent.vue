<script setup lang="ts">
/**
 * WorkspaceContent.vue - Workspace 中间内容区域组件。
 *
 * 承载会话头部、聊天视图与可拖拽的会话面板，并提供会话上下文。
 */

import ChatView from '@renderer/components/chat/ChatView.vue'
import { BaseIconButton } from '@renderer/components/base'
import SessionHeader from '@renderer/components/session/SessionHeader.vue'
import ResizeDragShield from '@renderer/components/ui/resize-drag-shield/ResizeDragShield.vue'
import {
  provideSessionContext,
  type SessionInfo,
  type SessionPanelState
} from '@renderer/composables/useSessionContext'
import { useResizablePane } from '@renderer/composables/useResizablePane'
import { sessionPanelFullscreenByKey } from '@renderer/stores/session-panel-layout-state'
import useWorkspaceProjectStore from '@renderer/stores/workspace-project'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import { useElementSize } from '@vueuse/core'
import { MessageSquare, PanelBottomClose, PanelBottomOpen } from 'lucide-vue-next'
import type { CSSProperties } from 'vue'
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from 'vue'
import { MIN_WORKSPACE_MAIN_SESSION_WIDTH, WORKSPACE_RESIZER_WIDTH } from '../../workspace-layout'
import {
  clampFloatingChatLayout,
  clampFloatingChatSize,
  FLOATING_CHAT_MIN_HEIGHT,
  FLOATING_CHAT_MIN_WIDTH,
  getFloatingChatResizeLimits,
  resizeFloatingChatWithKeyboard,
  type FloatingChatPoint,
  type FloatingChatResizeLimits,
  type FloatingChatSize
} from './state/floating-chat-layout'
import {
  createStableSessionInfo,
  createStableSessionPanelState
} from './state/workspace-content-state'
import { loadWorkspaceStartupData } from './state/workspace-startup'

const workspaceSession = useWorkspaceSessionStore()
const workspaceProject = useWorkspaceProjectStore()
const SessionPanel = defineAsyncComponent(
  () => import('@renderer/components/session/SessionPanel.vue')
)

/** 内容区容器元素引用。 */
const workspaceContentRef = ref<HTMLElement | null>(null)
const floatingChatRef = ref<HTMLElement | null>(null)
const { height: workspaceContentHeight, width: workspaceContentWidth } =
  useElementSize(workspaceContentRef)
const { height: floatingChatRenderedHeight, width: floatingChatRenderedWidth } =
  useElementSize(floatingChatRef)
const shouldRenderSessionPanel = ref(false)
const isSessionPanelFullscreen = computed({
  get: () => sessionPanelFullscreenByKey.isFullscreen(workspaceSession.activeSessionPanelTabsKey),
  set: (fullscreen: boolean) =>
    sessionPanelFullscreenByKey.setFullscreen(
      workspaceSession.activeSessionPanelTabsKey,
      fullscreen
    )
})
const activeFloatingChatLayout = computed(() =>
  sessionPanelFullscreenByKey.getFloatingChatLayout(workspaceSession.activeSessionPanelTabsKey)
)
const isFloatingChatOpen = computed({
  get: () => activeFloatingChatLayout.value.open,
  set: (open: boolean) =>
    sessionPanelFullscreenByKey.setFloatingChatLayout(workspaceSession.activeSessionPanelTabsKey, {
      open
    })
})
const isFloatingChatDragging = ref(false)
const isFloatingChatResizing = ref(false)
const floatingChatPosition = computed({
  get: (): FloatingChatPoint | null => activeFloatingChatLayout.value.position,
  set: (position: FloatingChatPoint | null) =>
    sessionPanelFullscreenByKey.setFloatingChatLayout(workspaceSession.activeSessionPanelTabsKey, {
      position
    })
})
const floatingChatSize = computed({
  get: (): FloatingChatSize | null => activeFloatingChatLayout.value.size,
  set: (size: FloatingChatSize | null) =>
    sessionPanelFullscreenByKey.setFloatingChatLayout(workspaceSession.activeSessionPanelTabsKey, {
      size
    })
})
let sessionPanelRenderRaf: number | undefined
let stopFloatingChatDrag: (() => void) | undefined
let stopFloatingChatResize: (() => void) | undefined

const floatingChatStyle = computed<CSSProperties>(() => {
  const position = floatingChatPosition.value
  const size = floatingChatSize.value
  const style: CSSProperties = {}
  if (position) {
    style.bottom = 'auto'
    style.left = `${position.x}px`
    style.right = 'auto'
    style.top = `${position.y}px`
  }
  if (size && isFloatingChatOpen.value) {
    style.height = `${size.height}px`
    style.width = `${size.width}px`
  }
  return style
})

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

watch(hasSessionPanelContext, (hasContext) => {
  if (!hasContext) {
    isSessionPanelFullscreen.value = false
  }
})

function toggleSessionPanelFullscreen(): void {
  if (!hasSessionPanelContext.value) return

  isSessionPanelFullscreen.value = !isSessionPanelFullscreen.value
  if (isSessionPanelFullscreen.value) {
    workspaceSession.setActiveSessionPanelOpen(true)
    isFloatingChatOpen.value = true
    void nextTick(clampFloatingChatPosition)
  }
}

function toggleSessionPanel(): void {
  if (isSessionPanelFullscreen.value) {
    isSessionPanelFullscreen.value = false
  }
  workspaceSession.setActiveSessionPanelOpen(!sessionPanel.value.open)
}

function clampFloatingChatPosition(): void {
  const content = workspaceContentRef.value
  const floating = floatingChatRef.value
  if (!content || !floating) return

  const layout = clampFloatingChatLayout({
    container: { height: content.clientHeight, width: content.clientWidth },
    fullscreen: isSessionPanelFullscreen.value,
    position: floatingChatPosition.value,
    renderedSize: { height: floating.offsetHeight, width: floating.offsetWidth },
    size: floatingChatSize.value
  })
  if (!layout) return

  floatingChatPosition.value = layout.position
  floatingChatSize.value = layout.size
}

interface FloatingChatResizeGeometry {
  limits: FloatingChatResizeLimits
  position: FloatingChatPoint
  size: FloatingChatSize
}

function readFloatingChatResizeGeometry(): FloatingChatResizeGeometry | undefined {
  const content = workspaceContentRef.value
  const floating = floatingChatRef.value
  if (!content || !floating) return undefined

  const contentRect = content.getBoundingClientRect()
  const floatingRect = floating.getBoundingClientRect()
  const position = floatingChatPosition.value ?? {
    x: floatingRect.left - contentRect.left,
    y: floatingRect.top - contentRect.top
  }
  const limits = getFloatingChatResizeLimits({
    container: { height: content.clientHeight, width: content.clientWidth },
    position
  })
  return {
    limits,
    position,
    size: clampFloatingChatSize(
      floatingChatSize.value ?? { height: floatingRect.height, width: floatingRect.width },
      limits
    )
  }
}

const floatingChatResizeMetrics = computed(() => {
  void workspaceContentWidth.value
  void workspaceContentHeight.value
  void floatingChatRenderedWidth.value
  void floatingChatRenderedHeight.value
  void isSessionPanelFullscreen.value
  const geometry = readFloatingChatResizeGeometry()
  return (
    geometry ?? {
      limits: {
        maxHeight: FLOATING_CHAT_MIN_HEIGHT,
        maxWidth: FLOATING_CHAT_MIN_WIDTH,
        minHeight: FLOATING_CHAT_MIN_HEIGHT,
        minWidth: FLOATING_CHAT_MIN_WIDTH
      },
      position: { x: 0, y: 0 },
      size: { height: FLOATING_CHAT_MIN_HEIGHT, width: FLOATING_CHAT_MIN_WIDTH }
    }
  )
})

const floatingChatResizeValueText = computed(() => {
  const { height, width } = floatingChatResizeMetrics.value.size
  return `宽 ${Math.round(width)} 像素，高 ${Math.round(height)} 像素；左右键调整宽度，上下键调整高度`
})

function startFloatingChatDrag(event: PointerEvent): void {
  if (!isSessionPanelFullscreen.value) return
  if (event.target instanceof Element && event.target.closest('button')) return

  const content = workspaceContentRef.value
  const floating = floatingChatRef.value
  const handle = event.currentTarget
  if (!content || !floating || !(handle instanceof HTMLElement)) return

  event.preventDefault()
  stopFloatingChatDrag?.()
  stopFloatingChatResize?.()

  const contentRect = content.getBoundingClientRect()
  const floatingRect = floating.getBoundingClientRect()
  const pointerOffsetX = event.clientX - floatingRect.left
  const pointerOffsetY = event.clientY - floatingRect.top
  const pointerId = event.pointerId
  isFloatingChatDragging.value = true
  handle.setPointerCapture(pointerId)

  const handlePointerMove = (moveEvent: PointerEvent): void => {
    if (moveEvent.pointerId !== pointerId) return
    const margin = 12
    const maxX = Math.max(margin, contentRect.width - floating.offsetWidth - margin)
    const maxY = Math.max(margin, contentRect.height - floating.offsetHeight - margin)
    floatingChatPosition.value = {
      x: Math.min(Math.max(margin, moveEvent.clientX - contentRect.left - pointerOffsetX), maxX),
      y: Math.min(Math.max(margin, moveEvent.clientY - contentRect.top - pointerOffsetY), maxY)
    }
  }

  const finishDrag = (finishEvent?: PointerEvent): void => {
    if (finishEvent && finishEvent.pointerId !== pointerId) return
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', finishDrag)
    window.removeEventListener('pointercancel', finishDrag)
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
    isFloatingChatDragging.value = false
    stopFloatingChatDrag = undefined
  }

  stopFloatingChatDrag = finishDrag
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', finishDrag)
  window.addEventListener('pointercancel', finishDrag)
}

function startFloatingChatResize(event: PointerEvent): void {
  if (!isSessionPanelFullscreen.value || !isFloatingChatOpen.value) return

  const handle = event.currentTarget
  const geometry = readFloatingChatResizeGeometry()
  if (!geometry || !(handle instanceof HTMLElement)) return

  event.preventDefault()
  stopFloatingChatDrag?.()
  stopFloatingChatResize?.()

  const pointerId = event.pointerId
  const startX = event.clientX
  const startY = event.clientY
  const startSize = geometry.size

  floatingChatPosition.value = geometry.position
  floatingChatSize.value = startSize
  isFloatingChatResizing.value = true
  handle.setPointerCapture(pointerId)

  const handlePointerMove = (moveEvent: PointerEvent): void => {
    if (moveEvent.pointerId !== pointerId) return
    floatingChatSize.value = clampFloatingChatSize(
      {
        height: startSize.height + moveEvent.clientY - startY,
        width: startSize.width + moveEvent.clientX - startX
      },
      geometry.limits
    )
  }

  const finishResize = (finishEvent?: PointerEvent): void => {
    if (finishEvent && finishEvent.pointerId !== pointerId) return
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', finishResize)
    window.removeEventListener('pointercancel', finishResize)
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
    isFloatingChatResizing.value = false
    stopFloatingChatResize = undefined
    clampFloatingChatPosition()
  }

  stopFloatingChatResize = finishResize
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', finishResize)
  window.addEventListener('pointercancel', finishResize)
}

function handleFloatingChatResizeKeydown(event: KeyboardEvent): void {
  if (!isSessionPanelFullscreen.value || !isFloatingChatOpen.value) return

  const geometry = readFloatingChatResizeGeometry()
  if (!geometry) return
  const nextSize = resizeFloatingChatWithKeyboard({
    key: event.key,
    limits: geometry.limits,
    shiftKey: event.shiftKey,
    size: geometry.size
  })
  if (!nextSize) return

  event.preventDefault()
  stopFloatingChatDrag?.()
  stopFloatingChatResize?.()
  floatingChatPosition.value = geometry.position
  floatingChatSize.value = nextSize
  void nextTick(clampFloatingChatPosition)
}

watch([workspaceContentWidth, workspaceContentHeight, isFloatingChatOpen], () => {
  void nextTick(clampFloatingChatPosition)
})

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

/** 组件挂载时加载 Project 与当前 Project 下的 thread。 */
onMounted(() => {
  sessionPanelRenderRaf = requestAnimationFrame(() => {
    sessionPanelRenderRaf = undefined
    shouldRenderSessionPanel.value = true
  })

  void loadWorkspaceStartupData({
    loadProjects: workspaceProject.loadProjects,
    loadThreads: workspaceSession.loadThreads
  })
})

onBeforeUnmount(() => {
  stopFloatingChatDrag?.()
  stopFloatingChatResize?.()
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
      'workspace-content--session-panel-open': isSessionPanelOpen,
      'workspace-content--session-panel-fullscreen': isSessionPanelFullscreen,
      'workspace-content--floating-chat-collapsed': isSessionPanelFullscreen && !isFloatingChatOpen
    }"
    :style="workspaceContentStyle"
  >
    <div
      ref="floatingChatRef"
      class="workspace-content__main-session"
      :class="{
        'workspace-content__main-session--dragging': isFloatingChatDragging,
        'workspace-content__main-session--resizing': isFloatingChatResizing
      }"
      :style="isSessionPanelFullscreen ? floatingChatStyle : undefined"
    >
      <div v-show="!isSessionPanelFullscreen" class="workspace-content__session-header">
        <SessionHeader />
      </div>
      <div class="workspace-content__floating-chat-header" @pointerdown="startFloatingChatDrag">
        <div class="workspace-content__floating-chat-title">
          <MessageSquare :size="15" aria-hidden="true" />
          <span>对话</span>
        </div>
        <BaseIconButton
          size="small"
          :label="isFloatingChatOpen ? '收起对话浮窗' : '展开对话浮窗'"
          @click="isFloatingChatOpen = !isFloatingChatOpen"
        >
          <PanelBottomClose v-if="isFloatingChatOpen" :size="15" />
          <PanelBottomOpen v-else :size="15" />
        </BaseIconButton>
      </div>
      <ChatView class="workspace-content__chat" />
      <div
        v-if="isSessionPanelFullscreen && isFloatingChatOpen"
        class="workspace-content__floating-chat-resize"
        role="separator"
        aria-label="调整对话浮窗大小"
        aria-orientation="vertical"
        :aria-valuemin="Math.round(floatingChatResizeMetrics.limits.minWidth)"
        :aria-valuemax="Math.round(floatingChatResizeMetrics.limits.maxWidth)"
        :aria-valuenow="Math.round(floatingChatResizeMetrics.size.width)"
        :aria-valuetext="floatingChatResizeValueText"
        tabindex="0"
        @pointerdown.stop="startFloatingChatResize"
        @keydown="handleFloatingChatResizeKeydown"
      />
    </div>

    <div
      v-if="isSessionPanelOpen && !isSessionPanelFullscreen"
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
      :class="{
        'workspace-content__session-panel--collapsed': !isSessionPanelOpen,
        'workspace-content__session-panel--fullscreen': isSessionPanelFullscreen
      }"
      :collapsed="!isSessionPanelOpen && !isSessionPanelFullscreen"
      :disabled="!hasSessionPanelContext"
      :fullscreen="isSessionPanelFullscreen"
      @toggle="toggleSessionPanel"
      @toggle-fullscreen="toggleSessionPanelFullscreen"
    />
  </section>
</template>

<style lang="scss" scoped>
.workspace-content {
  --session-panel-layout-width: min(
    var(--session-panel-width, 420px),
    max(
      0px,
      calc(
        100% - var(--workspace-main-session-min-width, 360px) - var(
            --session-panel-resizer-width,
            1px
          )
      )
    )
  );

  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  z-index: 2;
  overflow: visible;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  // border-radius: var(--radius-workspace-shell) 0 0 var(--radius-workspace-shell);
}

.workspace-content__main-session {
  display: grid;
  grid-template-rows: var(--session-header-height) minmax(0, 1fr);
  width: 100%;
  max-width: 100%;
  min-width: min(100%, var(--workspace-main-session-min-width, 360px));
  min-height: 0;
  overflow: hidden;
}

.workspace-content__floating-chat-header {
  display: none;
}

.workspace-content--session-panel-open .workspace-content__main-session {
  width: max(
    0px,
    calc(100% - var(--session-panel-layout-width) - var(--session-panel-resizer-width, 1px))
  );
}

.workspace-content__session-header {
  position: relative;
  min-width: 0;
  min-height: 0;

  :deep(.session-header) {
    height: 100%;
  }

  &::after {
    content: ' ';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--color-border-muted);
    opacity: 0.4;
  }
}

.workspace-content__chat,
.workspace-content__session-panel {
  min-width: 0;
  min-height: 0;
}

.workspace-content__chat {
  width: 100%;
  // max-width: 768px;
  margin: 0 auto;
}

.workspace-content__session-panel:not(.workspace-content__session-panel--collapsed) {
  position: absolute;
  z-index: 3;
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--session-panel-layout-width);
  background-color: var(--color-surface);
}

.workspace-content--session-panel-fullscreen {
  .workspace-content__session-panel--fullscreen {
    inset: 0;
    z-index: 3;
    width: 100%;
  }

  .workspace-content__main-session {
    position: absolute;
    right: var(--space-4);
    bottom: var(--space-4);
    z-index: 5;
    display: grid;
    grid-template-rows: 36px minmax(0, 1fr);
    width: clamp(400px, 32%, 460px);
    height: min(78%, 760px);
    min-width: 0;
    overflow: visible;
    background: color-mix(in srgb, var(--color-surface) 96%, transparent);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    backdrop-filter: blur(14px);
    transition:
      width var(--duration-base) var(--ease-standard),
      height var(--duration-base) var(--ease-standard),
      box-shadow var(--duration-fast) var(--ease-standard);
  }

  .workspace-content__session-header {
    display: none;
  }

  .workspace-content__floating-chat-header {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-width: 0;
    padding: 0 var(--space-2) 0 var(--space-3);
    background: var(--color-surface-raised);
    border-bottom: 1px solid var(--color-border-muted);
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }

  .workspace-content__main-session--dragging,
  .workspace-content__main-session--resizing {
    transition: none;
  }

  .workspace-content__main-session--dragging {
    .workspace-content__floating-chat-header {
      cursor: grabbing;
    }
  }

  .workspace-content__floating-chat-resize {
    position: absolute;
    right: -12px;
    bottom: -12px;
    z-index: 3;
    width: 26px;
    height: 26px;
    padding: 0;
    background: transparent;
    border: 0;
    cursor: nwse-resize;
    touch-action: none;

    &::after {
      position: absolute;
      right: 2px;
      bottom: 2px;
      width: 12px;
      height: 12px;
      content: '';
      border-right: 3.5px solid var(--color-text-subtle);
      border-bottom: 3.5px solid var(--color-text-subtle);
      border-radius: 0 0 10px 0;
      transition: border-color var(--duration-fast) var(--ease-standard);
    }

    &:hover::after,
    &:focus-visible::after {
      border-color: var(--color-primary-strong);
    }

    &:focus-visible {
      outline: none;
    }
  }

  .workspace-content__floating-chat-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-xs);
    font-weight: 650;
  }

  .workspace-content__chat {
    position: relative;
    z-index: 1;
    width: 100%;
    min-height: 0;
    overflow: hidden;
    border-radius: 0 0 var(--radius-md) var(--radius-md);
    opacity: 1;
    visibility: visible;
    transition:
      opacity var(--duration-fast) var(--ease-standard),
      visibility var(--duration-fast) var(--ease-standard);
  }
}

.workspace-content--floating-chat-collapsed .workspace-content__main-session {
  grid-template-rows: 36px 0;
  width: 112px;
  height: 36px;

  .workspace-content__chat {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
  }
}

.workspace-content__session-panel--collapsed {
  position: absolute;
  z-index: 3;
  top: 0;
  right: 0;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  width: var(--session-panel-actions-width);
  height: var(--session-header-height);
}

.workspace-content--resizing-session-panel :deep(webview),
.workspace-content--resizing-session-panel :deep(iframe) {
  pointer-events: none;
}

.workspace-content__session-panel-resizer {
  position: absolute;
  z-index: 4;
  top: 0;
  right: var(--session-panel-layout-width);
  bottom: 0;
  width: var(--session-panel-resizer-width, 1px);
  cursor: col-resize;
  touch-action: none;

  &::before {
    position: absolute;
    inset: 0 auto 0 0;
    width: 1px;
    background: var(--color-border);
    content: '';
    transition:
      background-color var(--duration-fast) var(--ease-standard),
      box-shadow var(--duration-fast) var(--ease-standard);
    transition-delay: 180ms;
  }

  &::after {
    position: absolute;
    inset: 0 -4px;
    content: '';
  }

  &:hover::before,
  &:focus-visible::before,
  &--active::before {
    background: var(--color-primary);
    box-shadow: var(--shadow-primary-halo);
  }

  &:focus-visible {
    outline: none;
  }

  &:focus-visible::before,
  &--active::before {
    transition-delay: 0ms;
  }
}

@media (width <= 820px) {
  .workspace-content {
    grid-template-columns: 1fr;
    padding: var(--space-5);
  }

  .workspace-content__main-session {
    width: 100%;
  }

  .workspace-content__session-panel-resizer {
    display: none;
  }

  .workspace-content__session-panel:not(.workspace-content__session-panel--collapsed) {
    position: absolute;
    z-index: 20;
    inset: 0;
    display: flex;
    width: 100%;
    background: var(--color-surface);
  }

  .workspace-content--session-panel-fullscreen {
    padding: 0;

    .workspace-content__session-panel--fullscreen {
      z-index: 3;
    }

    .workspace-content__main-session {
      right: var(--space-3);
      bottom: var(--space-3);
      width: min(400px, calc(100% - var(--space-6)));
      height: min(72%, 620px);
    }
  }

  .workspace-content--floating-chat-collapsed .workspace-content__main-session {
    width: 112px;
    height: 36px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .workspace-content--session-panel-fullscreen .workspace-content__main-session,
  .workspace-content--session-panel-fullscreen .workspace-content__chat {
    transition: none;
  }
}
</style>
