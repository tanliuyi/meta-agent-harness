<script setup lang="ts">
import type { SelectLabelProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { SelectLabel } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<SelectLabelProps & { class?: HTMLAttributes['class'] }>()
const rootClass = computed(() => cn('text-muted-foreground px-2 py-1.5 text-xs', props.class))
</script>

<template>
  <SelectLabel
    data-slot="select-label"
    :class="rootClass"
  >
    <slot />
  </SelectLabel>
</template>
