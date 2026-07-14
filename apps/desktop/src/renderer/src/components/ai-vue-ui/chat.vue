<script setup lang="ts">
import { provide } from 'vue'
import { useChat } from '@tanstack/ai-vue'
import { CHAT_KEY } from './use-chat-context'
import type { StreamChunk } from '@tanstack/ai'
import type { UIMessage } from '@tanstack/ai-vue'
import type { ChatProps } from './types'

const props = defineProps<ChatProps>()

const emit = defineEmits<{
  response: [response?: Response]
  chunk: [chunk: StreamChunk]
  finish: [message: UIMessage]
  error: [error: Error]
}>()

defineSlots<{
  default: () => unknown
}>()

const chat = useChat({
  connection: props.connection,
  ...(props.initialMessages !== undefined && {
    initialMessages: props.initialMessages,
  }),
  ...(props.id !== undefined && { id: props.id }),
  ...(props.threadId !== undefined && { threadId: props.threadId }),
  ...(props.live !== undefined && { live: props.live }),
  body: props.body,
  onResponse: (response?: Response) => emit('response', response),
  onChunk: (chunk: StreamChunk) => emit('chunk', chunk),
  onFinish: (message: UIMessage) => emit('finish', message),
  onError: (error: Error) => emit('error', error),
  ...(props.tools !== undefined && { tools: props.tools }),
})

provide(CHAT_KEY, chat)
</script>

<template>
  <div :class="props.class" data-chat-root>
    <slot />
  </div>
</template>
