<script setup lang="ts">
/**
 * WorkspaceContent.vue - Workspace 中间内容区域组件。
 *
 * 承载会话头部、聊天视图与可拖拽的会话面板，并提供会话上下文。
 */

import ChatView from '@renderer/components/chat/ChatView.vue'
import SessionHeader from '@renderer/components/session/SessionHeader.vue'
import SessionPanel from '@renderer/components/session/SessionPanel.vue'
import {
  provideSessionContext,
  type SessionInfo,
  type SessionPanelState
} from '@renderer/composables/useSessionContext'
import { useResizablePane } from '@renderer/composables/useResizablePane'
import useWorkspaceProjectStore from '@renderer/stores/workspace-project'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import { computed, onMounted, ref } from 'vue'
import {
  createStableSessionInfo,
  createStableSessionPanelState
} from './state/workspace-content-state'
import { loadWorkspaceStartupData } from './state/workspace-startup'

/** 分隔条宽度（像素）。 */
const RESIZER_WIDTH = 1

const workspaceSession = useWorkspaceSessionStore()
const workspaceProject = useWorkspaceProjectStore()

/** 内容区容器元素引用。 */
const workspaceContentRef = ref<HTMLElement | null>(null)

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

/** 内容区网格列模板。 */
const workspaceContentColumns = computed(() => {
  if (!sessionPanel.value.open) {
    return 'minmax(0, 1fr)'
  }

  return `minmax(0, 1fr) ${RESIZER_WIDTH}px ${sessionPanel.value.width}px`
})

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
onMounted(async () => {
  await loadWorkspaceStartupData({
    loadProjects: workspaceProject.loadProjects,
    loadThreads: workspaceSession.loadThreads
  })
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

    return contentRect.right - event.clientX
  },
  getValue: computed(() => sessionPanel.value.width),
  setValue: workspaceSession.setActiveSessionPanelWidth
})
</script>

<template>
  <section
    ref="workspaceContentRef"
    class="workspace-content"
    :style="{ gridTemplateColumns: workspaceContentColumns }"
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
      :aria-valuemax="sessionPanel.maxWidth"
      :aria-valuenow="sessionPanel.width"
      tabindex="0"
      @pointerdown="startSessionPanelResize"
      @keydown="handleSessionPanelResizerKeydown"
    />

    <SessionPanel
      class="workspace-content__session-panel"
      :class="{ 'workspace-content__session-panel--collapsed': !sessionPanel.open }"
      :collapsed="!sessionPanel.open"
      @toggle="workspaceSession.setActiveSessionPanelOpen(!sessionPanel.open)"
    />
  </section>
</template>

<style lang="scss" scoped>
.workspace-content {
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-workspace-shell) 0 0 var(--radius-workspace-shell);
}

.workspace-content__main-session {
  display: grid;
  grid-template-rows: var(--session-header-height) minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
}

.workspace-content__session-header {
  min-width: 0;
  min-height: 0;
  border-bottom: 1px solid var(--color-border-muted);
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

.workspace-content__session-panel--collapsed {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  width: var(--session-panel-actions-width);
  height: var(--session-header-height);
}

.workspace-content__session-panel-resizer {
  position: relative;
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

  .workspace-content__session-panel-resizer,
  .workspace-content__session-panel {
    display: none;
  }
}
</style>
