<script setup lang="ts">
/**
 * 本文件渲染 coding thread 侧边栏并接入创建/切换能力。
 */

import { BaseIconButton } from '@renderer/components/base'
import PlusIcon from '@renderer/components/icons/PlusIcon.vue'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'

const workspaceSession = useWorkspaceSessionStore()
</script>

<template>
  <aside class="workspace__sidebar">
    <div class="sidebar-section">
      <div class="sidebar-section__header">
        <span>Threads</span>
        <BaseIconButton label="创建 Thread" @click="workspaceSession.createThread">
          <PlusIcon />
        </BaseIconButton>
      </div>

      <label class="cwd-field">
        <span>cwd</span>
        <input
          v-model="workspaceSession.cwdInput"
          spellcheck="false"
          placeholder="H:\\repo"
          @keydown.enter="workspaceSession.createThread"
        />
      </label>

      <p v-if="workspaceSession.errorMessage" class="sidebar-error">
        {{ workspaceSession.errorMessage }}
      </p>

      <ul class="session-group">
        <li
          v-for="thread in workspaceSession.sessionList"
          :key="thread.threadId"
          class="session-group__item"
          :class="{
            'session-group__item--active': thread.threadId === workspaceSession.activeSessionId
          }"
          @click="workspaceSession.setActiveSessionId(thread.threadId)"
        >
          <span>{{ thread.title || thread.cwd }}</span>
          <small>{{ thread.status }}</small>
        </li>
      </ul>
    </div>
  </aside>
</template>

<style lang="scss" scoped>
.workspace__sidebar {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: var(--space-3) var(--space-2) var(--space-3) var(--space-3);
  overflow: hidden;
  color: var(--color-text);
  background:
    linear-gradient(180deg, rgb(255 255 255 / 4%), transparent 72px), var(--color-sidebar);
  border-right: 1px solid rgb(255 255 255 / 4%);
  backdrop-filter: blur(16px);
}

.sidebar-section {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  min-height: 0;
  padding-right: var(--space-1);
  overflow-y: auto;
}

.sidebar-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-height: 30px;
  padding: 0 var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--color-border);

  span {
    min-width: 0;
    overflow: hidden;
    color: var(--color-text);
    font-size: 12px;
    font-weight: 750;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.cwd-field {
  display: grid;
  gap: 6px;
  min-width: 0;

  span {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
  }

  input {
    width: 100%;
    min-width: 0;
    height: 30px;
    padding: 0 var(--space-2);
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    outline: none;
  }
}

.sidebar-error {
  margin: 0;
  color: var(--color-danger, #ff7a7a);
  font-size: 11px;
}

.session-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.session-group__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  min-height: 32px;
  padding: 0 var(--space-2);
  color: var(--color-text-muted);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;

  span {
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    font-weight: 560;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    font-family: var(--font-mono);
    font-size: 10px;
  }

  &:hover,
  &--active {
    color: var(--color-text);
    background: var(--color-surface-raised);
    border-color: var(--color-border);
  }
}
</style>
