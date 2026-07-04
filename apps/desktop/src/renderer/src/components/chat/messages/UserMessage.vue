<script setup lang="ts">
import { computed } from 'vue'
import type { RenderableThreadMessage } from './renderable-message'
import {
  getMessageFileAttachments,
  getMessageImageSrc,
  getStandaloneMessageImages,
  getUserMessageDisplaySegments
} from './message-format'

const props = defineProps<{
  message: RenderableThreadMessage
}>()

const fileAttachments = computed(() => getMessageFileAttachments(props.message))
const standaloneImages = computed(() => getStandaloneMessageImages(props.message))
const displaySegments = computed(() => getUserMessageDisplaySegments(props.message))
</script>

<template>
  <div class="user-message">
    <div v-if="fileAttachments.length > 0" class="user-message__attachments">
      <div
        v-for="(attachment, index) in fileAttachments"
        :key="`${attachment.name}-${index}`"
        :class="[
          'user-message__attachment',
          { 'user-message__attachment--image': attachment.imageSrc }
        ]"
      >
        <img
          v-if="attachment.imageSrc"
          class="user-message__attachment-image"
          :src="attachment.imageSrc"
          alt=""
        />
        <span v-if="!attachment.imageSrc" class="user-message__attachment-name">{{
          attachment.name
        }}</span>
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
    <div v-if="displaySegments.length > 0" class="user-message__text">
      <template v-for="(segment, index) in displaySegments" :key="index">
        <span v-if="segment.type === 'text'">{{ segment.text }}</span>
        <span v-else class="file-reference-node" :title="segment.fileArg">
          <span class="file-reference-node__icon">@</span>
          <span class="file-reference-node__label">{{ segment.label }}</span>
        </span>
      </template>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use '../file-reference-node';

.user-message {
  display: flex;
  flex-direction: column;
  align-self: flex-end;
  width: fit-content;
  min-width: 0;
  max-width: min(640px, 88%);
  padding: var(--space-1) var(--space-2);
  background: var(--user-message-bg);
  border: 1px solid var(--user-message-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  color: var(--color-text);
  font-size: var(--font-size-ui);
  line-height: 1.6;
  word-break: break-all;
  overflow-wrap: anywhere;
}

.user-message__text {
  white-space: pre-wrap;
}

.file-reference-node {
  @include file-reference-node.file-reference-node;
}

.file-reference-node__icon {
  @include file-reference-node.file-reference-node-icon;
}

.file-reference-node__label {
  @include file-reference-node.file-reference-node-label;
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
    border: 1px solid var(--user-message-media-border);
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
  background: var(--user-message-attachment-bg);
  border: 1px solid var(--user-message-attachment-border);
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
  border: 1px solid var(--user-message-media-border);
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
