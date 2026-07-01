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

<script setup lang="ts">
withDefaults(
  defineProps<{
    size?: number
    color?: string
  }>(),
  {
    size: 24,
    color: 'currentColor'
  }
)
</script>
