<script setup lang="ts">
import type { TooltipTriggerProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { TooltipTrigger } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<TooltipTriggerProps & { class?: HTMLAttributes['class'] }>()
</script>

<template>
  <TooltipTrigger
    data-slot="tooltip-trigger"
    :class="cn('focus-visible:ring-ring/50 outline-none focus-visible:ring-3', props.class)"
    v-bind="props"
  >
    <slot />
  </TooltipTrigger>
</template>
