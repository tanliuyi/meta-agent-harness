<script setup lang="ts">
/**
 * View.vue - Workspace 页面主布局组件。
 *
 * 组合左侧边栏、可拖拽分隔条与右侧内容区，管理整体布局网格。
 */

import WindowDragStrip from '@renderer/components/window-drag-strip/WindowDragStrip.vue'
import ResizablePaneSeparator from '@renderer/components/ui/resizable-pane-separator/ResizablePaneSeparator.vue'
import { useAppStore } from '@renderer/stores/app'
import useWorkspaceUiStore from '@renderer/stores/workspace-ui'
import { computed } from 'vue'
import WorkspaceContent from './components/content/WorkspaceContent.vue'
import Sidebar from './components/sidebar/Sidebar.vue'

/** 分隔条宽度（像素）。 */
const RESIZER_WIDTH = 1

const app = useAppStore()
const workspaceUi = useWorkspaceUiStore()

/** 当前工作区网格列模板。 */
const workspaceGridColumns = computed(() => {
  return `${workspaceUi.sidebarWidth}px ${RESIZER_WIDTH}px minmax(0, 1fr)`
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
      :model-value="workspaceUi.sidebarWidth"
      :min="workspaceUi.minSidebarWidth"
      :max="workspaceUi.maxSidebarWidth"
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
  grid-area: resizer;
}

.workspace__content {
  grid-area: content;
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
