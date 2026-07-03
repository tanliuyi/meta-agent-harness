<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
const rootClass = computed(() => cn('flex flex-col gap-2 text-center sm:text-left', props.class))
</script>

<template>
  <div
    data-slot="alert-dialog-header"
    :class="rootClass"
  >
    <slot />
  </div>
</template>
