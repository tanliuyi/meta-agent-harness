<script setup lang="ts">
withDefaults(
  defineProps<{
    active?: boolean
    label: string
    type?: 'button' | 'submit' | 'reset'
  }>(),
  {
    active: false,
    type: 'button'
  }
)
</script>

<template>
  <button
    class="base-icon-button"
    :class="{ 'is-active': active }"
    :type="type"
    :aria-label="label"
  >
    <slot />
  </button>
</template>

<style lang="scss" scoped>
.base-icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--color-text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  pointer-events: auto;
  transition:
    color var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard);

  &:hover,
  &.is-active {
    color: var(--color-text);
    background: var(--color-surface-raised);
  }

  :deep(svg) {
    flex-shrink: 0;
  }
}
</style>
