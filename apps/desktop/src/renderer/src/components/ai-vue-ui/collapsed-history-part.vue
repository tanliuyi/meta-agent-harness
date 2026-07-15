<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'
import type { ChatCollapsedHistoryDisplayItem } from './chat-display'

defineProps<{
  item: ChatCollapsedHistoryDisplayItem
  open: boolean
}>()

const emit = defineEmits<{
  toggle: []
}>()
</script>

<template>
  <button
    type="button"
    class="collapsed-history-part"
    :class="{ 'is-pending': !item.collapsible }"
    :disabled="!item.collapsible"
    :aria-expanded="item.collapsible ? open : true"
    @click="emit('toggle')"
  >
    <ChevronRight
      v-if="item.collapsible"
      :size="14"
      class="collapsed-history-part__chevron"
      :class="{ 'is-open': open }"
    />
    <span>{{ item.collapsible ? '已处理' : '处理中' }}</span>
    <span v-if="item.durationLabel" class="collapsed-history-part__duration">
      {{ item.durationLabel }}
    </span>
  </button>
</template>

<style lang="scss" scoped>
.collapsed-history-part {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  gap: var(--space-1);
  width: 100%;
  height: 28px;
  padding: 0 0 var(--space-3);
  color: var(--color-text-muted);
  font: inherit;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--chat-history-border-muted, var(--color-border-muted));
  border-radius: 0;
  font-size: var(--font-size-ui);
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  transition:
    color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);
}

.collapsed-history-part:hover:not(:disabled),
.collapsed-history-part:focus-visible {
  color: var(--color-text);
  border-color: var(--color-border);
}

.collapsed-history-part:disabled {
  cursor: default;
}

.collapsed-history-part:disabled:hover {
  color: var(--color-text-muted);
  border-color: var(--chat-history-border-muted, var(--color-border-muted));
}

.collapsed-history-part__duration {
  font-family: var(--font-mono);
}

.collapsed-history-part__chevron {
  transition: transform var(--duration-fast) var(--ease-standard);
}

.collapsed-history-part__chevron.is-open {
  transform: rotate(90deg);
}

@media (prefers-reduced-motion: reduce) {
  .collapsed-history-part__chevron {
    transition: none;
  }
}
</style>
