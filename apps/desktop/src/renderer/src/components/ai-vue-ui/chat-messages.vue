<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, useTemplateRef, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useResizeObserver } from '@vueuse/core'
import { useChatContext } from './use-chat-context'
import ChatMessage from './chat-message.vue'
import CollapsedHistoryPart from './collapsed-history-part.vue'
import ProtocolErrorPart from './protocol-error-part.vue'
import ToolGroupPart from './tools/tool-group-part.vue'
import {
  projectChatDisplay,
  type ChatCollapsedHistoryDisplayItem,
  type ChatDisplayItem,
  type ChatProjectionIssue,
  type ChatProtocolErrorDisplayItem,
  type ChatToolGroupDisplayItem
} from './chat-display'
import { getChatDisplayOpenState, pruneChatDisplayOpenState } from './chat-display-state'
import type { ChatMessagesProps, ChatSlotContent, ChatUIMessage } from './types'

const props = withDefaults(defineProps<ChatMessagesProps>(), {
  autoScroll: true
})

defineSlots<{
  default?: (props: {
    message: ChatUIMessage
    index: number
    item: Extract<ChatDisplayItem, { type: 'message' }>
  }) => ChatSlotContent
  toolGroup?: (props: {
    item: ChatToolGroupDisplayItem
    open: boolean
    toggle: () => void
  }) => ChatSlotContent
  collapsedHistory?: (props: {
    item: ChatCollapsedHistoryDisplayItem
    open: boolean
    toggle: () => void
  }) => ChatSlotContent
  protocolError?: (props: { item: ChatProtocolErrorDisplayItem }) => ChatSlotContent
  emptyState?: () => ChatSlotContent
  loadingState?: () => ChatSlotContent
  errorState?: (props: { error: Error; reload: () => void }) => ChatSlotContent
}>()

const { messages, isLoading, error, reload, sessionGenerating, status } = useChatContext()
const containerRef = useTemplateRef('containerRef')
const listRef = useTemplateRef('listRef')
const localStateKey = `chat:${useId()}`
const resolvedStateKey = computed(() => props.stateKey?.trim() || localStateKey)
const openState = computed(() => getChatDisplayOpenState(resolvedStateKey.value))
const isRunning = computed(
  () => isLoading.value || sessionGenerating.value || status.value === 'streaming'
)

const projection = computed(() =>
  projectChatDisplay(messages.value, {
    stateKey: resolvedStateKey.value,
    isRunning: isRunning.value,
    isHistoryOpen: (item) => Boolean(openState.value.collapsedHistory[item.key])
  })
)
const displayItems = computed(() => projection.value.items)

const reportedIssueKeys = new Set<string>()
watch(
  () => projection.value.issues,
  (issues) => {
    for (const issue of issues) reportProjectionIssue(issue)
  },
  { immediate: true }
)

watch(
  () => projection.value.items,
  () => {
    pruneChatDisplayOpenState(
      openState.value,
      new Set(projection.value.availableHistoryKeys),
      new Set(projection.value.availableToolGroupKeys)
    )
  },
  { immediate: true }
)

function reportProjectionIssue(issue: ChatProjectionIssue): void {
  if (reportedIssueKeys.has(issue.key)) return
  reportedIssueKeys.add(issue.key)
  if (props.onProjectionIssue) {
    props.onProjectionIssue(issue)
    return
  }
  console.error('[AG-UI chat projection]', issue)
}

const shouldFollowBottom = ref(props.autoScroll)

const virtualizer = useVirtualizer({
  get count() {
    return displayItems.value.length
  },
  getScrollElement() {
    return containerRef.value
  },
  // TanStack compares previous and next boundary keys while applying a count change.
  get getItemKey() {
    const items = displayItems.value
    return (index: number) => items[index]!.key
  },
  anchorTo: 'end',
  get followOnAppend() {
    return props.autoScroll && shouldFollowBottom.value
  },
  estimateSize: (index) => estimateDisplayItemSize(displayItems.value[index]),
  overscan: 6,
  scrollEndThreshold: 80,
  gap: 0,
  paddingStart: 32,
  paddingEnd: 32
})

const virtualRows = computed(() =>
  virtualizer.value.getVirtualItems().flatMap((virtualItem) => {
    const item = displayItems.value[virtualItem.index]
    return item ? [{ virtualItem, item }] : []
  })
)

const measureElement = (element: Element | ComponentPublicInstance | null): void => {
  if (element instanceof Element) virtualizer.value.measureElement(element)
}

let isApplyingFollow = false
let followResetFrame: number | null = null

function scrollToBottom(): void {
  if (!props.autoScroll || !shouldFollowBottom.value) return
  isApplyingFollow = true
  virtualizer.value.scrollToEnd({ behavior: 'auto' })
  if (followResetFrame !== null) cancelAnimationFrame(followResetFrame)
  followResetFrame = requestAnimationFrame(() => {
    followResetFrame = null
    isApplyingFollow = false
  })
}

function handleScroll(): void {
  const container = containerRef.value
  if (!container || !props.autoScroll) return
  const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight
  if (distanceToBottom <= 1) {
    shouldFollowBottom.value = true
  } else if (!isApplyingFollow) {
    holdUserScroll()
  }
}

function holdUserScroll(): void {
  shouldFollowBottom.value = false
}

function handleWheel(event: WheelEvent): void {
  if (event.deltaY < 0) holdUserScroll()
}

useResizeObserver(listRef, scrollToBottom)

onBeforeUnmount(() => {
  if (followResetFrame !== null) cancelAnimationFrame(followResetFrame)
})

function toggleToolGroup(item: ChatToolGroupDisplayItem): void {
  holdUserScroll()
  openState.value.toolGroups[item.key] = !openState.value.toolGroups[item.key]
}

function setToolGroupOpen(item: ChatToolGroupDisplayItem, open: boolean): void {
  holdUserScroll()
  openState.value.toolGroups[item.key] = open
}

function getToolGroupToggle(item: ChatToolGroupDisplayItem): () => void {
  return () => toggleToolGroup(item)
}

function toggleCollapsedHistory(item: ChatCollapsedHistoryDisplayItem): void {
  if (!item.collapsible) return
  holdUserScroll()
  openState.value.collapsedHistory[item.key] = !openState.value.collapsedHistory[item.key]
}

function getCollapsedHistoryToggle(item: ChatCollapsedHistoryDisplayItem): () => void {
  return () => toggleCollapsedHistory(item)
}

function isToolGroupOpen(item: ChatToolGroupDisplayItem): boolean {
  return Boolean(openState.value.toolGroups[item.key])
}

function isCollapsedHistoryOpen(item: ChatCollapsedHistoryDisplayItem): boolean {
  return !item.collapsible || Boolean(openState.value.collapsedHistory[item.key])
}

function getItemSpacingClass(index: number): string | undefined {
  const current = displayItems.value[index]
  const next = displayItems.value[index + 1]
  if (!current || !next) return undefined
  if (current.type === 'tool-group' && next.type === 'tool-group') return undefined
  if (isAssistantFlowItem(current) && isAssistantFlowItem(next)) {
    return 'chat-messages__item--flow-spacing'
  }
  if (current.type === 'collapsed-history' && !current.collapsible) {
    return 'chat-messages__item--flow-spacing'
  }
  if (current.type === 'collapsed-history' || next.type === 'collapsed-history') {
    return 'chat-messages__item--history-spacing'
  }
  return 'chat-messages__item--turn-spacing'
}

function isAssistantFlowItem(item: ChatDisplayItem): boolean {
  return (
    item.type === 'tool-group' || (item.type === 'message' && item.message.role === 'assistant')
  )
}

function estimateDisplayItemSize(item: ChatDisplayItem | undefined): number {
  if (!item) return 72
  if (item.type === 'collapsed-history') return 28
  if (item.type === 'tool-group') return isToolGroupOpen(item) ? 120 : 30
  if (item.type === 'protocol-error') return 72
  if (item.message.role === 'user') return 88
  if (item.message.role === 'system') return 64
  if (item.partType === 'thinking') return 120
  return 160
}

let hasInitialScroll = false
watch(
  [containerRef, () => displayItems.value.length],
  async ([container, itemCount]): Promise<void> => {
    if (hasInitialScroll || !props.autoScroll || !container || itemCount === 0) return
    hasInitialScroll = true
    await nextTick()
    scrollToBottom()
  },
  { flush: 'post', immediate: true }
)
</script>

<template>
  <slot v-if="error && $slots.errorState" name="errorState" :error="error" :reload="reload" />
  <template v-else>
    <slot v-if="isLoading && messages.length === 0 && $slots.loadingState" name="loadingState" />
    <slot v-else-if="messages.length === 0 && $slots.emptyState" name="emptyState" />
    <div
      v-else
      ref="containerRef"
      :class="props.class"
      class="chat-messages__scroller"
      data-chat-messages
      :data-message-count="messages.length"
      :data-display-item-count="displayItems.length"
      @wheel.passive="handleWheel"
      @scroll.passive="handleScroll"
    >
      <div
        ref="listRef"
        class="chat-messages__list"
        :style="{
          flex: '0 0 auto',
          height: virtualizer.getTotalSize() + 'px',
          position: 'relative',
          width: '100%'
        }"
      >
        <div
          v-for="row in virtualRows"
          :key="row.item.key"
          :ref="measureElement"
          :class="['chat-messages__item', getItemSpacingClass(row.virtualItem.index)]"
          :data-index="row.virtualItem.index"
          :data-display-key="row.item.key"
          :data-display-type="row.item.type"
          :style="{
            position: 'absolute',
            top: 0,
            left: 0,
            transform: `translateY(${row.virtualItem.start}px)`,
            width: '100%'
          }"
        >
          <template v-if="row.item.type === 'message'">
            <slot
              v-if="$slots.default"
              :message="row.item.message"
              :index="row.virtualItem.index"
              :item="row.item"
            />
            <ChatMessage v-else :message="row.item.message" />
          </template>

          <template v-else-if="row.item.type === 'tool-group'">
            <slot
              v-if="$slots.toolGroup"
              name="toolGroup"
              :item="row.item"
              :open="isToolGroupOpen(row.item)"
              :toggle="getToolGroupToggle(row.item)"
            />
            <ToolGroupPart
              v-else
              :item="row.item"
              :open="isToolGroupOpen(row.item)"
              @update:open="setToolGroupOpen(row.item, $event)"
            />
          </template>

          <template v-else-if="row.item.type === 'collapsed-history'">
            <slot
              v-if="$slots.collapsedHistory"
              name="collapsedHistory"
              :item="row.item"
              :open="isCollapsedHistoryOpen(row.item)"
              :toggle="getCollapsedHistoryToggle(row.item)"
            />
            <CollapsedHistoryPart
              v-else
              :item="row.item"
              :open="isCollapsedHistoryOpen(row.item)"
              @toggle="toggleCollapsedHistory(row.item)"
            />
          </template>

          <template v-else-if="row.item.type === 'protocol-error'">
            <slot v-if="$slots.protocolError" name="protocolError" :item="row.item" />
            <ProtocolErrorPart v-else :item="row.item" />
          </template>
        </div>
      </div>
    </div>
  </template>
</template>

<style lang="scss" scoped>
.chat-messages__scroller {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.chat-messages__list {
  width: 100%;
  max-width: 768px;
  margin: 0 auto;
}

.chat-messages__item {
  box-sizing: border-box;

  &--flow-spacing {
    padding-bottom: 8px;
  }

  &--history-spacing {
    padding-bottom: 16px;
  }

  &--turn-spacing {
    padding-bottom: 24px;
  }
}
</style>
