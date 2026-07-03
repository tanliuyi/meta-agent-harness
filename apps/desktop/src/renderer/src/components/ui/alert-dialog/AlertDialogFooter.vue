<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
const rootClass = computed(() =>
  cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', props.class)
)
</script>

<template>
  <div
    data-slot="alert-dialog-footer"
    :class="rootClass"
  >
    <slot />
  </div>
</template>
