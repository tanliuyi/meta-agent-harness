<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Separator } from '@/components/ui/separator'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-slot="field-separator"
    :data-content="!!$slots.default"
    :class="props.class"
  >
    <Separator class="field-separator__rule" />
    <span
      v-if="$slots.default"
      class="field-separator__content"
      data-slot="field-separator-content"
    >
      <slot />
    </span>
  </div>
</template>
