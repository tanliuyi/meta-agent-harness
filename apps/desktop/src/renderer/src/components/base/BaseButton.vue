<script setup lang="ts">
/**
 * 本文件提供基础按钮组件。
 */

withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
  }>(),
  {
    variant: 'secondary',
    size: 'md',
    type: 'button',
    disabled: false
  }
)
</script>

<template>
  <button
    class="base-button"
    :class="[`is-${variant}`, `is-${size}`]"
    :type="type"
    :disabled="disabled"
  >
    <span v-if="$slots.icon" class="base-button__icon" aria-hidden="true">
      <slot name="icon" />
    </span>
    <span class="base-button__label">
      <slot />
    </span>
  </button>
</template>

<style lang="scss" scoped>
.base-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-width: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-weight: 650;
  letter-spacing: 0;
  cursor: pointer;
  user-select: none;
  transition:
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);

  &:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }
}

.is-sm {
  min-height: 24px;
  padding: 0 var(--space-2);
  font-size: 11px;
}

.is-md {
  min-height: 28px;
  padding: 0 var(--space-3);
  font-size: 12px;
}

.is-primary {
  color: var(--color-primary-ink);
  background: var(--color-primary);
  border-color: var(--color-primary);

  &:hover:not(:disabled) {
    background: var(--color-primary-strong);
  }
}

.is-secondary {
  color: var(--color-text);
  background: var(--color-surface-raised);
  border-color: var(--color-border);

  &:hover:not(:disabled) {
    background: var(--color-surface-hover);
    border-color: var(--color-border-strong);
  }
}

.is-ghost {
  color: var(--color-text-muted);
  background: transparent;
  border-color: transparent;

  &:hover:not(:disabled) {
    color: var(--color-text);
    background: var(--color-surface-raised);
  }
}

.is-danger {
  color: var(--color-danger-ink);
  background: var(--color-danger);
  border-color: var(--color-danger);
}

.base-button__icon {
  display: grid;
  width: 14px;
  height: 14px;
  place-items: center;
  flex: 0 0 auto;
}

.base-button__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
