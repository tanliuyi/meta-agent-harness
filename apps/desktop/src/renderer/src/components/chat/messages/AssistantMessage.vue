<script setup lang="ts">
import { computed } from 'vue'
import type { RenderableThreadMessage } from './renderable-message'
import { getMessageText } from './message-format'
import StreamingMarkdown from '../../markdown/StreamingMarkdown.vue'

const props = defineProps<{
  message: RenderableThreadMessage
  text?: string
}>()

const source = computed(() => props.text ?? getMessageText(props.message) ?? '')
</script>

<template>
  <div class="assistant-message">
    <StreamingMarkdown
      :source="source"
      :revision="message.revision"
      :is-streaming="message.renderState === 'streaming'"
      :message-id="message.id"
    />
  </div>
</template>

<style lang="scss" scoped>
.assistant-message {
  width: 100%;
  color: var(--color-text);
  font-size: var(--font-size-ui);
  line-height: 1.6;
}
</style>
