<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
const rootClass = computed(() => cn('text-muted-foreground ml-auto text-xs tracking-widest', props.class))
</script>

<template>
  <span
    data-slot="context-menu-shortcut"
    :class="rootClass"
  >
    <slot />
  </span>
</template>
