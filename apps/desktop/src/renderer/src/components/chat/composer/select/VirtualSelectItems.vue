<script setup lang="ts">
/**
 * VirtualSelectItems.vue - Composer Select 下拉中的按需虚拟列表。
 */

import { computed, ref, type ComponentPublicInstance } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import ScrollArea from '@renderer/components/ui/scroll-area/ScrollArea.vue'
import { SelectGroup, SelectItem } from '@renderer/components/ui/select'

export type VirtualSelectItem = {
  key?: string
  label: string
  value: string
  disabled?: boolean
}

const props = withDefaults(
  defineProps<{
    items: VirtualSelectItem[]
    itemSize?: number
    overscan?: number
    scrollClass?: string
    sizeClass?: string
    itemClass?: string
  }>(),
  {
    itemSize: 28,
    overscan: 8,
    scrollClass: undefined,
    sizeClass: undefined,
    itemClass: undefined
  }
)

type ScrollAreaInstance = InstanceType<typeof ScrollArea>

const scrollAreaRef = ref<ScrollAreaInstance | null>(null)
const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.items.length,
    getScrollElement: () => scrollAreaRef.value?.getViewport() ?? null,
    estimateSize: () => props.itemSize,
    overscan: props.overscan
  }))
)
const virtualItems = computed(() => virtualizer.value.getVirtualItems())
const virtualTotalSize = computed(() => virtualizer.value.getTotalSize())

function measureItem(refValue: Element | ComponentPublicInstance | null): void {
  const element = refValue instanceof Element ? refValue : refValue?.$el
  if (element instanceof Element) {
    virtualizer.value.measureElement(element)
  }
}
</script>

<template>
  <ScrollArea ref="scrollAreaRef" :class="scrollClass">
    <SelectGroup :class="sizeClass" :style="{ height: `${virtualTotalSize}px` }">
      <SelectItem
        v-for="virtualItem in virtualItems"
        :key="items[virtualItem.index]?.key ?? items[virtualItem.index]?.value"
        :ref="measureItem"
        :class="itemClass"
        :data-index="virtualItem.index"
        :disabled="items[virtualItem.index]?.disabled"
        :style="{ transform: `translateY(${virtualItem.start}px)` }"
        :value="items[virtualItem.index]?.value"
      >
        {{ items[virtualItem.index]?.label }}
      </SelectItem>
    </SelectGroup>
  </ScrollArea>
</template>
