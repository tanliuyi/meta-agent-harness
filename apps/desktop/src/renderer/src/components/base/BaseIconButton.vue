<script setup lang="ts">
import { computed } from 'vue'

/**
 * BaseIconButton.vue - 基础图标按钮组件。
 *
 * 仅包含图标的按钮，支持激活状态与无障碍标签。
 */

const props = withDefaults(
  defineProps<{
    /** 是否处于激活状态。 */
    active?: boolean
    /** 按钮的无障碍标签。 */
    label: string
    /** 按钮原生类型。 */
    type?: 'button' | 'submit' | 'reset'
    /** 是否禁用。 */
    disabled?: boolean
    size?: 'small' | 'medium' | 'large'
  }>(),
  {
    active: false,
    type: 'button',
    disabled: false
  }
)

const buttonClasses = computed(() => {
  return {
    'base-icon-button': true,
    'is-active': props.active,
    [`is-${props.size}`]: true
  }
})
</script>

<template>
  <button :class="buttonClasses" :type="type" :disabled="disabled" :aria-label="label">
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
  border-radius: var(--radius-md);
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

  &.is-small {
    width: 20px;
    height: 20px;
  }
  &.is-medium {
    width: 24px;
    height: 24px;
  }
  &.is-large {
    width: 32px;
    height: 32px;
  }
}
</style>
