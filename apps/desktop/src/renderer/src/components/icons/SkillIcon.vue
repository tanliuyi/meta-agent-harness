<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 图标尺寸（像素）。 */
    size?: number
    /** 图标描边颜色。 */
    color?: string
  }>(),
  {
    size: 16,
    color: 'currentColor'
  }
)
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    :stroke="color"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    :width="size"
    :height="size"
    aria-hidden="true"
  >
    <path d="M12 3.5 18.5 7.2v7.6L12 18.5l-6.5-3.7V7.2L12 3.5Z" />
    <path d="M12 8.2 13 11l2.8 1-2.8 1-1 2.8-1-2.8-2.8-1 2.8-1L12 8.2Z" />
    <path d="M8.8 20.5h6.4" />
  </svg>
</template>
