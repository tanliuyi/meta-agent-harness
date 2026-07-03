<script setup lang="ts">
import type { ScrollAreaRootProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { computed, ref } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ScrollAreaCorner, ScrollAreaRoot, ScrollAreaViewport } from 'reka-ui'
import { cn } from '@/lib/utils'
import ScrollBar from './ScrollBar.vue'

const props = withDefaults(
  defineProps<
    ScrollAreaRootProps & {
      class?: HTMLAttributes['class']
      scrollbars?: 'vertical' | 'horizontal' | 'both'
    }
  >(),
  {
    scrollbars: 'vertical'
  }
)
const emit = defineEmits<{
  scroll: [event: Event]
}>()

const delegatedProps = reactiveOmit(props, 'class', 'scrollbars')

type ScrollAreaViewportInstance = {
  viewportElement?: HTMLElement
}
type ScrollAreaScrollBehavior = 'auto' | 'smooth'
type ScrollAreaScrollToOptions = {
  top?: number
  left?: number
  behavior?: ScrollAreaScrollBehavior
}
type ScrollAreaMetrics = {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}

const viewportRef = ref<ScrollAreaViewportInstance | null>(null)
const viewport = computed(() => viewportRef.value?.viewportElement)

/**
 * 获取 reka ScrollAreaViewport 暴露的真实滚动元素。
 * @returns viewport 元素。
 */
function getViewport(): HTMLElement | undefined {
  return viewport.value
}

/**
 * 滚动 viewport 到指定位置。
 * @param options - 滚动参数。
 */
function scrollTo(options: ScrollAreaScrollToOptions): void {
  const viewport = getViewport()
  if (!viewport) {
    return
  }

  if (options.behavior === 'auto') {
    if (typeof options.top === 'number') {
      viewport.scrollTop = options.top
    }
    if (typeof options.left === 'number') {
      viewport.scrollLeft = options.left
    }
    return
  }

  if (typeof viewport.scrollTo === 'function') {
    viewport.scrollTo(options)
    return
  }

  if (typeof options.top === 'number') {
    viewport.scrollTop = options.top
  }
  if (typeof options.left === 'number') {
    viewport.scrollLeft = options.left
  }
}

/**
 * 滚动 viewport 到顶部。
 */
function scrollTop(): void {
  scrollTo({ top: 0 })
}

/**
 * 滚动 viewport 到左上角。
 */
function scrollTopLeft(): void {
  scrollTo({ top: 0, left: 0 })
}

/**
 * 滚动 viewport 到底部。
 * @param behavior - 滚动行为。
 */
function scrollBottom(behavior: ScrollAreaScrollBehavior = 'smooth'): void {
  const viewportElement = getViewport()
  if (!viewportElement) {
    return
  }
  scrollTo({ top: viewportElement.scrollHeight, behavior })
}

/**
 * 获取滚动度量。
 * @returns 滚动度量。
 */
function getScrollMetrics(): ScrollAreaMetrics | undefined {
  const viewport = getViewport()
  if (!viewport) {
    return undefined
  }
  return {
    scrollHeight: viewport.scrollHeight,
    scrollTop: viewport.scrollTop,
    clientHeight: viewport.clientHeight
  }
}

defineExpose({
  getScrollMetrics,
  getViewport,
  scrollBottom,
  scrollTo,
  scrollTop,
  scrollTopLeft,
  viewport
})
</script>

<template>
  <ScrollAreaRoot
    data-slot="scroll-area"
    v-bind="delegatedProps"
    :class="cn('relative', props.class)"
  >
    <ScrollAreaViewport
      ref="viewportRef"
      data-slot="scroll-area-viewport"
      class="focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-3 focus-visible:outline-1"
      @scroll="emit('scroll', $event)"
    >
      <slot />
    </ScrollAreaViewport>
    <ScrollBar v-if="props.scrollbars === 'vertical' || props.scrollbars === 'both'" />
    <ScrollBar
      v-if="props.scrollbars === 'horizontal' || props.scrollbars === 'both'"
      orientation="horizontal"
    />
    <ScrollAreaCorner />
  </ScrollAreaRoot>
</template>
