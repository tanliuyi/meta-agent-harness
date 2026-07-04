<script setup lang="ts">
import type { ScrollAreaRootProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { computed, ref } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ScrollAreaCorner, ScrollAreaRoot, ScrollAreaViewport } from 'reka-ui'
import ScrollBar from './ScrollBar.vue'

const props = withDefaults(
  defineProps<
    ScrollAreaRootProps & {
      class?: HTMLAttributes['class']
      scrollbars?: 'vertical' | 'horizontal' | 'both'
      verticalOffset?: number
      horizontalOffset?: number
      verticalSize?: number
      horizontalSize?: number
    }
  >(),
  {
    scrollbars: 'vertical'
  }
)
const emit = defineEmits<{
  scroll: [event: Event]
  scrollbarPointerDown: [event: PointerEvent]
}>()

const delegatedProps = reactiveOmit(
  props,
  'class',
  'scrollbars',
  'verticalOffset',
  'verticalSize',
  'horizontalSize',
  'horizontalOffset'
)

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

/**
 * 仅把滚动条上的 pointer down 视作用户滚动意图。
 */
function handlePointerDown(event: PointerEvent): void {
  const target = event.target
  if (!(target instanceof Element)) {
    return
  }
  if (target.closest('[data-slot="scroll-area-scrollbar"], [data-slot="scroll-area-thumb"]')) {
    emit('scrollbarPointerDown', event)
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
    :class="props.class"
    @pointerdown.capture="handlePointerDown"
  >
    <ScrollAreaViewport
      ref="viewportRef"
      data-slot="scroll-area-viewport"
      @scroll="emit('scroll', $event)"
    >
      <slot />
    </ScrollAreaViewport>
    <ScrollBar
      v-if="props.scrollbars === 'vertical' || props.scrollbars === 'both'"
      :offset="props.verticalOffset"
      :size="props.verticalSize"
    />
    <ScrollBar
      v-if="props.scrollbars === 'horizontal' || props.scrollbars === 'both'"
      orientation="horizontal"
      :offset="props.horizontalOffset"
      :size="props.horizontalSize"
    />
    <ScrollAreaCorner />
  </ScrollAreaRoot>
</template>
