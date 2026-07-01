<script setup lang="ts">
import { BaseIconButton } from '@renderer/components/base'

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
</style>
