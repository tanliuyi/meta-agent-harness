<script setup lang="ts">
import { computed } from 'vue'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { ThreadSnapshot } from '@shared/coding-agent/types'
import type { RenderableThreadMessage } from './renderable-message'
import { formatUnknown, getMessageRawRecord, getMessageText } from './message-format'
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'

const props = defineProps<{
  message: RenderableThreadMessage
  toolCall?: ThreadSnapshot['toolCalls'][number]
}>()

const raw = computed(() => getMessageRawRecord(props.message))
const toolName = computed(() => getString(raw.value.toolName) ?? props.toolCall?.toolName ?? 'tool')
const args = computed(() => formatUnknown(props.toolCall?.args))
const isError = computed(() => raw.value.isError === true)
const result = computed(
  () =>
    formatUnknown(props.toolCall?.result) ??
    getMessageText(props.message) ??
    formatUnknown(raw.value.content)
)

/**
 * 读取字符串。
 * @param value - 值。
 * @returns 字符串。
 */
function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
</script>

<template>
  <Collapsible :default-open="false" class="tool-message">
    <CollapsibleTrigger class="tool-message__trigger">
      <div class="tool-message__meta">
        <span class="tool-message__chevron" aria-hidden="true"></span>
        <span class="tool-message__name">{{ toolName }}</span>
        <span class="tool-message__args">{{ args }}</span>
      </div>
    </CollapsibleTrigger>

    <CollapsibleContent v-if="result" class="tool-message__content">
      <ScrollArea style="height: 100%">
        <div class="tool-message__result">
          <pre>{{ result }}</pre>
        </div>
        <div v-if="isError">
          <dt>error</dt>
          <dd>true</dd>
        </div>
      </ScrollArea>
    </CollapsibleContent>
  </Collapsible>
</template>

<style lang="scss" scoped>
.tool-message {
  flex: 1;
  min-width: 0;
  width: min(720px, 100%);
  border-radius: var(--radius-md);

  & :deep(.tool-message__content) {
    max-height: 240px;
    border-radius: 0 0 var(--radius-md) var(--radius-md);
    overflow: hidden;
    margin: 0;
    background: var(--color-canvas);

    .tool-message__result {
      padding: var(--space-2);
    }

    pre {
      margin: 0;
      color: inherit;
      font-family: var(--font-mono);
      font-size: 11px;
      white-space: pre-wrap;
      word-break: break-word;
    }
  }

  &[data-state='open'] .tool-message__trigger {
    background: var(--color-canvas);
    width: 100%;
    border-bottom: 1px solid var(--color-border);
  }

  &[data-state='open'] .tool-message__chevron {
    transform: rotate(45deg);
  }
}

.tool-message__trigger {
  width: fit-content;
  max-width: 100%;
  padding: var(--space-2) var(--space-2);
  color: inherit;
  font: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: inherit;
  cursor: pointer;

  &:hover {
    background: color-mix(in srgb, var(--color-surface-hover) 36%, transparent);
  }

  &:focus-visible {
    outline: none;
    box-shadow: inset var(--shadow-focus);
  }

  &[data-state='open'] {
    border-bottom-right-radius: 0;
    border-bottom-left-radius: 0;
  }

  &[data-state='open'] .tool-message__chevron {
    transform: rotate(45deg);
  }
}

.tool-message__meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 13px;

  .tool-message__name {
    font-size: 13px;
    color: var(--color-text-muted);
  }
  .tool-message__args {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  div {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  span {
    color: var(--color-text);
    font-weight: 650;
  }

  code {
    overflow: hidden;
    max-width: 240px;
    color: var(--color-text-subtle);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.tool-message__chevron {
  width: 6px;
  height: 6px;
  border-right: 1px solid currentcolor;
  border-bottom: 1px solid currentcolor;
  transform: rotate(-45deg);
  transition: transform var(--duration-fast) var(--ease-standard);
}
</style>
