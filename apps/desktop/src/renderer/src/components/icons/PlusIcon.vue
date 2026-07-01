<script setup lang="ts">
/**
 * PlusIcon.vue - 简单加号图标组件。
 *
 * 支持自定义尺寸与颜色。
 */

withDefaults(
  defineProps<{
    /** 图标尺寸（像素）。 */
    size?: number
    /** 图标描边颜色。 */
    color?: string
  }>(),
  {
    size: 24,
    color: 'currentColor'
  }
)
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    :stroke="color"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    :width="size"
    :height="size"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
</template>
