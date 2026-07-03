<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
const rootClass = computed(() =>
  cn('group/field-content flex flex-1 flex-col gap-1.5 leading-snug', props.class)
)
</script>

<template>
  <div
    data-slot="field-content"
    :class="rootClass"
  >
    <slot />
  </div>
</template>
