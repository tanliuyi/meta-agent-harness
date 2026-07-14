<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Message } from '@ag-ui/core'
import type { WorkspaceRuntimeTimelineEvent } from '@renderer/stores/workspace-session'
import { formatMessageTime, getMessageText } from './support/message-format'

const props = defineProps<{
  message: Message
  event?: WorkspaceRuntimeTimelineEvent
}>()

const createdAtLabel = computed(() => formatMessageTime(props.event?.createdAt))
const messageText = computed(() => getMessageText(props.message) ?? '')
const systemName = computed(() =>
  props.message.role === 'system' ? props.message.name : undefined
)
const title = computed(() => props.event?.title ?? systemName.value ?? '系统')
const description = computed(() => props.event?.message)
const metaItems = computed(() => props.event?.meta ?? [])
const kindClass = computed(() => `system-message--${systemName.value ?? 'note'}`)
const expanded = ref(false)
const canExpand = computed(() => messageText.value.length > 360)
</script>

<template>
  <article class="system-message" :class="kindClass">
    <header class="system-message__meta">
      <span>{{ title }}</span>
      <time v-if="event?.createdAt">{{ createdAtLabel }}</time>
    </header>
    <p v-if="description" class="system-message__description">{{ description }}</p>
    <div v-if="metaItems.length > 0" class="system-message__tags">
      <span v-for="item in metaItems" :key="item">{{ item }}</span>
    </div>
    <pre v-if="messageText && (expanded || !canExpand)" class="system-message__content">{{
      messageText
    }}</pre>
    <button
      v-if="canExpand"
      type="button"
      class="system-message__toggle"
      @click="expanded = !expanded"
    >
      {{ expanded ? '收起' : '展开详情' }}
    </button>
  </article>
</template>

<style lang="scss" scoped>
.system-message {
  max-width: min(100%, 760px);
  padding: 10px 12px;
  border-left: 2px solid var(--color-border);
  color: var(--color-text-muted);
}

.system-message__meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
}

.system-message__description,
.system-message__content {
  margin: 6px 0 0;
  white-space: pre-wrap;
}

.system-message__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  font-size: 11px;
}

.system-message__toggle {
  margin-top: 6px;
  color: var(--color-text-muted);
  font-size: 12px;
}
</style>
