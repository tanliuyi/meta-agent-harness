<script setup lang="ts">
import type { RenderableThreadMessage } from './renderable-message'
import {
  getMessageFileAttachments,
  getMessageImageSrc,
  getStandaloneMessageImages,
  getUserMessageDisplayText
} from './message-format'
import StreamingMarkdown from '../../markdown/StreamingMarkdown.vue'

defineProps<{
  message: RenderableThreadMessage
}>()
</script>

<template>
  <div class="user-message">
    <div v-if="getMessageFileAttachments(message).length > 0" class="user-message__attachments">
      <div
        v-for="attachment in getMessageFileAttachments(message)"
        :key="attachment.name"
        class="user-message__attachment"
      >
        <img
          v-if="attachment.imageSrc"
          class="user-message__attachment-image"
          :src="attachment.imageSrc"
          alt=""
        />
        <span class="user-message__attachment-name">{{ attachment.name }}</span>
        <span v-if="attachment.note" class="user-message__attachment-note">
          {{ attachment.note }}
        </span>
      </div>
    </div>
    <div v-if="getStandaloneMessageImages(message).length > 0" class="user-message__images">
      <img
        v-for="(image, index) in getStandaloneMessageImages(message)"
        :key="`${image.mimeType}-${index}`"
        :src="getMessageImageSrc(image)"
        alt=""
      />
    </div>
    <StreamingMarkdown
      v-if="getUserMessageDisplayText(message)"
      :source="getUserMessageDisplayText(message) ?? ''"
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
  line-height: 1.6;
}

.user-message__images {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: var(--space-2);
  width: min(420px, 100%);

  &:not(:last-child) {
    margin-bottom: var(--space-2);
  }

  img {
    width: 100%;
    max-height: 260px;
    object-fit: cover;
    border: 1px solid color-mix(in srgb, var(--color-primary) 28%, var(--color-border));
    border-radius: var(--radius-sm);
  }
}

.user-message__attachments {
  display: grid;
  gap: var(--space-1);

  &:not(:last-child) {
    margin-bottom: var(--space-2);
  }
}

.user-message__attachment {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 6px 8px;
  background: color-mix(in srgb, var(--color-surface) 72%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-primary) 24%, var(--color-border));
  border-radius: var(--radius-sm);
}

.user-message__attachment-image {
  width: 100%;
  max-height: 260px;
  object-fit: contain;
  background: var(--color-surface);
  border: 1px solid color-mix(in srgb, var(--color-primary) 28%, var(--color-border));
  border-radius: var(--radius-sm);
}

.user-message__attachment-name,
.user-message__attachment-note {
  overflow-wrap: anywhere;
}

.user-message__attachment-name {
  font-size: 12px;
  color: var(--color-text);
}

.user-message__attachment-note {
  font-size: 11px;
  color: var(--color-text-muted);
}
</style>
