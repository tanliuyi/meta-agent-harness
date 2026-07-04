<script setup lang="ts">
import ResizablePaneSeparator from '@renderer/components/ui/resizable-pane-separator/ResizablePaneSeparator.vue'
import WindowDragStrip from '@renderer/components/window-drag-strip/WindowDragStrip.vue'
import { useAppStore } from '@renderer/stores/app'
import useWorkspaceUiStore from '@renderer/stores/workspace-ui'
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import Sidebar from './components/sidebar/Sidebar.vue'

/** 分隔条宽度（像素）。 */
const RESIZER_WIDTH = 1
const app = useAppStore()
const route = useRoute()
const workspaceUi = useWorkspaceUiStore()

/** 当前工作区网格列模板。 */
const workspaceGridColumns = computed(() => {
  return `${workspaceUi.sidebarWidth}px ${RESIZER_WIDTH}px minmax(0, 1fr)`
})

/** 当前设置页网格行模板：macOS 留出顶部拖拽条，Windows/Linux 不需要。 */
const settingsGridRows = computed(() => {
  return app.isMac ? '32px 1fr' : '1fr'
})

/** 当前设置页网格区域。 */
const settingsGridAreas = computed(() => {
  return app.isMac
    ? `'drag-strip resizer content' 'sidebar resizer content'`
    : `'sidebar resizer content'`
})

/** 当前设置主菜单标题。 */
const settingsTitle = computed(() => {
  if (route.path.startsWith('/settings/models')) return '模型'
  if (route.path.startsWith('/settings/agent')) return 'Agent'
  if (route.path.startsWith('/settings/archive')) return '归档'
  return '通用'
})
</script>

<template>
  <main
    class="settings"
    :style="{
      gridTemplateColumns: workspaceGridColumns,
      gridTemplateRows: settingsGridRows,
      gridTemplateAreas: settingsGridAreas
    }"
  >
    <WindowDragStrip v-if="app.isMac" class="settings__drag-strip" />
    <Sidebar />
    <ResizablePaneSeparator
      class="settings__resizer"
      :model-value="workspaceUi.sidebarWidth"
      :min="workspaceUi.minSidebarWidth"
      :max="workspaceUi.maxSidebarWidth"
      @update:model-value="workspaceUi.setSidebarWidth"
    />
    <section class="settings-content">
      <header
        class="settings-content__header"
        :class="{ 'settings-content__header--darwin': app.isMac }"
      >
        <strong>{{ settingsTitle }}</strong>
      </header>
      <div class="settings-content__body">
        <KeepAlive>
          <RouterView />
        </KeepAlive>
      </div>
    </section>
  </main>
</template>

<style lang="scss" scoped>
.settings {
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
}

.settings__drag-strip {
  grid-area: drag-strip;
}

.settings__sidebar {
  grid-area: sidebar;
}

.settings__resizer {
  grid-area: resizer;
}

.settings-content {
  position: relative;
  display: grid;
  grid-area: content;
  grid-template-rows: var(--session-header-height) minmax(0, 1fr);
  --settings-page-max-width: 768px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-workspace-shell) 0 0 var(--radius-workspace-shell);
}

.settings-content__header {
  display: flex;
  align-items: center;
  height: var(--session-header-height);
  min-width: 0;
  min-height: 0;
  padding: 0 var(--space-2);
  border-bottom: 1px solid var(--color-border-muted);
  user-select: none;

  &--darwin {
    -webkit-app-region: drag;
    app-region: drag;
  }

  strong {
    overflow: hidden;
    color: var(--color-text);
    font-size: var(--font-size-ui-sm);
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
    -webkit-app-region: no-drag;
    app-region: no-drag;
  }
}

.settings-content__body {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

@media (width <= 820px) {
  .settings {
    grid-template-columns: 1fr;
  }

  .settings__sidebar {
    display: none;
  }

  .settings__resizer {
    display: none;
  }

  .settings__drag-strip {
    display: none;
  }
}
</style>
