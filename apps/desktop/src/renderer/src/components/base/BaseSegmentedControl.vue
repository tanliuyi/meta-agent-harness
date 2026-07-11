<script setup lang="ts" generic="T extends string">
/**
 * BaseSegmentedControl.vue - 基础分段控制组件。
 *
 * 提供一组互斥选项，支持受控模式切换。
 */

withDefaults(
  defineProps<{
    /** 控件标签，用于无障碍图例。 */
    label: string
    /** 控件尺寸。 */
    size?: 'small' | 'medium'
    /** 当前选中的值。 */
    modelValue: T
    /** 选项列表。 */
    options: Array<{
      /** 选项显示文本。 */
      label: string
      /** 选项值。 */
      value: T
    }>
  }>(),
  {
    size: 'medium'
  }
)

/** 更新选中值事件。 */
defineEmits<{
  'update:modelValue': [value: T]
}>()
</script>

<template>
  <fieldset class="base-segmented-control" :class="`base-segmented-control--${size}`">
    <legend class="sr-only">{{ label }}</legend>
    <button
      v-for="option in options"
      :key="option.value"
      class="base-segmented-control__item"
      :class="{ 'is-active': option.value === modelValue }"
      type="button"
      :aria-pressed="option.value === modelValue"
      @click="$emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </fieldset>
</template>

<style lang="scss" scoped>
.base-segmented-control {
  display: inline-grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 2px;
  min-width: 0;
  padding: 3px;
  margin: 0;
  background: var(--color-control-track);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
}

.base-segmented-control__item {
  min-width: 40px;
  min-height: 22px;
  padding: 0 var(--space-2);
  color: var(--color-text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  cursor: pointer;
  font-size: var(--font-size-ui-xs);
  font-weight: 700;
  letter-spacing: 0.025em;
  transition:
    color var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-text);
  }

  &:active {
    transform: translateY(1px);
  }

  &.is-active {
    color: var(--color-primary-strong);
    background: color-mix(in srgb, var(--color-primary-soft) 72%, var(--color-surface-raised));
    border-color: var(--color-primary-outline);
  }
}

.base-segmented-control--small {
  padding: 2px;

  .base-segmented-control__item {
    min-width: 34px;
    min-height: 18px;
    padding: 0 var(--space-2);
  }
}
</style>
