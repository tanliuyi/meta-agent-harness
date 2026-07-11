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
  if (route.path.startsWith('/settings/personalization')) return '个性化'
  if (route.path.startsWith('/settings/memory')) return '记忆'
  if (route.path.startsWith('/settings/models')) return '模型'
  if (route.path.startsWith('/settings/agent')) return '智能体'
  if (route.path.startsWith('/settings/diagnostics')) return '诊断'
  if (route.path.startsWith('/settings/extensions')) return '扩展'
  if (route.path.startsWith('/settings/archive')) return '归档'
  if (route.path.startsWith('/settings/about')) return '关于我们'
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
        <RouterView v-slot="{ Component }">
          <KeepAlive>
            <component :is="Component" />
          </KeepAlive>
        </RouterView>
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
  background: var(--color-surface);
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
  --settings-page-max-width: 860px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-workspace-shell) 0 0 var(--radius-workspace-shell);
  box-shadow: -4px 0 12px rgba($color: #000000, $alpha: 0.03);
}

.settings-content__header {
  position: relative;
  display: flex;
  align-items: center;
  height: var(--session-header-height);
  min-width: 0;
  min-height: 0;
  padding: 0 var(--space-4);
  user-select: none;

  &::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--color-border-muted);
    opacity: 0.4;
  }

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
    grid-template-columns: minmax(0, 1fr) !important;
    grid-template-areas: 'content' !important;
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
