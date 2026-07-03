<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
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
  collapseWhenResponseAppears?: boolean
}>()

const thinkingText = computed(
  () => props.text ?? (props.message ? getMessageThinkingText(props.message) : '') ?? ''
)
const label = computed(() => (props.isStreaming ? '思考中' : '思考'))
const firstLine = computed(() => {
  const text = thinkingText.value
  if (!text) return ''
  const lines = text.split(/\r?\n/)
  const first = lines[0]?.trim() ?? ''
  const hasMore = lines.length > 1 || first.length > 120
  const truncated = first.length > 120 ? `${first.slice(0, 120)}` : first
  return hasMore ? `${truncated}…` : truncated
})
const revision = computed(() => props.message?.revision ?? 1)
const markdownMessageId = computed(() => props.messageId ?? props.message?.id ?? 'thinking')
const open = ref(props.isStreaming ?? false)
const scrollAreaRef = ref<InstanceType<typeof ScrollArea> | null>(null)
const markdownRef = ref<HTMLElement | null>(null)
const shouldFollowBottom = ref(true)

let followBottomRafId: number | null = null
let followBottomSettleFrames = 0

/**
 * thinking 内部内容高度变化时同步贴底。
 */
function keepBottomInCurrentFrame(): void {
  if (!shouldFollowBottom.value || !open.value) {
    return
  }
  scrollAreaRef.value?.scrollBottom('auto')
}

/**
 * thinking 流式输出期间持续贴底，覆盖 Markdown 分批渲染带来的晚到布局变化。
 */
function startFollowBottomLoop(settleFrames = 2): void {
  followBottomSettleFrames = Math.max(followBottomSettleFrames, settleFrames)
  if (followBottomRafId !== null) return

  followBottomRafId = requestAnimationFrame(() => {
    followBottomRafId = null
    if (!props.isStreaming || !shouldFollowBottom.value || !open.value) {
      followBottomSettleFrames = 0
      return
    }

    keepBottomInCurrentFrame()

    const shouldKeepFollowing = props.isStreaming || followBottomSettleFrames > 0
    if (followBottomSettleFrames > 0) {
      followBottomSettleFrames -= 1
    }
    if (shouldKeepFollowing) {
      startFollowBottomLoop(0)
    }
  })
}

/**
 * 用户明确向上滚动时退出自动跟随。
 * @param event - wheel 事件。
 */
function handleThinkingWheel(event: WheelEvent): void {
  if (event.deltaY < 0) {
    shouldFollowBottom.value = false
  } else {
    shouldFollowBottom.value = true
  }
}

/**
 * 流式输出期间保持展开；正文或工具调用出现后自动收起，用户仍可手动展开。
 */
watch(
  () => [props.isStreaming, props.collapseWhenResponseAppears],
  ([isStreaming, collapseWhenResponseAppears]) => {
    open.value = Boolean(isStreaming) && !collapseWhenResponseAppears
    if (isStreaming && open.value) {
      shouldFollowBottom.value = true
      startFollowBottomLoop(4)
    }
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
    startFollowBottomLoop(4)
  },
  { flush: 'post' }
)

useResizeObserver(markdownRef, keepBottomInCurrentFrame)

onBeforeUnmount(() => {
  if (followBottomRafId !== null) {
    cancelAnimationFrame(followBottomRafId)
  }
})
</script>

<template>
  <Collapsible
    v-if="thinkingText"
    v-model:open="open"
    class="thinking-message"
    aria-label="思考过程"
  >
    <CollapsibleTrigger class="thinking-message__header">
      <span class="thinking-message__label">{{ label }}</span>
      <span v-if="firstLine" class="thinking-message__preview">{{ firstLine }}</span>
    </CollapsibleTrigger>

    <CollapsibleContent class="thinking-message__content">
      <ScrollArea
        ref="scrollAreaRef"
        class="thinking-message__scroll"
        @wheel.passive="handleThinkingWheel"
      >
        <div ref="markdownRef" class="thinking-message__markdown">
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
  border-radius: var(--radius-md);

  &[data-state='open'] {
    background: var(--color-canvas);
    border: 1px solid var(--color-border);
  }
}

.thinking-message__header {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  width: fit-content;
  max-width: 100%;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 13px;
  letter-spacing: 0;
  text-align: left;
  background: transparent;
  cursor: pointer;

  &:hover {
    color: var(--color-text);
  }

  &:focus-visible {
    outline: none;
    box-shadow: inset var(--shadow-focus);
  }

  &[data-state='open'] {
    width: 100%;
    padding: var(--space-2);
    background: var(--color-canvas);
    border: 0;
    border-bottom: 1px solid var(--color-border);
    border-radius: var(--radius-md) var(--radius-md) 0 0;
  }
}

.thinking-message__label {
  flex: 0 0 auto;
}

.thinking-message__preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-subtle);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.thinking-message__content {
  display: flex;
  flex-direction: column;
  max-height: 200px;
  overflow: hidden;
  background: var(--color-canvas);
  border-radius: 0 0 var(--radius-md) var(--radius-md);
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
  padding: var(--space-2);

  :deep(.streaming-markdown),
  :deep(.markstream-vue),
  :deep(.paragraph-node) {
    color: var(--color-text-muted);
    font-size: 13px;
    line-height: 1.6;
  }
}
</style>
