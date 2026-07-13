<script setup lang="ts">
/**
 * ResizablePaneSeparator.vue - 可拖拽调整相邻面板尺寸的分隔条。
 */

import { useResizablePane } from '@renderer/composables/useResizablePane'
import { computed, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 分隔条无障碍标签。 */
    label?: string
    /** 当前面板尺寸。 */
    modelValue: number
    /** 最大面板尺寸。 */
    max: number
    /** 最小面板尺寸。 */
    min: number
  }>(),
  {
    label: '调整侧边栏宽度'
  }
)

const emit = defineEmits<{
  resizeStateChange: [resizing: boolean]
  'update:modelValue': [value: number]
}>()

function clampValue(value: number): number {
  return Math.min(props.max, Math.max(props.min, value))
}

const currentValue = computed(() => clampValue(props.modelValue))

const { handleResizerKeydown, isResizing, startResize } = useResizablePane({
  getValue: currentValue,
  setValue: (value) => emit('update:modelValue', clampValue(value))
})

watch(
  isResizing,
  (resizing) => {
    emit('resizeStateChange', resizing)
  },
  { flush: 'sync' }
)
</script>

<template>
  <div
    class="resizable-pane-separator"
    :class="{ 'resizable-pane-separator--active': isResizing }"
    role="separator"
    :aria-label="label"
    aria-orientation="vertical"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="modelValue"
    tabindex="0"
    @pointerdown="startResize"
    @keydown="handleResizerKeydown"
  />
</template>

<style lang="scss" scoped>
.resizable-pane-separator {
  position: relative;
  cursor: col-resize;
  touch-action: none;

  &::before {
    position: absolute;
    top: 12px;
    bottom: 12px;
    left: 1px;
    z-index: 2;
    width: 1px;
    content: '';
    transition: background-color var(--duration-fast) var(--ease-standard);
    transition-delay: 180ms;
  }

  &::after {
    position: absolute;
    inset: 0 -4px;
    content: '';
  }

  &:hover::before,
  &:focus-visible::before,
  &--active::before {
    background: linear-gradient(
      to bottom,
      transparent 0%,
      var(--color-primary) 50%,
      transparent 100%
    );
  }

  &:focus-visible {
    outline: none;
  }

  &:focus-visible::before,
  &--active::before {
    transition-delay: 0ms;
  }
}
</style>
