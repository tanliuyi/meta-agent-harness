<script lang="ts" setup>
import { BaseIconButton } from '@renderer/components/base'
import { useSessionContext } from '@renderer/composables/useSessionContext'
import { computed } from 'vue'

const { session, panel } = useSessionContext()

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
    <strong>{{ session.title }}</strong>
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
