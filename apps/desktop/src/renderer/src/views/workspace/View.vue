<script setup lang="ts">
/**
 * View.vue - Workspace 页面主布局组件。
 *
 * 组合左侧边栏、可拖拽分隔条与右侧内容区，管理整体布局网格。
 */

import WindowDragStrip from '@renderer/components/window-drag-strip/WindowDragStrip.vue'
import ResizablePaneSeparator from '@renderer/components/ui/resizable-pane-separator/ResizablePaneSeparator.vue'
import { useAppStore } from '@renderer/stores/app'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import useWorkspaceUiStore from '@renderer/stores/workspace-ui'
import { useElementSize } from '@vueuse/core'
import { computed, ref } from 'vue'
import WorkspaceContent from './components/content/WorkspaceContent.vue'
import Sidebar from './components/sidebar/Sidebar.vue'
import { MIN_WORKSPACE_MAIN_SESSION_WIDTH, WORKSPACE_RESIZER_WIDTH } from './workspace-layout'

const app = useAppStore()
const workspaceSession = useWorkspaceSessionStore()
const workspaceUi = useWorkspaceUiStore()
const workspaceRef = ref<HTMLElement | null>(null)
const { width: workspaceWidth } = useElementSize(workspaceRef)

const isSessionPanelOpen = computed(
  () => Boolean(workspaceSession.activeSession) && workspaceSession.activeSessionPanel.panelOpen
)

const sessionPanelOccupiedWidth = computed(() => {
  if (!isSessionPanelOpen.value) {
    return 0
  }

  return workspaceSession.activeSessionPanel.panelWidth + WORKSPACE_RESIZER_WIDTH
})

const workspaceSidebarMaxWidth = computed(() => {
  if (!workspaceWidth.value) {
    return workspaceUi.maxSidebarWidth
  }

  const availableWidth =
    workspaceWidth.value -
    WORKSPACE_RESIZER_WIDTH -
    MIN_WORKSPACE_MAIN_SESSION_WIDTH -
    sessionPanelOccupiedWidth.value

  return Math.min(
    workspaceUi.maxSidebarWidth,
    Math.max(workspaceUi.minSidebarWidth, availableWidth)
  )
})

const workspaceSidebarLayoutWidth = computed(() =>
  Math.min(workspaceUi.sidebarWidth, workspaceSidebarMaxWidth.value)
)

/** 当前工作区网格列模板。 */
const workspaceGridColumns = computed(() => {
  return `${workspaceSidebarLayoutWidth.value}px ${WORKSPACE_RESIZER_WIDTH}px minmax(0, 1fr)`
})

/** 当前工作区网格行模板：macOS 留出顶部拖拽条，Windows/Linux 不需要。 */
const workspaceGridRows = computed(() => {
  return app.isMac ? '32px 1fr' : '1fr'
})

/** 当前工作区网格区域。 */
const workspaceGridAreas = computed(() => {
  return app.isMac
    ? `'drag-strip resizer content' 'sidebar resizer content'`
    : `'sidebar resizer content'`
})
</script>

<template>
  <main
    ref="workspaceRef"
    class="workspace"
    :style="{
      gridTemplateColumns: workspaceGridColumns,
      gridTemplateRows: workspaceGridRows,
      gridTemplateAreas: workspaceGridAreas
    }"
  >
    <WindowDragStrip v-if="app.isMac" class="workspace__drag-strip" />
    <Sidebar class="workspace__sidebar" />

    <ResizablePaneSeparator
      class="workspace__resizer"
      :model-value="workspaceSidebarLayoutWidth"
      :min="workspaceUi.minSidebarWidth"
      :max="workspaceSidebarMaxWidth"
      @update:model-value="workspaceUi.setSidebarWidth"
    />

    <WorkspaceContent class="workspace__content" />
  </main>
</template>

<style lang="scss" scoped>
.workspace {
  position: relative;
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  background: var(--color-canvas);
}

.workspace__drag-strip {
  grid-area: drag-strip;
}

.workspace__sidebar {
  grid-area: sidebar;
}

.workspace__resizer {
  position: relative;
  z-index: 5;
  grid-area: resizer;
}

.workspace__content {
  grid-area: content;
  box-shadow: -4px 0 12px rgba($color: #000000, $alpha: 0.03);
}

@media (width <= 820px) {
  .workspace {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr;
    grid-template-areas: 'content';
  }

  .workspace__sidebar,
  .workspace__resizer,
  .workspace__drag-strip {
    display: none;
  }

  .workspace__topbar {
    display: grid;
  }

  .workspace__grid {
    grid-template-columns: 1fr;
  }
}
</style>
