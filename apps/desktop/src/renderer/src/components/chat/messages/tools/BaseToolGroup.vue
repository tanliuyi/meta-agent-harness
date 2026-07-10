<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed, ref, watch } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import ToolGroupIcon from '@renderer/components/icons/ToolGroupIcon.vue'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { ToolGroupStatus } from './support/tool-group'

const props = withDefaults(
  defineProps<{
    summary: string
    status?: ToolGroupStatus
    isError?: boolean
    defaultOpen?: boolean
    open?: boolean
    class?: HTMLAttributes['class']
  }>(),
  {
    status: undefined,
    isError: false,
    defaultOpen: false,
    open: undefined
  }
)

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const localOpen = ref(props.defaultOpen)

watch(
  () => props.defaultOpen,
  (defaultOpen) => {
    if (props.open === undefined) {
      localOpen.value = defaultOpen
    }
  }
)

const open = computed({
  get: () => props.open ?? localOpen.value,
  set: (value: boolean) => {
    if (props.open === undefined) {
      localOpen.value = value
    }
    emit('update:open', value)
  }
})
</script>

<template>
  <Collapsible
    v-model:open="open"
    class="tool-group"
    :class="[props.class, { 'tool-group--error': isError }]"
    :data-status="status"
  >
    <CollapsibleTrigger class="tool-group__trigger" :aria-label="summary">
      <span class="tool-group__leading-icon">
        <slot name="icon"><ToolGroupIcon :size="14" /></slot>
      </span>
      <span class="tool-group__summary">
        <slot name="summary">{{ summary }}</slot>
      </span>
      <ChevronRight :size="16" class="tool-group__icon" aria-hidden="true" />
    </CollapsibleTrigger>

    <CollapsibleContent v-if="open" class="tool-group__content">
      <div class="tool-group__list">
        <slot :open="open" />
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
  min-height: 24px;
  width: fit-content;
  padding: 0;
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
  background: var(--color-canvas);
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

.tool-group__summary {
  position: relative;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  color: var(--color-text-subtle);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-group--summary-active {
  .tool-group__summary::after {
    content: '';
    position: absolute;
    inset: -1px 0;
    pointer-events: none;
    animation: tool-group-summary-shimmer 1.8s linear infinite;
    background: repeating-linear-gradient(
      110deg,
      transparent 0,
      transparent 48px,
      color-mix(in srgb, var(--color-info) 6%, transparent) 64px,
      color-mix(in srgb, var(--color-info) 20%, transparent) 78px,
      color-mix(in srgb, var(--color-text) 16%, transparent) 88px,
      color-mix(in srgb, var(--color-info) 10%, transparent) 100px,
      transparent 118px,
      transparent 220px
    );
    background-size: 220px 100%;
    filter: blur(0.8px);
    mask-image:
      linear-gradient(to right, transparent 0%, #000 12%, #000 88%, transparent 100%),
      linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%);
    mask-composite: intersect;
    opacity: 0.38;
  }
}

.tool-group--error {
  .tool-group__summary {
    color: var(--color-text-subtle);
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
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2) 0;

  :deep(.tool-message) {
    width: 100%;
  }

  :deep(.tool-message__trigger) {
    width: fit-content;
  }

  :deep(.tool-message__icon) {
    display: none;
  }
}

@keyframes tool-group-summary-shimmer {
  from {
    background-position: -220px 0;
  }

  to {
    background-position: 0 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .tool-group--summary-active {
    .tool-group__summary::after {
      animation: none;
      background: none;
    }
  }
}
</style>
