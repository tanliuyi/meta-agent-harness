<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, CircleAlert, CircleCheck, X } from 'lucide-vue-next'
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
      <CircleCheck v-if="item.type === 'success'" class="toast-item__icon" />
      <AlertTriangle v-else-if="item.type === 'warning'" class="toast-item__icon" />
      <CircleAlert v-else class="toast-item__icon" />
      <div class="toast-item__content">
        <strong>{{ item.title }}</strong>
        <p v-if="item.description">{{ item.description }}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class="toast-item__close"
        title="关闭"
        @click="toast.dismissToast(item.id)"
      >
        <X />
      </Button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.toast-viewport {
  position: fixed;
  top: calc(var(--space-4) + 36px);
  left: 50%;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(360px, calc(100vw - var(--space-6)));
  transform: translateX(-50%);
  pointer-events: none;
}

.toast-item {
  position: relative;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 24px;
  gap: 10px;
  align-items: center;
  min-height: 44px;
  padding: 9px 10px 9px 12px;
  color: var(--color-text);
  background: color-mix(in srgb, var(--color-surface) 97%, transparent);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: 0 8px 24px rgb(20 35 48 / 10%);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  animation: toast-enter 160ms var(--ease-standard);
  pointer-events: auto;

  &[data-type='success'] .toast-item__icon {
    color: var(--color-success);
  }

  &[data-type='error'] .toast-item__icon {
    color: var(--color-danger);
  }

  &[data-type='warning'] .toast-item__icon {
    color: var(--color-accent);
  }

  &[data-type='info'] .toast-item__icon {
    color: var(--color-info);
  }
}

.toast-item__icon {
  width: 15px;
  height: 15px;
  color: var(--color-text-subtle);
  stroke-width: 2;
}

.toast-item__content {
  min-width: 0;

  strong {
    display: block;
    overflow: hidden;
    font-size: var(--font-size-ui-sm);
    font-weight: 650;
    line-height: 1.3;
    letter-spacing: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  p {
    margin: 3px 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-xs);
    line-height: 1.4;
  }
}

.toast-item__close {
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--color-text-subtle);
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }

  svg {
    width: 13px;
    height: 13px;
  }
}

@keyframes toast-enter {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .toast-item {
    animation: none;
  }
}
</style>
