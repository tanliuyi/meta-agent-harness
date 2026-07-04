<script setup lang="ts">
import type { ListboxContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ListboxContent, useForwardProps } from 'reka-ui'

const props = defineProps<ListboxContentProps & { class?: HTMLAttributes['class'] }>()
const delegatedProps = reactiveOmit(props, 'class')
const forwarded = useForwardProps(delegatedProps)
</script>

<template>
  <ListboxContent
    data-slot="command-list"
    v-bind="forwarded"
    :class="props.class"
  >
    <div role="presentation">
      <slot />
    </div>
  </ListboxContent>
</template>
