<script setup lang="ts">
import { ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import ToolGroupIcon from '@renderer/components/icons/ToolGroupIcon.vue'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { ToolGroupStatus } from './tool-group'

const props = withDefaults(
  defineProps<{
    name: string
    summary: string
    status?: ToolGroupStatus
    isError?: boolean
    defaultOpen?: boolean
  }>(),
  {
    status: undefined,
    isError: false,
    defaultOpen: false
  }
)

const open = ref(props.defaultOpen)
</script>

<template>
  <Collapsible
    v-model:open="open"
    class="tool-group"
    :class="{ 'tool-group--error': isError }"
    :data-status="status"
  >
    <CollapsibleTrigger class="tool-group__trigger">
      <span class="tool-group__leading-icon">
        <slot name="icon"><ToolGroupIcon :size="14" /></slot>
      </span>
      <span class="tool-group__name">{{ name }}</span>
      <span class="tool-group__summary">{{ summary }}</span>
      <ChevronRight :size="16" class="tool-group__icon" aria-hidden="true" />
    </CollapsibleTrigger>

    <CollapsibleContent class="tool-group__content">
      <div class="tool-group__list">
        <slot />
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>

<style lang="scss" scoped>
.tool-group {
  flex: 1;
  min-width: 0;
  width: min(720px, 100%);
  border-radius: var(--radius-lg);
}

.tool-group__trigger {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
  max-width: 100%;
  width: fit-content;
  color: inherit;
  font: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: inherit;
  cursor: pointer;

  &:hover {
    color: var(--color-hover);
  }

  &:focus-visible {
    outline: none;
    box-shadow: inset var(--shadow-focus);
  }

  &:hover .tool-group__icon,
  &:focus-visible .tool-group__icon {
    opacity: 1;
  }
}

.tool-group[data-state='open'] .tool-group__trigger {
  width: 100%;
  padding: var(--space-2);
  background: var(--color-canvas);
  border-bottom: 1px solid var(--color-border);
  border-bottom-right-radius: 0;
  border-bottom-left-radius: 0;
}

.tool-group__icon {
  flex: 0 0 auto;
  color: var(--color-text-subtle);
  opacity: 0;
  transition:
    opacity var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);
}

.tool-group[data-state='open'] .tool-group__icon {
  opacity: 1;
  transform: rotate(90deg);
}

.tool-group__leading-icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
}

.tool-group__name {
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui);
}

.tool-group__summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-subtle);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-group--error {
  .tool-group__name {
    color: var(--color-danger);
  }
}

.tool-group__content {
  margin: 0;
  overflow: hidden;
  background: var(--color-canvas);
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
}

.tool-group__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  padding: var(--space-2) 0;

  :deep(.tool-message) {
    width: 100%;
  }

  :deep(.tool-message__trigger) {
    width: 100%;
  }

  :deep(.tool-message__icon) {
    display: none;
  }
}
</style>
