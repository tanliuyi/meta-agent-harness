<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 图标尺寸（像素）。 */
    size?: number
    /** 图标颜色。 */
    color?: string
  }>(),
  {
    size: 16,
    color: 'currentColor'
  }
)
</script>

<template>
  <svg viewBox="0 0 24 24" :width="size" :height="size" aria-hidden="true">
    <rect x="7" y="7" width="10" height="10" rx="1" :fill="color" />
  </svg>
</template>
