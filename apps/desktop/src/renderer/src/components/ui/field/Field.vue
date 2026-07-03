<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { FieldVariants } from '.'
import { computed } from 'vue'
import { cn } from '@/lib/utils'
import { fieldVariants } from '.'

const props = defineProps<{
  class?: HTMLAttributes['class']
  orientation?: FieldVariants['orientation']
}>()
const rootClass = computed(() => cn(fieldVariants({ orientation: props.orientation }), props.class))
</script>

<template>
  <div
    role="group"
    data-slot="field"
    :data-orientation="orientation"
    :class="rootClass"
  >
    <slot />
  </div>
</template>
