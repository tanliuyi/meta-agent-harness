<script setup lang="ts">
/**
 * View.vue - Workspace 页面主布局组件。
 *
 * 组合左侧边栏、可拖拽分隔条与右侧内容区，管理整体布局网格。
 */

import { BaseIconButton } from '@renderer/components/base'
import WindowDragStrip from '@renderer/components/window-drag-strip/WindowDragStrip.vue'
import ResizablePaneSeparator from '@renderer/components/ui/resizable-pane-separator/ResizablePaneSeparator.vue'
import { useAppStore } from '@renderer/stores/app'
import { useAppearanceSettings } from '@renderer/composables/useAppearanceSettings'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import useWorkspaceUiStore from '@renderer/stores/workspace-ui'
import { useElementSize } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import WorkspaceContent from './components/content/WorkspaceContent.vue'
import Sidebar from './components/sidebar/Sidebar.vue'
import { MIN_WORKSPACE_MAIN_SESSION_WIDTH, WORKSPACE_RESIZER_WIDTH } from './workspace-layout'

const app = useAppStore()
const appearanceSettings = useAppearanceSettings()
const workspaceSession = useWorkspaceSessionStore()
const workspaceUi = useWorkspaceUiStore()
const workspaceRef = ref<HTMLElement | null>(null)
const { width: workspaceWidth } = useElementSize(workspaceRef)
const sidebarAutoNarrow = computed(() => workspaceWidth.value > 0 && workspaceWidth.value < 960)

watch(
  [() => appearanceSettings.sidebarDisplay.value, sidebarAutoNarrow],
  ([mode, narrow], previous) => {
    const [previousMode, previousNarrow] = previous ?? []
    if (mode !== 'auto' || (mode === previousMode && narrow === previousNarrow)) return
    workspaceUi.sidebarOpen = !narrow
  },
  { immediate: true }
)

const isSessionPanelOpen = computed(
  () =>
    (Boolean(workspaceSession.activeSession) || workspaceSession.isNewSessionActive) &&
    workspaceSession.activeSessionPanel.panelOpen
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
  if (!workspaceUi.sidebarOpen) {
    return '0px 0px minmax(0, 1fr)'
  }
  return `${workspaceSidebarLayoutWidth.value}px ${WORKSPACE_RESIZER_WIDTH}px minmax(0, 1fr)`
})

/** 当前工作区网格行模板：macOS 留出顶部拖拽条，Windows/Linux 不需要。 */
const workspaceGridRows = computed(() => {
  return app.isMac ? 'calc(var(--session-header-height) + 1px) 1fr' : '1fr'
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
    <BaseIconButton
      v-if="workspaceUi.sidebarOpen || !app.isMac"
      class="workspace__sidebar-toggle"
      :class="{ 'workspace__sidebar-toggle--darwin': app.isMac }"
      :active="workspaceUi.sidebarOpen"
      :label="workspaceUi.sidebarOpen ? '收起侧栏' : '展开侧栏'"
      size="small"
      @click="workspaceUi.sidebarOpen = !workspaceUi.sidebarOpen"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        width="16"
        height="16"
        aria-hidden="true"
      >
        <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
        <line x1="9" y1="3" x2="9" y2="21" />
      </svg>
    </BaseIconButton>
    <button
      v-if="workspaceUi.sidebarOpen"
      type="button"
      class="workspace__sidebar-backdrop"
      aria-label="关闭工作区导航"
      @click="workspaceUi.sidebarOpen = false"
    />
    <Sidebar v-show="workspaceUi.sidebarOpen" class="workspace__sidebar" />

    <ResizablePaneSeparator
      v-if="workspaceUi.sidebarOpen"
      class="workspace__resizer"
      :model-value="workspaceSidebarLayoutWidth"
      :min="workspaceUi.minSidebarWidth"
      :max="workspaceSidebarMaxWidth"
      @update:model-value="workspaceUi.setSidebarWidth"
    />

    <WorkspaceContent
      class="workspace__content"
      :style="{
        '--session-header-padding-left': !workspaceUi.sidebarOpen && app.isMac ? '124px' : undefined
      }"
    />
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

.workspace__sidebar-toggle {
  position: absolute;
  z-index: 10;
  top: calc((var(--session-header-height) - 24px) / 2);
  left: 6px;
  width: 24px !important;
  height: 24px !important;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.workspace__sidebar-toggle--darwin {
  left: 82px;
}

.workspace__sidebar-toggle :deep(*) {
  pointer-events: none;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.workspace__sidebar {
  grid-area: sidebar;
}

.workspace__sidebar-backdrop {
  display: none;
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

  .workspace__resizer,
  .workspace__drag-strip {
    display: none;
  }

  .workspace__sidebar-backdrop {
    position: fixed;
    z-index: 29;
    inset: 0;
    display: block;
    padding: 0;
    background: rgba(0, 0, 0, 0.28);
    border: 0;
  }

  .workspace__sidebar {
    position: fixed;
    z-index: 30;
    top: 0;
    bottom: 0;
    left: 0;
    display: flex;
    width: min(280px, calc(100vw - 32px));
    box-shadow: 8px 0 24px rgba(0, 0, 0, 0.16);
  }

  .workspace__topbar {
    display: grid;
  }

  .workspace__grid {
    grid-template-columns: 1fr;
  }
}
</style>
