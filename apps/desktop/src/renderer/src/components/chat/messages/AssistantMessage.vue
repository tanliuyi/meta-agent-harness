<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { WORKSPACE_PORTAL_TARGET } from '@renderer/router/workspace-route-host'
import type { PromptQuoteContext, ThreadMessage } from '@shared/coding-agent/types'
import { formatMessageTime, getMessageText } from './support/message-format'
import { getSelectionToolbarPosition } from './support/assistant-selection'
import StreamingMarkdown from '../../markdown/StreamingMarkdown.vue'
import BaseIconButton from '@/components/base/BaseIconButton.vue'
import { Check, Copy, CornerDownRight, GitFork, MapPin, Quote } from 'lucide-vue-next'

const props = defineProps<{
  message: ThreadMessage
  text?: string
  revision?: number
  isStreaming?: boolean
  /** 是否是最终回复（无工具调用的 assistant 消息）。 */
  isFinalReply?: boolean
  /** 消息更新是否已完成。 */
  isDone?: boolean
  /** 是否正在从这条消息继续。 */
  isNavigatingTree?: boolean
}>()

const emit = defineEmits<{
  forkFromMessage: [entryId: string]
  locateInTree: [entryId: string]
  navigateTree: [entryId: string]
  quoteSelection: [quote: PromptQuoteContext]
  contentHeightChange: []
}>()

const source = computed(() => props.text ?? getMessageText(props.message) ?? '')
const formattedTime = computed(() => formatMessageTime(props.message.createdAt))

const isCopied = ref(false)
const messageRootRef = ref<HTMLElement>()
const selectionToolbar = ref<{
  text: string
  left: number
  top: number
  below: boolean
}>()
let copyTimeout: ReturnType<typeof setTimeout> | null = null
let selectionCaptureRaf: number | null = null

async function copyMessageText(): Promise<void> {
  const text = props.text ?? getMessageText(props.message)
  if (!text) return

  try {
    await navigator.clipboard.writeText(text)
    isCopied.value = true
    if (copyTimeout) clearTimeout(copyTimeout)
    copyTimeout = setTimeout(() => {
      isCopied.value = false
    }, 1000)
  } catch (err) {
    console.error('Failed to copy message:', err)
  }
}

function forkFromMessage(): void {
  if (!props.message.sessionEntryId) return
  emit('forkFromMessage', props.message.sessionEntryId)
}

function locateInTree(): void {
  if (!props.message.sessionEntryId) return
  emit('locateInTree', props.message.sessionEntryId)
}

function navigateTree(): void {
  if (!props.message.sessionEntryId) return
  emit('navigateTree', props.message.sessionEntryId)
}

function captureSelection(): void {
  const root = messageRootRef.value
  const selection = window.getSelection()
  if (!root || !selection || selection.rangeCount !== 1 || selection.isCollapsed) {
    closeSelectionToolbar()
    return
  }
  const range = selection.getRangeAt(0)
  if (!isRangeWithinRoot(range, root)) {
    closeSelectionToolbar()
    return
  }
  const text = range.toString().trim()
  const exposedRects = Array.from(range.getClientRects()).filter((rect) =>
    isSelectionRectExposed(rect, root)
  )
  const position = getSelectionToolbarPosition(exposedRects, window.innerWidth, window.innerHeight)
  if (!text || !position) {
    closeSelectionToolbar()
    return
  }
  selectionToolbar.value = { text, ...position }
}

function closeSelectionToolbar(): void {
  selectionToolbar.value = undefined
}

function cancelScheduledSelectionCapture(): void {
  if (selectionCaptureRaf === null) return
  window.cancelAnimationFrame(selectionCaptureRaf)
  selectionCaptureRaf = null
}

function scheduleSelectionCapture(): void {
  cancelScheduledSelectionCapture()
  selectionCaptureRaf = window.requestAnimationFrame(() => {
    selectionCaptureRaf = null
    captureSelection()
  })
}

function dismissSelectionToolbar(): void {
  cancelScheduledSelectionCapture()
  closeSelectionToolbar()
}

function isRangeWithinRoot(range: Range, root: HTMLElement): boolean {
  return root.contains(range.startContainer) && root.contains(range.endContainer)
}

function isSelectionRectExposed(rect: DOMRect, root: HTMLElement): boolean {
  const left = Math.max(0, rect.left)
  const right = Math.min(window.innerWidth, rect.right)
  const top = Math.max(0, rect.top)
  const bottom = Math.min(window.innerHeight, rect.bottom)
  if (right <= left || bottom <= top) return false

  const xPoints = [left + 1, (left + right) / 2, right - 1]
  const yPoints = [top + 1, (top + bottom) / 2, bottom - 1]
  return xPoints.some((x) =>
    yPoints.some((y) => {
      const coveringElement = document
        .elementsFromPoint(x, y)
        .find((element) => !element.closest('.assistant-selection-toolbar'))
      return Boolean(coveringElement && root.contains(coveringElement))
    })
  )
}

function handleSelectionChange(): void {
  scheduleSelectionCapture()
}

function handleDocumentPointerdown(event: PointerEvent): void {
  const target = event.target
  if (target instanceof Element && target.closest('.assistant-selection-toolbar')) return
  dismissSelectionToolbar()
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    dismissSelectionToolbar()
  }
}

function quoteSelectedText(): void {
  const selection = selectionToolbar.value
  if (!selection) return
  emit('quoteSelection', {
    messageId: props.message.id,
    ...(props.message.sessionEntryId ? { sessionEntryId: props.message.sessionEntryId } : {}),
    text: selection.text
  })
  window.getSelection()?.removeAllRanges()
  closeSelectionToolbar()
}

onMounted(() => {
  document.addEventListener('selectionchange', handleSelectionChange)
  document.addEventListener('pointerdown', handleDocumentPointerdown)
  document.addEventListener('keydown', handleDocumentKeydown)
  document.addEventListener('scroll', scheduleSelectionCapture, true)
  window.addEventListener('resize', scheduleSelectionCapture)
})

onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', handleSelectionChange)
  document.removeEventListener('pointerdown', handleDocumentPointerdown)
  document.removeEventListener('keydown', handleDocumentKeydown)
  document.removeEventListener('scroll', scheduleSelectionCapture, true)
  window.removeEventListener('resize', scheduleSelectionCapture)
  cancelScheduledSelectionCapture()
  if (copyTimeout) clearTimeout(copyTimeout)
})

watch(() => [props.revision, props.isStreaming], scheduleSelectionCapture)
</script>

<template>
  <div class="message is-assistant">
    <div ref="messageRootRef" class="assistant-message">
      <StreamingMarkdown
        :source="source"
        :revision="revision ?? 1"
        :is-streaming="Boolean(isStreaming)"
        :message-id="message.id"
        @height-change="emit('contentHeightChange')"
      />
    </div>
    <Teleport :to="WORKSPACE_PORTAL_TARGET">
      <div
        v-if="selectionToolbar"
        class="assistant-selection-toolbar"
        :class="{ 'is-below': selectionToolbar.below }"
        :style="{ left: `${selectionToolbar.left}px`, top: `${selectionToolbar.top}px` }"
        role="toolbar"
        aria-label="文本快捷操作"
      >
        <button type="button" @pointerdown.prevent @click="quoteSelectedText">
          <Quote :size="12" />
          <span>引用此段</span>
        </button>
      </div>
    </Teleport>
    <div v-if="isFinalReply && isDone" class="message__actions">
      <BaseIconButton
        v-if="message.sessionEntryId"
        :label="isNavigatingTree ? '正在从这里继续' : '从这里继续'"
        class="message__action-btn"
        :disabled="isNavigatingTree"
        @click="navigateTree"
      >
        <CornerDownRight :size="13" />
      </BaseIconButton>
      <BaseIconButton
        v-if="message.sessionEntryId"
        label="在 Tree 中定位"
        class="message__action-btn"
        @click="locateInTree"
      >
        <MapPin :size="13" />
      </BaseIconButton>
      <BaseIconButton
        v-if="message.sessionEntryId"
        label="创建分支会话"
        class="message__action-btn"
        @click="forkFromMessage"
      >
        <GitFork :size="13" />
      </BaseIconButton>
      <BaseIconButton
        :label="isCopied ? '已复制' : '复制消息'"
        class="message__action-btn"
        @click="copyMessageText"
      >
        <Check v-if="isCopied" :size="13" />
        <Copy v-else :size="13" />
      </BaseIconButton>
      <span class="message__time">{{ formattedTime }}</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.message {
  display: flex;
  flex-direction: column;
  width: 100%;

  &__actions {
    display: flex;
    flex-direction: row;
    gap: var(--space-2);
  }
}

.assistant-message {
  width: 100%;
  color: var(--color-text);
  font-size: var(--font-size-ui);
  line-height: 1.6;
}

.message__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0;
  opacity: 0;
  margin-top: var(--space-2);
  transition: opacity var(--duration-fast) var(--ease-standard);

  .message:hover & {
    opacity: 1;
  }
}

:deep(.message__action-btn) {
  width: 24px;
  height: 24px;
  color: var(--color-text-subtle);
  border-radius: var(--radius-sm);

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-raised);
  }
}

.message__time {
  margin-left: 6px;
  font-size: 11px;
  color: var(--color-text-subtle);
}

.assistant-selection-toolbar {
  position: fixed;
  z-index: 20;
  transform: translate(-50%, -100%);
  padding: 3px;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  transition:
    left var(--duration-fast) var(--ease-standard),
    top var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);

  &.is-below {
    transform: translateX(-50%);
  }

  button {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    height: 24px;
    padding: 0 var(--space-2);
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-ui-sm);
    background: transparent;
    border: 0;
    border-radius: var(--radius-md);
    cursor: pointer;

    &:hover,
    &:focus-visible {
      background: var(--color-surface-hover);
      outline: none;
    }
  }
}

@media (prefers-reduced-motion: reduce) {
  .assistant-selection-toolbar {
    transition: none;
  }
}
</style>
