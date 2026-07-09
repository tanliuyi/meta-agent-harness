<script setup lang="ts">
/**
 * WorkspaceContent.vue - Workspace 中间内容区域组件。
 *
 * 承载会话头部、聊天视图与可拖拽的会话面板，并提供会话上下文。
 */

import ChatView from '@renderer/components/chat/ChatView.vue'
import SessionHeader from '@renderer/components/session/SessionHeader.vue'
import {
  provideSessionContext,
  type SessionInfo,
  type SessionPanelState
} from '@renderer/composables/useSessionContext'
import { useResizablePane } from '@renderer/composables/useResizablePane'
import useWorkspaceProjectStore from '@renderer/stores/workspace-project'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  createStableSessionInfo,
  createStableSessionPanelState
} from './state/workspace-content-state'
import { loadWorkspaceStartupData } from './state/workspace-startup'

/** 分隔条宽度（像素）。 */
const RESIZER_WIDTH = 1

const workspaceSession = useWorkspaceSessionStore()
const workspaceProject = useWorkspaceProjectStore()
const SessionPanel = defineAsyncComponent(
  () => import('@renderer/components/session/SessionPanel.vue')
)

/** 内容区容器元素引用。 */
const workspaceContentRef = ref<HTMLElement | null>(null)
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

/** 内容区布局变量。 */
const workspaceContentStyle = computed(() => ({
  '--session-panel-resizer-width': `${RESIZER_WIDTH}px`,
  '--session-panel-width': `${sessionPanel.value.width}px`
}))

function getSessionPanelLayoutMaxWidth(): number {
  const contentWidth = workspaceContentRef.value?.getBoundingClientRect().width
  if (!contentWidth) {
    return Number.MAX_SAFE_INTEGER
  }
  return Math.max(sessionPanel.value.minWidth, contentWidth - RESIZER_WIDTH)
}

function clampSessionPanelWidth(width: number): number {
  return Math.min(getSessionPanelLayoutMaxWidth(), Math.max(sessionPanel.value.minWidth, width))
}

/**
 * 向子组件提供会话上下文。
 */
provideSessionContext({
  panel: sessionPanel,
  session: sessionInfo,
  setPanelOpen: workspaceSession.setActiveSessionPanelOpen,
  setPanelWidth: workspaceSession.setActiveSessionPanelWidth
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
      'workspace-content--session-panel-open': sessionPanel.open
    }"
    :style="workspaceContentStyle"
  >
    <div class="workspace-content__main-session">
      <SessionHeader class="workspace-content__session-header" />
      <ChatView class="workspace-content__chat" />
    </div>

    <div
      v-if="sessionPanel.open"
      class="workspace-content__session-panel-resizer"
      :class="{ 'workspace-content__session-panel-resizer--active': isSessionPanelResizing }"
      role="separator"
      aria-label="调整会话面板宽度"
      aria-orientation="vertical"
      :aria-valuemin="sessionPanel.minWidth"
      :aria-valuemax="sessionPanel.maxWidth ?? undefined"
      :aria-valuenow="sessionPanel.width"
      tabindex="0"
      @pointerdown="startSessionPanelResize"
      @keydown="handleSessionPanelResizerKeydown"
    />

    <SessionPanel
      v-if="shouldRenderSessionPanel"
      class="workspace-content__session-panel"
      :class="{ 'workspace-content__session-panel--collapsed': !sessionPanel.open }"
      :collapsed="!sessionPanel.open"
      @toggle="workspaceSession.setActiveSessionPanelOpen(!sessionPanel.open)"
    />
  </section>
</template>

<style lang="scss" scoped>
.workspace-content {
  --session-panel-layout-width: min(
    var(--session-panel-width, 420px),
    calc(100% - var(--session-panel-resizer-width, 1px))
  );

  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  z-index: 2;
  overflow: visible;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-workspace-shell) 0 0 var(--radius-workspace-shell);
}

.workspace-content__main-session {
  display: grid;
  grid-template-rows: var(--session-header-height) minmax(0, 1fr);
  width: 100%;
  min-width: 0;
  min-height: 0;
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

.workspace-content--resizing-session-panel :deep(.extension-webview-panel__frame) {
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

  .workspace-content__session-panel-resizer,
  .workspace-content__session-panel {
    display: none;
  }
}
</style>
