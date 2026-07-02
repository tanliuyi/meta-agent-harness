<script setup lang="ts">
import ResizablePaneSeparator from '@renderer/components/ui/resizable-pane-separator/ResizablePaneSeparator.vue'
import useWorkspaceUiStore from '@renderer/stores/workspace-ui'
import { computed } from 'vue'
import { RouterView } from 'vue-router'
import Sidebar from './components/sidebar/Sidebar.vue'

/** 分隔条宽度（像素）。 */
const RESIZER_WIDTH = 1
const workspaceUi = useWorkspaceUiStore()

/** 当前工作区网格列模板。 */
const workspaceGridColumns = computed(() => {
  return `${workspaceUi.sidebarWidth}px ${RESIZER_WIDTH}px minmax(0, 1fr)`
})
</script>

<template>
  <main class="settings" :style="{ gridTemplateColumns: workspaceGridColumns }">
    <Sidebar />
    <ResizablePaneSeparator
      class="settings__resizer"
      :model-value="workspaceUi.sidebarWidth"
      :min="workspaceUi.minSidebarWidth"
      :max="workspaceUi.maxSidebarWidth"
      @update:model-value="workspaceUi.setSidebarWidth"
    />
    <section class="settings-content">
      <KeepAlive>
        <RouterView />
      </KeepAlive>
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

.settings-content {
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px 0 0 12px;
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
}
</style>
