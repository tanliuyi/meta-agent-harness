<script setup lang="ts">
import type { RenderableThreadMessage } from './renderable-message'
import { getMessageText } from './message-format'
import StreamingMarkdown from '../../markdown/StreamingMarkdown.vue'

defineProps<{
  message: RenderableThreadMessage
}>()
</script>

<template>
  <div class="user-message">
    <StreamingMarkdown
      :source="getMessageText(message) ?? ''"
      :revision="message.revision"
      :is-streaming="message.renderState === 'streaming'"
      :message-id="message.id"
    />
  </div>
</template>

<style lang="scss" scoped>
.user-message {
  display: flex;
  flex-direction: column;
  align-self: flex-end;
  max-width: min(640px, 88%);
  padding: var(--space-2);
  background: color-mix(in srgb, var(--color-primary) 18%, var(--color-surface-raised));
  border: 1px solid color-mix(in srgb, var(--color-primary) 38%, var(--color-border));
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  color: var(--color-text);
  font-size: 13px;
  line-height: 1.55;
}
</style>
