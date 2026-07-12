<script setup lang="ts">
import type { SelectContentEmits, SelectContentProps } from 'reka-ui'
import type { HTMLAttributes, StyleValue } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { SelectContent, SelectPortal, SelectViewport, useForwardPropsEmits } from 'reka-ui'
import { SelectScrollDownButton, SelectScrollUpButton } from '.'

defineOptions({
  inheritAttrs: false
})

const props = withDefaults(
  defineProps<
    SelectContentProps & { class?: HTMLAttributes['class']; contentStyle?: StyleValue }
  >(),
  {
    position: 'popper'
  }
)
const emits = defineEmits<SelectContentEmits>()

const delegatedProps = reactiveOmit(props, 'class', 'contentStyle')

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <SelectPortal>
    <SelectContent
      data-slot="select-content"
      v-bind="{ ...forwarded, ...$attrs }"
      :class="props.class"
      :style="props.contentStyle"
    >
      <SelectScrollUpButton />
      <SelectViewport data-slot="select-viewport" :data-position="position">
        <slot />
      </SelectViewport>
      <SelectScrollDownButton />
    </SelectContent>
  </SelectPortal>
</template>
