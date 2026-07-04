<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Label as LabelPrimitive } from 'reka-ui'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <LabelPrimitive
    data-slot="field-label"
    :class="props.class"
  >
    <slot />
  </LabelPrimitive>
</template>
