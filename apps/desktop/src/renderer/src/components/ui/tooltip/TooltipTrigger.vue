<script setup lang="ts">
import type { TooltipTriggerProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { TooltipTrigger } from 'reka-ui'

const props = defineProps<TooltipTriggerProps & { class?: HTMLAttributes['class'] }>()
</script>

<template>
  <TooltipTrigger
    data-slot="tooltip-trigger"
    :class="props.class"
    v-bind="props"
  >
    <slot />
  </TooltipTrigger>
</template>
