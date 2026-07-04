<script setup lang="ts">
import type { HTMLAttributes } from 'vue'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <fieldset data-slot="field-set" :class="props.class">
    <slot />
  </fieldset>
</template>
