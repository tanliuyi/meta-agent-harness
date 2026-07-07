<script setup lang="ts">
import type { SelectItemProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { SelectItem, useForwardProps } from 'reka-ui'
import SelectItemText from './SelectItemText.vue'

const props = defineProps<SelectItemProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <SelectItem data-slot="select-item" v-bind="forwardedProps" :class="props.class">
    <SelectItemText>
      <slot />
    </SelectItemText>
  </SelectItem>
</template>

<style scoped>
[data-slot='select-item'],
[data-slot='select-item']:focus {
  box-shadow: none;
  outline: none;
}
</style>
