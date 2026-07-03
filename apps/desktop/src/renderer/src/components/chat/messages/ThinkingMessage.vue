<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { RenderableThreadMessage } from './renderable-message'
import { getMessageThinkingText } from './message-format'
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import StreamingMarkdown from '../../markdown/StreamingMarkdown.vue'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

const props = defineProps<{
  message?: RenderableThreadMessage
  messageId?: string
  text?: string
  isStreaming?: boolean
}>()

const thinkingText = computed(
  () => props.text ?? (props.message ? getMessageThinkingText(props.message) : '') ?? ''
)
const label = computed(() => (props.isStreaming ? '思考中' : '思考'))
const revision = computed(() => props.message?.revision ?? 1)
const markdownMessageId = computed(() => props.messageId ?? props.message?.id ?? 'thinking')
const open = ref(props.isStreaming ?? false)
const scrollAreaRef = ref<InstanceType<typeof ScrollArea> | null>(null)

/**
 * 流式输出期间保持展开；完成后默认折叠，用户仍可手动展开。
 */
watch(
  () => props.isStreaming,
  (isStreaming) => {
    open.value = Boolean(isStreaming)
  }
)

/**
 * thinking 内容流式增长时，让内部滚动区域跟随到底部。
 */
watch(
  () => [thinkingText.value, revision.value, props.isStreaming, open.value],
  async () => {
    if (!props.isStreaming || !open.value) {
      return
    }
    await nextTick()
    scrollAreaRef.value?.scrollBottom('auto')
  },
  { flush: 'post' }
)
</script>

<template>
  <Collapsible
    v-if="thinkingText"
    v-model:open="open"
    class="thinking-message"
    aria-label="思考过程"
  >
    <CollapsibleTrigger class="thinking-message__header">
      <span
        class="thinking-message__pulse"
        :class="{ 'thinking-message__pulse--active': isStreaming }"
        aria-hidden="true"
      />
      <span>{{ label }}</span>
      <span class="thinking-message__hint">{{ open ? '收起' : '展开' }}</span>
    </CollapsibleTrigger>

    <CollapsibleContent class="thinking-message__content">
      <ScrollArea ref="scrollAreaRef" class="thinking-message__scroll">
        <div class="thinking-message__markdown">
          <StreamingMarkdown
            :source="thinkingText"
            :revision="revision"
            :is-streaming="Boolean(isStreaming)"
            :message-id="markdownMessageId"
          />
        </div>
      </ScrollArea>
    </CollapsibleContent>
  </Collapsible>
</template>

<style lang="scss" scoped>
.thinking-message {
  width: 100%;
  color: var(--color-text-muted);
  background: color-mix(in srgb, var(--color-control-track) 82%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-border) 82%, transparent);
  border-radius: var(--radius-md);

  overflow: hidden;
}

.thinking-message__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2) var(--space-4);
  color: var(--color-text-subtle);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;

  &:hover {
    color: var(--color-text-muted);
  }

  &:focus-visible {
    outline: none;
    box-shadow: inset var(--shadow-focus);
  }
}

.thinking-message__pulse {
  width: 6px;
  height: 6px;
  background: var(--color-primary);
  border-radius: 50%;
  opacity: 0.45;
}

.thinking-message__pulse--active {
  animation: thinking-pulse 1.2s var(--ease-standard) infinite;
}

.thinking-message__hint {
  margin-left: auto;
  color: var(--color-text-subtle);
}

.thinking-message__content {
  display: flex;
  flex-direction: column;
  max-height: 200px;
  overflow: hidden;
  border-top: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent);
}

:deep(.thinking-message__scroll) {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
}

:deep(.thinking-message__scroll [data-slot='scroll-area-viewport']) {
  flex: 1 1 auto;
  min-height: 0;
}

.thinking-message__markdown {
  padding: var(--space-3) var(--space-4);

  :deep(.streaming-markdown),
  :deep(.markstream-vue),
  :deep(.paragraph-node) {
    color: var(--color-text-muted);
    font-size: 12px;
    line-height: 1.65;
  }
}

@keyframes thinking-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.85);
  }

  50% {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
