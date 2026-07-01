<script setup lang="ts">
/**
 * 本文件渲染 desktop workspace 的主布局。
 */

import { useResizablePane } from '@renderer/composables/useResizablePane'
import useWorkspaceUiStore from '@renderer/stores/workspace-ui'
import { computed } from 'vue'
import WorkspaceContent from './components/content/WorkspaceContent.vue'
import Sidebar from './components/sidebar/Sidebar.vue'

const RESIZER_WIDTH = 1

const workspaceUi = useWorkspaceUiStore()
const workspaceGridColumns = computed(() => {
  return `${workspaceUi.sidebarWidth}px ${RESIZER_WIDTH}px minmax(0, 1fr)`
})

const { handleResizerKeydown, isResizing, startResize } = useResizablePane({
  getValue: computed(() => workspaceUi.sidebarWidth),
  setValue: workspaceUi.setSidebarWidth
})
</script>

<template>
  <main class="workspace" :style="{ gridTemplateColumns: workspaceGridColumns }">
    <Sidebar />

    <div
      class="workspace__resizer"
      :class="{ 'workspace__resizer--active': isResizing }"
      role="separator"
      aria-label="调整侧边栏宽度"
      aria-orientation="vertical"
      :aria-valuemin="workspaceUi.minSidebarWidth"
      :aria-valuemax="workspaceUi.maxSidebarWidth"
      :aria-valuenow="workspaceUi.sidebarWidth"
      tabindex="0"
      @pointerdown="startResize"
      @keydown="handleResizerKeydown"
    />

    <WorkspaceContent />
  </main>
</template>

<style lang="scss" scoped>
.workspace {
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
}

.workspace__resizer {
  position: relative;
  cursor: col-resize;
  touch-action: none;

  &::before {
    position: absolute;
    top: 12px;
    bottom: 12px;
    left: 1px;
    width: 1px;
    content: '';
    transition:
      background-color var(--duration-fast) var(--ease-standard),
      box-shadow var(--duration-fast) var(--ease-standard);
    transition-delay: 180ms;
    z-index: 2;
  }

  &::after {
    position: absolute;
    inset: 0 -4px;
    content: '';
  }

  &:hover::before,
  &:focus-visible::before,
  &--active::before {
    background: linear-gradient(
      to bottom,
      transparent 0%,
      var(--color-primary) 50%,
      transparent 100%
    );
    box-shadow: 0 0 0 1px rgb(105 210 160 / 16%);
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
  .workspace {
    grid-template-columns: 1fr;
  }

  .workspace__sidebar {
    display: none;
  }

  .workspace__resizer {
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
