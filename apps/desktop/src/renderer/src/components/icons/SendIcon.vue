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
    stroke-width="2.25"
    stroke-linecap="round"
    stroke-linejoin="round"
    :width="size"
    :height="size"
    aria-hidden="true"
  >
    <path d="M12 19V6" />
    <path d="M6.5 11.5 12 6l5.5 5.5" />
  </svg>
</template>
