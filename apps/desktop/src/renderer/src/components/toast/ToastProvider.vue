<script setup lang="ts">
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { useToast } from '@/composables/useToast'

const toast = useToast()
const toastMessages = computed(() => [...toast.toasts.value])
</script>

<template>
  <div class="toast-viewport" aria-live="polite" aria-atomic="false">
    <div
      v-for="item in toastMessages"
      :key="item.id"
      class="toast-item"
      :data-type="item.type"
      role="status"
    >
      <div class="toast-item__content">
        <strong>{{ item.title }}</strong>
        <p v-if="item.description">{{ item.description }}</p>
      </div>
      <Button type="button" variant="ghost" size="icon-sm" title="关闭" @click="toast.dismissToast(item.id)">
        <X />
      </Button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.toast-viewport {
  position: fixed;
  right: var(--space-4);
  bottom: var(--space-4);
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: min(360px, calc(100vw - var(--space-8)));
  pointer-events: none;
}

.toast-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: start;
  padding: var(--space-3);
  color: var(--color-text);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-left-width: 3px;
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lg);
  pointer-events: auto;

  &[data-type='success'] {
    border-left-color: var(--color-primary);
  }

  &[data-type='error'] {
    border-left-color: var(--color-accent);
  }
}

.toast-item__content {
  min-width: 0;

  strong {
    display: block;
    font-size: var(--font-size-ui-sm);
    line-height: 1.4;
  }

  p {
    margin: var(--space-1) 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-xs);
    line-height: 1.45;
  }
}
</style>
