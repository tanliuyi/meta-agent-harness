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
  >
    <path
      d="M12 2.5 2.5 7.2c-.5.3-.5.8 0 1.1l9.5 4.3c.3.1.7.1 1 0l9.5-4.3c.5-.3.5-.8 0-1.1L12 2.5Z"
    />
    <path d="M2.5 12.2c-.5.3-.5.8 0 1.1l9.5 4.3c.3.1.7.1 1 0l9.5-4.3c.5-.3.5-.8 0-1.1" />
    <path d="M2.5 17.2c-.5.3-.5.8 0 1.1l9.5 4.3c.3.1.7.1 1 0l9.5-4.3c.5-.3.5-.8 0-1.1" />
  </svg>
</template>
