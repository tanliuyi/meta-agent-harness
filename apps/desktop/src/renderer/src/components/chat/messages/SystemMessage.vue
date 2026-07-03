<script setup lang="ts">
import { computed } from 'vue'
import type { RenderableThreadMessage } from './renderable-message'
import { formatMessageTime, getMessageText } from './message-format'

const props = defineProps<{
  message: RenderableThreadMessage
}>()

const createdAtLabel = computed(() => formatMessageTime(props.message.createdAt))
const messageText = computed(() => getMessageText(props.message) ?? '')
</script>

<template>
  <article class="system-message">
    <header class="system-message__meta">
      <span>系统</span>
      <time v-if="message.createdAt">{{ createdAtLabel }}</time>
    </header>
    <p v-if="messageText">{{ messageText }}</p>
  </article>
</template>

<style lang="scss" scoped>
.system-message {
  display: grid;
  gap: var(--space-1);
  width: min(680px, 100%);
  padding: var(--space-3) var(--space-4);
  color: var(--color-text-muted);
  background: var(--color-control-track);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);

  p {
    margin: 0;
    font-size: var(--font-size-ui-sm);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }
}

.system-message__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--font-size-ui);
}
</style>
