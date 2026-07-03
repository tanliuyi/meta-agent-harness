<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
  variant?: 'legend' | 'label'
}>()
const rootClass = computed(() =>
  cn(
    'mb-3 font-medium',
    'data-[variant=legend]:text-base',
    'data-[variant=label]:text-sm',
    props.class
  )
)
</script>

<template>
  <legend
    data-slot="field-legend"
    :data-variant="variant"
    :class="rootClass"
  >
    <slot />
  </legend>
</template>
