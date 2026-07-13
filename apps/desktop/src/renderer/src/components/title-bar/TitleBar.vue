<script setup lang="ts">
/**
 * TitleBar.vue - 自定义无边框窗口标题栏。
 *
 * @description
 * 兼容 macOS 与 Windows/Linux：
 * - macOS：不渲染自定义标题栏，使用系统原生标题栏。
 * - Windows/Linux：使用 frameless 窗口，渲染自定义最小化/最大化/关闭按钮。
 * 标题栏整体可拖拽，按钮区域不可拖拽。
 */

import { Maximize2, Minus, Minimize2, PanelLeft, X } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '@renderer/stores/app'
import useWorkspaceUiStore from '@renderer/stores/workspace-ui'

const app = useAppStore()
const route = useRoute()
const workspaceUi = useWorkspaceUiStore()
const isMaximized = ref(false)
const isWorkspaceRoute = computed(() => route.name === 'Workspace')

async function refreshMaximizedState(): Promise<void> {
  isMaximized.value = await window.api.windowControl.isMaximized()
}

onMounted(async () => {
  if (app.isMac) {
    return
  }

  await refreshMaximizedState()
  window.addEventListener('resize', refreshMaximizedState)
})

onUnmounted(() => {
  window.removeEventListener('resize', refreshMaximizedState)
})

async function handleMinimize(): Promise<void> {
  await window.api.windowControl.minimize()
}

async function handleMaximize(): Promise<void> {
  await window.api.windowControl.maximize()
  await refreshMaximizedState()
}

async function handleClose(): Promise<void> {
  await window.api.windowControl.close()
}

async function handleDoubleClick(): Promise<void> {
  if (!app.isMac) {
    await handleMaximize()
  }
}
</script>

<template>
  <header v-if="!app.isMac" class="title-bar" data-slot="title-bar" @dblclick="handleDoubleClick">
    <div class="title-bar__title">Meta Agent</div>
    <button
      v-if="isWorkspaceRoute"
      type="button"
      class="title-bar__workspace-button"
      :aria-pressed="workspaceUi.sidebarOpen"
      :aria-label="workspaceUi.sidebarOpen ? '收起侧栏' : '展开侧栏'"
      title="工作空间"
      @click.stop="workspaceUi.toggleSidebar"
      @dblclick.stop
    >
      <PanelLeft class="title-bar__workspace-icon" />
    </button>

    <div class="title-bar__controls" data-slot="title-bar-controls">
      <button type="button" class="title-bar__button" aria-label="最小化" @click="handleMinimize">
        <Minus class="title-bar__icon" />
      </button>
      <button
        type="button"
        class="title-bar__button"
        :aria-label="isMaximized ? '还原' : '最大化'"
        @click="handleMaximize"
      >
        <Minimize2 v-if="isMaximized" class="title-bar__icon" />
        <Maximize2 v-else class="title-bar__icon" />
      </button>
      <button
        type="button"
        class="title-bar__button title-bar__button--close"
        aria-label="关闭"
        @click="handleClose"
      >
        <X class="title-bar__icon" />
      </button>
    </div>
  </header>
</template>

<style lang="scss" scoped>
.title-bar {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  height: 36px;
  padding: 0 8px;
  background: var(--color-canvas);
  -webkit-app-region: drag;
  app-region: drag;
  user-select: none;
}

.title-bar__title {
  font-size: var(--font-size-ui);
  font-weight: 600;
  color: var(--color-text-muted);
  text-align: left;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.title-bar__workspace-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-left: var(--space-2);
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--font-size-ui-sm);
  font-weight: 600;
  cursor: pointer;
  -webkit-app-region: no-drag;
  app-region: no-drag;

  &:hover {
    background: var(--color-surface-hover);
    color: var(--color-text);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
  }
}

.title-bar__workspace-icon {
  width: 16px;
  height: 16px;
}

.title-bar__controls {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 4px;
  margin-left: auto;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.title-bar__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  &:hover {
    background: var(--color-surface-hover);
    color: var(--color-text);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
  }

  &--close:hover {
    background: var(--color-danger);
    color: var(--color-danger-ink);
  }
}

.title-bar__icon {
  width: 12px;
  height: 12px;
}
</style>
