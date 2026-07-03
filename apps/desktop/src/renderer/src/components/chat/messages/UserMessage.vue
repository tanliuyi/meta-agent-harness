<script setup lang="ts">
import { computed } from 'vue'
import type { RenderableThreadMessage } from './renderable-message'
import {
  getMessageFileAttachments,
  getMessageImageSrc,
  getStandaloneMessageImages,
  getUserMessageDisplayMarkdown
} from './message-format'
import StreamingMarkdown from '../../markdown/StreamingMarkdown.vue'

const props = defineProps<{
  message: RenderableThreadMessage
}>()

const fileAttachments = computed(() => getMessageFileAttachments(props.message))
const standaloneImages = computed(() => getStandaloneMessageImages(props.message))
const displayMarkdown = computed(() => getUserMessageDisplayMarkdown(props.message) ?? '')
</script>

<template>
  <div class="user-message">
    <div v-if="fileAttachments.length > 0" class="user-message__attachments">
      <div
        v-for="(attachment, index) in fileAttachments"
        :key="`${attachment.name}-${index}`"
        :class="['user-message__attachment', { 'user-message__attachment--image': attachment.imageSrc }]"
      >
        <img
          v-if="attachment.imageSrc"
          class="user-message__attachment-image"
          :src="attachment.imageSrc"
          alt=""
        />
        <span v-if="!attachment.imageSrc" class="user-message__attachment-name">{{ attachment.name }}</span>
        <span v-if="attachment.note" class="user-message__attachment-note">
          {{ attachment.note }}
        </span>
      </div>
    </div>
    <div v-if="standaloneImages.length > 0" class="user-message__images">
      <img
        v-for="(image, index) in standaloneImages"
        :key="`${image.mimeType}-${index}`"
        :src="getMessageImageSrc(image)"
        alt=""
      />
    </div>
    <StreamingMarkdown
      v-if="displayMarkdown"
      :source="displayMarkdown"
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
  width: fit-content;
  min-width: 0;
  max-width: min(640px, 88%);
  padding: var(--space-2);
  background: color-mix(in srgb, var(--color-primary) 18%, var(--color-surface-raised));
  border: 1px solid color-mix(in srgb, var(--color-primary) 38%, var(--color-border));
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  color: var(--color-text);
  font-size: var(--font-size-ui);
  line-height: 1.6;
  word-break: break-all;
  overflow-wrap: anywhere;
}

.user-message__images {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: var(--space-2);
  width: min(320px, 100%);

  &:not(:last-child) {
    margin-bottom: var(--space-2);
  }

  img {
    width: 100%;
    max-height: 180px;
    object-fit: cover;
    border: 1px solid color-mix(in srgb, var(--color-primary) 28%, var(--color-border));
    border-radius: var(--radius-md);
  }
}

.user-message__attachments {
  display: grid;
  gap: var(--space-2);
  width: 100%;

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

  &--image {
    justify-self: end;
    width: fit-content;
    padding: 0;
    background: transparent;
    border: none;
    gap: 4px;
  }
}

.user-message__attachment-image {
  width: 100%;
  max-height: 180px;
  object-fit: cover;
  background: var(--color-surface);
  border: 1px solid color-mix(in srgb, var(--color-primary) 28%, var(--color-border));
  border-radius: var(--radius-md);

  .user-message__attachment--image & {
    width: 96px;
    height: 96px;
    object-fit: cover;
  }
}

.user-message__attachment-name,
.user-message__attachment-note {
  overflow-wrap: anywhere;
}

.user-message__attachment-name {
  font-size: var(--font-size-ui-sm);
  color: var(--color-text);
}

.user-message__attachment-note {
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-muted);
}
</style>
