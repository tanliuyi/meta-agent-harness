<script lang="ts" setup>
/**
 * SessionHeader.vue - 当前活跃会话的顶部状态栏组件。
 *
 * 展示会话标题、工作目录与状态，并适配右侧面板的折叠状态。
 */

import { BaseIconButton } from '@renderer/components/base'
import { useSessionContext } from '@renderer/composables/useSessionContext'
import { useAppStore } from '@renderer/stores/app'
import { computed } from 'vue'

const app = useAppStore()
const { session, panel } = useSessionContext()

/** 动态计算的头部样式，用于给右侧操作按钮预留空间。 */
const styles = computed(() => {
  const paddingRight = panel.value.open
    ? `var(--space-2)`
    : `calc(var(--space-2) + var(--session-panel-actions-width))`
  return {
    paddingRight,
    '--session-header-padding-right': paddingRight
  }
})
</script>

<template>
  <header class="session-header" :class="{ 'session-header--darwin': app.isMac }" :style="styles">
    <div class="session-header__title">
      <strong>{{ session.title }}</strong>
    </div>
    <div class="session-header__actions">
      <BaseIconButton label="查看会话信息">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          width="16"
          height="16"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </BaseIconButton>
    </div>
    <div v-if="app.isMac" class="session-header__drag-spacer" aria-hidden="true" />
  </header>
</template>

<style lang="scss" scoped>
.session-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
  min-height: 0;
  padding-left: var(--space-2);

  &--darwin {
    -webkit-app-region: drag;
    app-region: drag;
  }

  strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .session-header__title {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .session-header__title strong {
    -webkit-app-region: no-drag;
    app-region: no-drag;
    user-select: text;
  }

  .session-header__actions {
    display: flex;
    flex-direction: row;
    align-items: center;
    -webkit-app-region: no-drag;
    app-region: no-drag;
  }

  .session-header__drag-spacer {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: var(--session-header-padding-right);
    -webkit-app-region: no-drag;
    app-region: no-drag;
  }

  strong {
    color: var(--color-text);
    font-size: var(--font-size-ui-sm);
    font-weight: 650;
  }

  span {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--font-size-ui-xs);
  }
}
</style>
