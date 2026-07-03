<script setup lang="ts">
import type { RenderableThreadMessage } from './renderable-message'
import { getMessageText } from './message-format'
import StreamingMarkdown from '../../markdown/StreamingMarkdown.vue'

const props = defineProps<{
  message: RenderableThreadMessage
  text?: string
}>()
</script>

<template>
  <div class="assistant-message">
    <StreamingMarkdown
      :source="props.text ?? getMessageText(message) ?? ''"
      :revision="message.revision"
      :is-streaming="message.renderState === 'streaming'"
      :message-id="message.id"
    />
  </div>
</template>

<style lang="scss" scoped>
.assistant-message {
  width: 100%;
  // padding: var(--space-4);
  // background: color-mix(in srgb, var(--color-surface-raised) 86%, transparent);
  // border: 1px solid color-mix(in srgb, var(--color-border) 74%, transparent);
  // border-radius: var(--radius-md);
  // box-shadow: var(--shadow-sm);
  color: var(--color-text);
  font-size: 13px;
  line-height: 1.55;
}
</style>
