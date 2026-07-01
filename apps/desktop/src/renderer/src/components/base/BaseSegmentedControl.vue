<script setup lang="ts" generic="T extends string">
/**
 * BaseSegmentedControl.vue - 基础分段控制组件。
 *
 * 提供一组互斥选项，支持受控模式切换。
 */

defineProps<{
  /** 控件标签，用于无障碍图例。 */
  label: string
  /** 当前选中的值。 */
  modelValue: T
  /** 选项列表。 */
  options: Array<{
    /** 选项显示文本。 */
    label: string
    /** 选项值。 */
    value: T
  }>
}>()

/** 更新选中值事件。 */
defineEmits<{
  'update:modelValue': [value: T]
}>()
</script>

<template>
  <fieldset class="base-segmented-control">
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
  padding: 2px;
  margin: 0;
  background: var(--color-control-track);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.base-segmented-control__item {
  min-width: 40px;
  min-height: 22px;
  padding: 0 var(--space-2);
  color: var(--color-text-muted);
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs);
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  transition:
    color var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-text);
  }

  &.is-active {
    color: var(--color-text);
    background: var(--color-surface-raised);
    box-shadow: var(--shadow-sm);
  }
}
</style>
