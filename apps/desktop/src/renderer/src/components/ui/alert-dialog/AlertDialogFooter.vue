<script setup lang="ts">
import type { HTMLAttributes } from 'vue'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div data-slot="alert-dialog-footer" :class="props.class">
    <slot />
  </div>
</template>
