<script setup lang="ts">
import type { HTMLAttributes } from 'vue'

const props = defineProps<{
  class?: HTMLAttributes['class']
  variant?: 'legend' | 'label'
}>()
</script>

<template>
  <legend data-slot="field-legend" :data-variant="variant" :class="props.class">
    <slot />
  </legend>
</template>
