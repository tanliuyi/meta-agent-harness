<script setup lang="ts">
/**
 * SessionPanel.vue - 当前活跃会话的右侧面板组件。
 *
 * 展示会话状态、Project、会话文件以及待处理的审批请求与最近事件。
 */

import { BaseIconButton } from '@renderer/components/base'
import ScrollArea from '@renderer/components/ui/scroll-area/ScrollArea.vue'
import useWorkspaceProjectStore from '@renderer/stores/workspace-project'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import { computed } from 'vue'

const workspaceProject = useWorkspaceProjectStore()
const workspaceSession = useWorkspaceSessionStore()

/** 当前会话所属 Project。 */
const sessionProject = computed(() => {
  const projectId = workspaceSession.activeSession?.projectId
  return projectId ? workspaceProject.projects[projectId] : undefined
})

/** 当前待处理审批列表。 */
const pendingApprovals = computed(() => Object.values(workspaceSession.activePendingApprovals))

/** 是否存在待处理审批。 */
const hasPendingApprovals = computed(() => pendingApprovals.value.length > 0)

/** 是否折叠面板。 */
defineProps<{
  collapsed?: boolean
}>()

/** 切换面板折叠状态。 */
defineEmits<{
  toggle: []
}>()
</script>

<template>
  <section class="session-panel" :class="{ 'session-panel--collapsed': collapsed }">
    <header class="session-panel__header">
      <div class="session-panel__tabs">
        <!-- 会话面板标签栏占位 -->
      </div>
      <div class="session-panel__actions">
        <BaseIconButton
          class="session-panel__collapse"
          :active="!collapsed"
          :label="collapsed ? '展开会话面板' : '收起会话面板'"
          @click="$emit('toggle')"
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
          >
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
            <line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </BaseIconButton>
      </div>
    </header>

    <div v-if="!collapsed" class="session-panel__body">
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{{ workspaceSession.activeSession?.status ?? 'new' }}</dd>
        </div>
        <div>
          <dt>Project</dt>
          <dd>{{ sessionProject?.name ?? '-' }}</dd>
        </div>
        <div>
          <dt>Session</dt>
          <dd>{{ workspaceSession.activeSnapshot?.sessionFile ?? '-' }}</dd>
        </div>
      </dl>

      <ScrollArea v-if="hasPendingApprovals" class="approval-list">
        <article
          v-for="approval in pendingApprovals"
          :key="approval.approvalId"
          class="approval-card"
        >
          <header>
            <strong>{{ approval.action }}</strong>
            <span>{{ approval.risk }}</span>
          </header>
          <p>{{ approval.subject }}</p>
          <div v-if="approval.choices?.length" class="approval-card__choices">
            <button
              v-for="choice in approval.choices"
              :key="choice"
              type="button"
              @click="workspaceSession.respondApproval(approval, { allow: true, choice })"
            >
              {{ choice }}
            </button>
          </div>
          <div class="approval-card__actions">
            <button
              type="button"
              @click="workspaceSession.respondApproval(approval, { allow: false })"
            >
              Deny
            </button>
            <button
              type="button"
              @click="workspaceSession.respondApproval(approval, { allow: true })"
            >
              Allow
            </button>
          </div>
        </article>
      </ScrollArea>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.session-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  min-height: 0;
}

.session-panel__header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  height: var(--session-header-height);
  padding: 0 var(--space-3) 0 0;
}

.session-panel__tabs {
  flex: 1;
  min-width: 0;
  height: inherit;
}

.session-panel__actions {
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
  height: inherit;
}

.session-panel__collapse {
  pointer-events: auto;
}

.session-panel__body {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: var(--space-3);
  min-width: 0;
  min-height: 0;
  padding: 0 var(--space-2) var(--space-2);
  overflow: hidden;
}

dl {
  display: grid;
  gap: var(--space-2);
  margin: 0;
}

dl div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

dt {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--font-size-ui-xs);
  text-transform: uppercase;
}

dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--font-size-ui-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-list {
  min-width: 0;
  min-height: 0;
}

.event-list :deep([data-slot='scroll-area-viewport']) {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.event-list article {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
  padding: 6px;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--font-size-ui-2xs);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.approval-list {
  min-width: 0;
}

.approval-list :deep([data-slot='scroll-area-viewport']) {
  display: grid;
  gap: var(--space-2);
}

.approval-card {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-danger, #ff7a7a);
  border-radius: var(--radius-sm);

  header,
  .approval-card__actions,
  .approval-card__choices {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  header {
    justify-content: space-between;
  }

  strong {
    color: var(--color-text);
    font-size: var(--font-size-ui-xs);
  }

  span,
  p {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-xs);
  }

  button {
    min-height: 26px;
    padding: 0 8px;
    color: var(--color-text);
    font: inherit;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
  }
}
</style>
