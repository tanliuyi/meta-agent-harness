<script setup lang="ts" generic="T extends string">
defineProps<{
  label: string
  modelValue: T
  options: Array<{
    label: string
    value: T
  }>
}>()

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
