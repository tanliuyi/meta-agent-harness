<script setup lang="ts">
import type { TooltipContentEmits, TooltipContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { TooltipArrow, TooltipContent, TooltipPortal, useForwardPropsEmits } from 'reka-ui'

const props = withDefaults(
  defineProps<
    TooltipContentProps & {
      class?: HTMLAttributes['class']
      showArrow?: boolean
    }
  >(),
  {
    side: 'top',
    align: 'center',
    sideOffset: 4,
    avoidCollisions: true,
    collisionPadding: 8
  }
)
const emits = defineEmits<TooltipContentEmits>()

const delegatedProps = reactiveOmit(props, 'class', 'showArrow')

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <TooltipPortal>
    <TooltipContent data-slot="tooltip-content" v-bind="forwarded" :class="props.class">
      <slot />
      <TooltipArrow v-if="showArrow" data-slot="tooltip-arrow" />
    </TooltipContent>
  </TooltipPortal>
</template>
