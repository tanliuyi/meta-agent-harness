<script setup lang="ts">
import type { SelectTriggerProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { ChevronDown } from '@lucide/vue'
import { reactiveOmit } from '@vueuse/core'
import { SelectIcon, SelectTrigger, useForwardProps } from 'reka-ui'
import { cn } from '@/lib/utils'

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
    :class="
      cn(
        'border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*=\'text-\'])]:text-muted-foreground aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-1 rounded-md border bg-transparent px-3 py-1 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-(--field-control-height) data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-4',
        variant === 'borderless' &&
          'border-transparent shadow-none hover:bg-transparent focus-visible:border-transparent focus-visible:ring-0 focus-visible:shadow-none dark:bg-transparent dark:hover:bg-transparent',
        props.class
      )
    "
  >
    <slot />
    <SelectIcon v-if="!hideIcon" as-child>
      <ChevronDown class="size-4 opacity-50" />
    </SelectIcon>
  </SelectTrigger>
</template>

<style scoped>
[data-slot='select-trigger'][data-variant='borderless'],
[data-slot='select-trigger'][data-variant='borderless']:hover,
[data-slot='select-trigger'][data-variant='borderless']:focus-visible {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  outline: none;
}
</style>
