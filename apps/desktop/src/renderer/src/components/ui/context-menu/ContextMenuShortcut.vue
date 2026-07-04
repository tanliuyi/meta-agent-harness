<script setup lang="ts">
import type { HTMLAttributes } from 'vue'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <span
    data-slot="context-menu-shortcut"
    :class="props.class"
  >
    <slot />
  </span>
</template>
