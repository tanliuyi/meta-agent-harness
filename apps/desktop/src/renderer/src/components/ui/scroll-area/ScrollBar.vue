<script setup lang="ts">
import type { ScrollAreaScrollbarProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ScrollAreaScrollbar, ScrollAreaThumb } from 'reka-ui'

const props = withDefaults(
  defineProps<
    ScrollAreaScrollbarProps & {
      class?: HTMLAttributes['class']
      offset?: number
      size?: number
    }
  >(),
  {
    orientation: 'vertical'
  }
)

const delegatedProps = reactiveOmit(props, 'class', 'offset', 'size')

const scrollbarStyle = computed(() => {
  const styles: Record<string, string> = {}
  if (props.offset) {
    const position = props.orientation === 'horizontal' ? 'bottom' : 'right'
    styles[position] = `${props.offset}px`
  }
  if (props.size) {
    const dimension = props.orientation === 'horizontal' ? 'height' : 'width'
    styles[dimension] = `${props.size}px`
  }
  return Object.keys(styles).length > 0 ? styles : undefined
})
</script>

<template>
  <ScrollAreaScrollbar
    data-slot="scroll-area-scrollbar"
    v-bind="delegatedProps"
    :class="props.class"
    :style="scrollbarStyle"
  >
    <ScrollAreaThumb data-slot="scroll-area-thumb" />
  </ScrollAreaScrollbar>
</template>
