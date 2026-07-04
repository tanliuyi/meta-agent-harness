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
  top: var(--space-4);
  left: 50%;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: min(320px, calc(100vw - var(--space-8)));
  transform: translateX(-50%);
  pointer-events: none;
}

.toast-item {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  gap: var(--space-2);
  align-items: center;
  min-height: 40px;
  padding: var(--space-2);
  color: var(--color-text);
  background: color-mix(in srgb, var(--color-surface) 92%, transparent);
  border: 1px solid var(--color-border-muted);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(18px);
  pointer-events: auto;

  &[data-type='success'] {
    .toast-item__icon {
      color: var(--color-primary);
    }
  }

  &[data-type='error'] {
    .toast-item__icon {
      color: var(--color-danger);
    }
  }

  &[data-type='warning'] {
    .toast-item__icon {
      color: var(--color-warning, var(--color-text-muted));
    }
  }

  &[data-type='info'] {
    .toast-item__icon {
      color: var(--color-info);
    }
  }
}

.toast-item__icon {
  width: 15px;
  height: 15px;
  color: var(--color-text-subtle);
}

.toast-item__content {
  min-width: 0;

  strong {
    display: block;
    font-size: var(--font-size-ui-sm);
    font-weight: 650;
    line-height: 1.25;
  }

  p {
    margin: 2px 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-ui-xs);
    line-height: 1.35;
  }
}

.toast-item__close {
  width: 24px;
  height: 24px;
  color: var(--color-text-subtle);
  border-radius: var(--radius-md);

  svg {
    width: 14px;
    height: 14px;
  }
}
</style>
