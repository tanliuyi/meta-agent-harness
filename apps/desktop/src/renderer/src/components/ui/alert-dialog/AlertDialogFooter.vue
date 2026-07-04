<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
const rootClass = computed(() => cn('flex flex-row flex-wrap justify-end gap-2', props.class))
</script>

<template>
  <div data-slot="alert-dialog-footer" :class="rootClass">
    <slot />
  </div>
</template>
