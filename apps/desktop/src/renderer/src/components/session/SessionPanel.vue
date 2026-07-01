<script setup lang="ts">
/**
 * 本文件渲染 active coding thread 的状态、事件和审批面板。
 */

import { BaseIconButton } from '@renderer/components/base'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'

const workspaceSession = useWorkspaceSessionStore()

defineProps<{
  collapsed?: boolean
}>()

defineEmits<{
  toggle: []
}>()
</script>

<template>
  <section class="session-panel" :class="{ 'session-panel--collapsed': collapsed }">
    <header class="session-panel__header">
      <div class="session-panel__tabs">
        <!-- session panel tabs -->
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
          <dt>CWD</dt>
          <dd>{{ workspaceSession.activeSession?.cwd ?? '-' }}</dd>
        </div>
        <div>
          <dt>Session</dt>
          <dd>{{ workspaceSession.activeSnapshot?.sessionFile ?? '-' }}</dd>
        </div>
      </dl>

      <section v-if="Object.keys(workspaceSession.pendingApprovals).length > 0" class="approval-list">
        <article
          v-for="approval in workspaceSession.pendingApprovals"
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
      </section>

      <section class="event-list">
        <article v-for="event in workspaceSession.events.slice(0, 16)" :key="JSON.stringify(event)">
          <span>{{ event.type }}</span>
          <code>{{ event.threadId }}</code>
        </article>
      </section>
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

.session-panel--collapsed {
  pointer-events: none;
}

.session-panel__header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  height: var(--session-header-height);
  padding: 0 var(--space-1);
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
  font-size: 10px;
  text-transform: uppercase;
}

dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}

.event-list article {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
  padding: 6px;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.approval-list {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
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
    font-size: 11px;
  }

  span,
  p {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 11px;
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
