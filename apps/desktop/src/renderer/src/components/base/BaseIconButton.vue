<script setup lang="ts">
/**
 * BaseIconButton.vue - 基础图标按钮组件。
 *
 * 仅包含图标的按钮，支持激活状态与无障碍标签。
 */

withDefaults(
  defineProps<{
    /** 是否处于激活状态。 */
    active?: boolean
    /** 按钮的无障碍标签。 */
    label: string
    /** 按钮原生类型。 */
    type?: 'button' | 'submit' | 'reset'
    /** 是否禁用。 */
    disabled?: boolean
  }>(),
  {
    active: false,
    type: 'button',
    disabled: false
  }
)
</script>

<template>
  <button
    class="base-icon-button"
    :class="{ 'is-active': active }"
    :type="type"
    :disabled="disabled"
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

  &:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }

  :deep(svg) {
    flex-shrink: 0;
  }
}
</style>
