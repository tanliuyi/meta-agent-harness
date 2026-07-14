<script setup lang="ts">
import { useTemplateRef, watch } from 'vue'
import { useChatContext } from './use-chat-context'
import ChatMessage from './chat-message.vue'
import type {
  ChatMessagesProps,
  ChatSlotContent,
  ChatUIMessage,
} from './types'

const props = withDefaults(defineProps<ChatMessagesProps>(), {
  autoScroll: true
})

defineSlots<{
  default?: (props: {
    message: ChatUIMessage
    index: number
  }) => ChatSlotContent
  emptyState?: () => ChatSlotContent
  loadingState?: () => ChatSlotContent
  errorState?: (props: {
    error: Error
    reload: () => void
  }) => ChatSlotContent
}>()

const { messages, isLoading, error, reload } = useChatContext()
const containerRef = useTemplateRef('containerRef')

// Auto-scroll to bottom on new messages
watch(
  messages,
  () => {
    if (props.autoScroll && containerRef.value) {
      containerRef.value.scrollTop = containerRef.value.scrollHeight
    }
  },
  { flush: 'post' }
)
</script>

<template>
  <!-- Error state -->
  <slot
    v-if="error && $slots['errorState']"
    name="errorState"
    :error="error"
    :reload="reload"
  />
  <template v-else>
    <!-- Loading state (only show if no messages yet) -->
    <slot v-if="isLoading && messages.length === 0 && $slots['loadingState']" name="loadingState" />
    <template v-else>
      <!-- Empty state -->
      <slot v-if="messages.length === 0 && $slots['emptyState']" name="emptyState" />
      <!-- Messages -->
      <div
        v-else
        ref="containerRef"
        :class="props.class"
        data-chat-messages
        :data-message-count="messages.length"
      >
        <div v-for="(message, index) in messages" :key="message.id" :data-message-id="message.id">
          <slot
            v-if="$slots['default']"
            :message="message"
            :index="index"
          />
          <ChatMessage v-else :message="message" />
        </div>
      </div>
    </template>
  </template>
</template>
