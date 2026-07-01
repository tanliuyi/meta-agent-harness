<script lang="ts" setup>
/**
 * SessionHeader.vue - 当前活跃会话的顶部状态栏组件。
 *
 * 展示会话标题、工作目录与状态，并适配右侧面板的折叠状态。
 */

import { BaseIconButton } from '@renderer/components/base'
import { useSessionContext } from '@renderer/composables/useSessionContext'
import useWorkspaceProjectStore from '@renderer/stores/workspace-project'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import { computed } from 'vue'

const { session, panel } = useSessionContext()
const workspaceProject = useWorkspaceProjectStore()
const workspaceSession = useWorkspaceSessionStore()

/** 当前会话所属 Project。 */
const project = computed(() => {
  const projectId = workspaceSession.activeSession?.projectId
  return projectId ? workspaceProject.projects[projectId] : undefined
})

/** 动态计算的头部样式，用于给右侧操作按钮预留空间。 */
const styles = computed(() => {
  return {
    paddingRight: panel.value.open
      ? `var(--space-2)`
      : `calc(var(--space-2) + var(--session-panel-actions-width))`
  }
})
</script>

<template>
  <header class="session-header" :style="styles">
    <div class="session-header__title">
      <strong>{{ session.title }}</strong>
      <span>{{ project?.name ?? 'No project' }}</span>
    </div>
    <div class="session-header__actions">
      <span>{{ session.status }}</span>
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
  </header>
</template>

<style lang="scss" scoped>
.session-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
  min-height: 0;
  padding-left: var(--space-2);

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

  .session-header__actions {
    display: flex;
    flex-direction: row;
  }

  strong {
    color: var(--color-text);
    font-size: 12px;
    font-weight: 650;
  }

  span {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
  }
}
</style>
