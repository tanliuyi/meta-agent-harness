<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from 'vue'
import { useChatContext } from './use-chat-context'
import ChatMessage from './chat-message.vue'
import type { ChatMessagesProps, ChatSlotContent, ChatUIMessage } from './types'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { ComponentPublicInstance } from 'vue'

const props = withDefaults(defineProps<ChatMessagesProps>(), {
  autoScroll: true
})

defineSlots<{
  default?: (props: { message: ChatUIMessage; index: number }) => ChatSlotContent
  emptyState?: () => ChatSlotContent
  loadingState?: () => ChatSlotContent
  errorState?: (props: { error: Error; reload: () => void }) => ChatSlotContent
}>()

const { messages, isLoading, error, reload } = useChatContext()
const containerRef = useTemplateRef('containerRef')

const virtualizer = useVirtualizer({
  get count() {
    return messages.value.length
  },
  getScrollElement() {
    return containerRef.value
  },
  getItemKey(index) {
    return messages.value[index].id
  },
  anchorTo: 'end',
  get followOnAppend() {
    return props.autoScroll
  },
  estimateSize: () => 72,
  overscan: 6,
  scrollEndThreshold: 80,
  gap: 24,
  paddingStart: 32,
  paddingEnd: 32
})

const measureElement = (element: Element | ComponentPublicInstance | null): void => {
  if (element instanceof Element) {
    virtualizer.value.measureElement(element)
  }
}

let hasInitialScroll = false

watch(
  [containerRef, () => messages.value.length],
  async ([container, messageCount]): Promise<void> => {
    if (hasInitialScroll || !props.autoScroll || !container || messageCount === 0) return

    hasInitialScroll = true
    await nextTick()
    virtualizer.value.scrollToEnd()
  },
  { flush: 'post', immediate: true }
)
</script>

<template>
  <!-- Error state -->
  <slot v-if="error && $slots['errorState']" name="errorState" :error="error" :reload="reload" />
  <template v-else>
    <!-- Loading state (only show if no messages yet) -->
    <slot v-if="isLoading && messages.length === 0 && $slots['loadingState']" name="loadingState" />
    <template v-else>
      <!-- Empty state -->
      <slot v-if="messages.length === 0 && $slots['emptyState']" name="emptyState" />
      <!-- Messages -->

      <div
        ref="containerRef"
        :class="props.class"
        class="chat-messages__scroller"
        data-chat-messages
        :data-message-count="messages.length"
      >
        <div
          class="chat-messages__list"
          :style="{
            flex: '0 0 auto',
            height: virtualizer.getTotalSize() + 'px',
            position: 'relative',
            width: '100%'
          }"
        >
          <div
            v-for="virtualItem in virtualizer.getVirtualItems()"
            :key="messages[virtualItem.index].id"
            :ref="measureElement"
            :data-index="virtualItem.index"
            :data-message-id="messages[virtualItem.index].id"
            :style="{
              position: 'absolute',
              top: 0,
              left: 0,
              transform: `translateY(${virtualItem.start}px)`,
              width: '100%'
            }"
          >
            <slot
              v-if="$slots['default']"
              :message="messages[virtualItem.index]"
              :index="virtualItem.index"
            />
            <ChatMessage v-else :message="messages[virtualItem.index]" />
          </div>
        </div>
      </div>
    </template>
  </template>
</template>

<style lang="scss" scoped>
.chat-messages__scroller {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.chat-messages__list {
  width: 100%;
  max-width: 768px;
  margin: 0 auto;
}
</style>
