<script setup lang="ts">
import { computed, ref } from 'vue'
import type { RenderableThreadMessage } from './renderable-message'
import { formatMessageTime, getMessageText } from './message-format'

const props = defineProps<{
  message: RenderableThreadMessage
}>()

const createdAtLabel = computed(() => formatMessageTime(props.message.createdAt))
const messageText = computed(() => getMessageText(props.message) ?? '')
const systemEvent = computed(() => props.message.systemEvent)
const title = computed(() => systemEvent.value?.title ?? '系统')
const description = computed(() => systemEvent.value?.description)
const metaItems = computed(() => systemEvent.value?.meta ?? [])
const kindClass = computed(() =>
  systemEvent.value ? `system-message--${systemEvent.value.kind}` : 'system-message--default'
)
const expanded = ref(false)
const canExpand = computed(() => messageText.value.length > 360)
</script>

<template>
  <article class="system-message" :class="kindClass">
    <header class="system-message__meta">
      <span>{{ title }}</span>
      <time v-if="message.createdAt">{{ createdAtLabel }}</time>
    </header>
    <p v-if="description" class="system-message__description">{{ description }}</p>
    <div v-if="metaItems.length > 0" class="system-message__tags">
      <span v-for="item in metaItems" :key="item">{{ item }}</span>
    </div>
    <p
      v-if="messageText"
      class="system-message__body"
      :class="{ 'is-expanded': expanded || !canExpand }"
    >
      {{ messageText }}
    </p>
    <button
      v-if="canExpand"
      type="button"
      class="system-message__toggle"
      @click="expanded = !expanded"
    >
      {{ expanded ? '收起摘要' : '展开摘要' }}
    </button>
  </article>
</template>

<style lang="scss" scoped>
.system-message {
  display: grid;
  gap: 6px;
  width: min(600px, 100%);
  padding: var(--space-2) var(--space-3);
  color: var(--color-text-muted);
  background: var(--color-control-track);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);

  p {
    margin: 0;
    font-size: var(--font-size-ui-xs);
    line-height: 1.4;
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
  font-size: var(--font-size-ui-xs);
  line-height: 1.3;

  span {
    font-weight: 650;
  }

  time {
    flex-shrink: 0;
    color: var(--color-text-subtle);
  }
}

.system-message__description {
  color: var(--color-text-muted);
}

.system-message__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;

  span {
    min-height: 16px;
    padding: 0 5px;
    color: var(--color-text-subtle);
    font-family: var(--font-mono);
    font-size: var(--font-size-ui-2xs);
    line-height: 16px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xs);
  }
}

.system-message__body {
  display: -webkit-box;
  overflow: hidden;
  color: var(--color-text);
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;

  &.is-expanded {
    display: block;
    overflow: visible;
    -webkit-line-clamp: unset;
  }
}

.system-message__toggle {
  justify-self: start;
  min-height: 20px;
  padding: 0;
  color: var(--color-primary);
  font-size: var(--font-size-ui-xs);
  font-weight: 650;
  background: transparent;
  border: 0;
  cursor: pointer;

  &:hover {
    color: var(--color-primary-strong);
  }
}

.system-message--compaction {
  border-color: var(--color-primary-outline);
}

.system-message--agentEvent {
  gap: var(--space-1);

  .system-message__description {
    display: none;
  }
}
</style>
