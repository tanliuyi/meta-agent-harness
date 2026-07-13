<script setup lang="ts">
import type { SelectTriggerProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { ChevronDown } from '@lucide/vue'
import { reactiveOmit } from '@vueuse/core'
import { SelectIcon, SelectTrigger, useForwardProps } from 'reka-ui'

type SelectTriggerVariant = 'default' | 'borderless'

const props = withDefaults(
  defineProps<
    SelectTriggerProps & {
      class?: HTMLAttributes['class']
      size?: 'sm' | 'default'
      variant?: SelectTriggerVariant
      hideIcon?: boolean
    }
  >(),
  { size: 'default', variant: 'default', hideIcon: false }
)

const delegatedProps = reactiveOmit(props, 'class', 'size', 'variant', 'hideIcon')
const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <SelectTrigger
    data-slot="select-trigger"
    :data-variant="variant"
    :data-size="size"
    v-bind="forwardedProps"
    :class="props.class"
  >
    <slot />
    <SelectIcon v-if="!hideIcon" as-child>
      <ChevronDown />
    </SelectIcon>
  </SelectTrigger>
</template>

<style scoped>
[data-slot='select-trigger'] {
  svg {
    transition: transform var(--duration-fast) var(--ease-standard);
  }

  &[data-state='open'] svg {
    transform: rotate(180deg);
  }
}

[data-slot='select-trigger'][data-variant='borderless'],
[data-slot='select-trigger'][data-variant='borderless']:hover {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  outline: none;
}
</style>
