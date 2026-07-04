<script setup lang="ts">
import type { ListboxItemEmits, ListboxItemProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit, useCurrentElement } from '@vueuse/core'
import { ListboxItem, useForwardPropsEmits, useId } from 'reka-ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useCommand, useCommandGroup } from '.'

const props = defineProps<ListboxItemProps & { class?: HTMLAttributes['class'] }>()
const emits = defineEmits<ListboxItemEmits>()
const delegatedProps = reactiveOmit(props, 'class')
const forwarded = useForwardPropsEmits(delegatedProps, emits)

const id = useId()
const { filterState, allItems, allGroups } = useCommand()
const groupContext = useCommandGroup()
const itemRef = ref()
const currentElement = useCurrentElement(itemRef)

const isRender = computed(() => {
  if (!filterState.search) {
    return true
  }
  const filteredCurrentItem = filterState.filtered.items.get(id)
  return filteredCurrentItem === undefined || filteredCurrentItem > 0
})

onMounted(() => {
  if (!(currentElement.value instanceof HTMLElement)) {
    return
  }

  allItems.value.set(id, currentElement.value.textContent ?? props.value?.toString() ?? '')
  const groupId = groupContext?.id
  if (!groupId) {
    return
  }
  if (!allGroups.value.has(groupId)) {
    allGroups.value.set(groupId, new Set([id]))
    return
  }
  allGroups.value.get(groupId)?.add(id)
})

onUnmounted(() => {
  allItems.value.delete(id)
})
</script>

<template>
  <ListboxItem
    v-if="isRender"
    v-bind="forwarded"
    :id="id"
    ref="itemRef"
    data-slot="command-item"
    :class="props.class"
    @select="filterState.search = ''"
  >
    <slot />
  </ListboxItem>
</template>
