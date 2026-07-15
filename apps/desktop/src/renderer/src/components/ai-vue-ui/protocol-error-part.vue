<script setup lang="ts">
import { CircleAlert } from 'lucide-vue-next'
import type { ChatProtocolErrorDisplayItem } from './chat-display'

const props = defineProps<{
  item: ChatProtocolErrorDisplayItem
}>()

const contextText = JSON.stringify(props.item.issue.context, null, 2)
</script>

<template>
  <div class="protocol-error-part" role="alert">
    <CircleAlert :size="15" aria-hidden="true" />
    <div class="protocol-error-part__content">
      <div class="protocol-error-part__title">
        <span>{{ item.issue.message }}</span>
        <code>{{ item.issue.code }}</code>
      </div>
      <div v-if="item.issue.toolCallId" class="protocol-error-part__meta">
        toolCallId {{ item.issue.toolCallId }}
      </div>
      <details class="protocol-error-part__details">
        <summary>协议上下文</summary>
        <pre><code>{{ contextText }}</code></pre>
      </details>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.protocol-error-part {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2);
  color: var(--color-danger);
  background: color-mix(in srgb, var(--color-danger) 5%, transparent);
  border-top: 1px solid color-mix(in srgb, var(--color-danger) 30%, var(--color-border-muted));
  border-bottom: 1px solid color-mix(in srgb, var(--color-danger) 30%, var(--color-border-muted));
  font-size: var(--font-size-ui-xs);
}

.protocol-error-part > svg {
  flex: 0 0 auto;
  margin-top: 2px;
}

.protocol-error-part__content {
  min-width: 0;
}

.protocol-error-part__title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
}

.protocol-error-part__title code,
.protocol-error-part__meta {
  color: var(--color-text-subtle);
  font-family: var(--font-mono);
}

.protocol-error-part__details summary {
  margin-top: var(--space-1);
  color: var(--color-text-muted);
  cursor: pointer;
}

.protocol-error-part__details pre {
  max-width: 100%;
  margin: var(--space-1) 0 0;
  overflow-x: auto;
  color: var(--color-text-muted);
  white-space: pre-wrap;
}
</style>
