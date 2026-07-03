<script setup lang="ts">
/**
 * ChatView.vue - 当前活跃会话的消息流与输入区组件。
 */

import type { CSSProperties } from 'vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useElementSize, useResizeObserver } from '@vueuse/core'
import Composer from './Composer.vue'
import AssistantMessage from './messages/AssistantMessage.vue'
import ThinkingMessage from './messages/ThinkingMessage.vue'
import SystemMessage from './messages/SystemMessage.vue'
import ToolMessage from './messages/ToolMessage.vue'
import UserMessage from './messages/UserMessage.vue'
import { getMessageRawRecord, getMessageText, isRecord } from './messages/message-format'
import { toRenderableMessage, type RenderableThreadMessage } from './messages/renderable-message'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import useWorkspaceProjectStore from '@renderer/stores/workspace-project'
import type { DesktopToolCall } from '../../../../../../../packages/coding-agent/src/desktop/protocol/tool.ts'
import ScrollArea from '../ui/scroll-area/ScrollArea.vue'
import type { ComposerImageAttachment } from '@renderer/stores/workspace-session'
import type { PromptImageAttachment, PromptImageDraft } from '@shared/coding-agent/types'

const workspaceSession = useWorkspaceSessionStore()
const workspaceProject = useWorkspaceProjectStore()

type TimelineScrollBehavior = 'auto' | 'smooth'
type ScrollAreaInstance = InstanceType<typeof ScrollArea>
const NEAR_BOTTOM_DISTANCE = 96
const STICKY_BOTTOM_DISTANCE = 2
type TimelineItem =
  | {
      type: 'message'
      key: string
      message: RenderableThreadMessage
      text?: string
      toolCall?: DesktopToolCall
      revision: number
    }
  | {
      type: 'thinking'
      key: string
      message: RenderableThreadMessage
      text: string
      collapseWhenResponseAppears: boolean
      revision: number
    }
  | {
      type: 'tool'
      key: string
      toolCall: DesktopToolCall
    }

/** 当前会话的渲染消息列表。 */
const messages = computed<RenderableThreadMessage[]>(() => {
  const snapshotMessages = workspaceSession.activeSnapshot?.messages ?? []
  const threadId = workspaceSession.activeSnapshot?.threadId
  return snapshotMessages.map((message) => {
    const state = threadId
      ? workspaceSession.getMessageRenderState(threadId, message.id)
      : { revision: 1, renderState: 'complete' as const }
    return toRenderableMessage(message, state)
  })
})

/** 当前会话的工具调用列表。 */
const toolCalls = computed(() => workspaceSession.activeSnapshot?.toolCalls ?? [])

/** 当前会话的统一时间线。 */
const timelineItems = computed<TimelineItem[]>(() => {
  const resultToolCallIds = new Set<string>()
  const items: TimelineItem[] = []
  for (const message of messages.value) {
    if (message.role === 'assistant') {
      items.push(...getAssistantTimelineItems(message, resultToolCallIds))
      continue
    }
    const toolCall = message.role === 'tool' ? getToolResultMessageToolCall(message) : undefined
    if (toolCall) {
      resultToolCallIds.add(toolCall.toolCallId)
    }
    items.push({
      type: 'message',
      key: message.id,
      message,
      toolCall,
      revision: message.revision
    })
  }
  for (const toolCall of toolCalls.value) {
    if (resultToolCallIds.has(toolCall.toolCallId)) {
      continue
    }
    items.push({
      type: 'tool',
      key: `tool-${toolCall.toolCallId}`,
      toolCall
    })
  }
  return items
})

/** 消息滚动容器。 */
const timelineRef = ref<ScrollAreaInstance | null>(null)
const timelineInnerRef = ref<HTMLElement | null>(null)

/** 底部输入区容器。 */
const composerRef = ref<HTMLElement | null>(null)
const { height: composerHeight } = useElementSize(composerRef, undefined, { box: 'border-box' })

/** 给滚动区域预留 absolute 输入区高度。 */
const timelineStyle = computed<CSSProperties>(() => ({
  paddingBottom: `${Math.ceil(composerHeight.value) + 32}px`
}))

const jumpBtnStyle = computed<CSSProperties>(() => ({
  bottom: `${Math.ceil(composerHeight.value) + 24}px`
}))

/** 是否接近消息底部。 */
const isNearBottom = ref(true)
const shouldFollowBottom = ref(true)
const imageSelectionError = ref<string>()
const selectingImages = ref(false)

/** 当前会话是否正在执行。 */
const isRunning = computed(() =>
  ['queued', 'starting', 'running', 'stopping'].includes(
    workspaceSession.activeSession?.status ?? ''
  )
)

/** 是否允许发送消息。 */
const canSend = computed(() =>
  Boolean(workspaceSession.activeProjectId && workspaceSession.hasDraftMessage && !isRunning.value)
)

/**
 * 获取消息 role 对应组件。
 * @param role - 消息角色。
 * @returns Vue component。
 */
function getMessageComponent(
  role: RenderableThreadMessage['role']
): typeof UserMessage | typeof AssistantMessage | typeof SystemMessage | typeof ToolMessage {
  switch (role) {
    case 'user':
      return UserMessage
    case 'assistant':
      return AssistantMessage
    case 'tool':
      return ToolMessage
    case 'system':
      return SystemMessage
  }
}

/**
 * 通过 main 进程选择并处理图片，再写入选择图片时绑定的会话。
 * @param threadId - 选择图片时的 thread ID。
 */
async function handleSelectImages(threadId?: string): Promise<void> {
  imageSelectionError.value = undefined
  selectingImages.value = true
  try {
    const images = await window.api.codingAgent.selectPromptImages()
    if (!images || images.length === 0) {
      return
    }
    workspaceSession.addComposerImages(
      images.map(toComposerImageAttachment),
      workspaceSession.defaultSessionContextId,
      threadId
    )
  } catch (error) {
    imageSelectionError.value = error instanceof Error ? error.message : String(error)
  } finally {
    selectingImages.value = false
  }
}

/**
 * 处理从编辑器粘贴进来的图片文件。
 * @param files - 剪贴板图片文件。
 * @param threadId - 粘贴图片时绑定的 thread ID。
 */
async function handlePasteImages(files: File[], threadId?: string): Promise<void> {
  if (files.length === 0) {
    return
  }
  imageSelectionError.value = undefined
  selectingImages.value = true
  try {
    const imageDrafts = await Promise.all(files.map(fileToPromptImageDraft))
    const images = await window.api.codingAgent.stagePromptImages(imageDrafts)
    workspaceSession.addComposerImages(
      images.map(toComposerImageAttachment),
      workspaceSession.defaultSessionContextId,
      threadId
    )
  } catch (error) {
    imageSelectionError.value = error instanceof Error ? error.message : String(error)
  } finally {
    selectingImages.value = false
  }
}

/**
 * 给图片附件补充前端稳定 ID。
 * @param image - 处理后的图片附件。
 * @returns Composer 图片附件。
 */
function toComposerImageAttachment(image: PromptImageAttachment): ComposerImageAttachment {
  return {
    ...image,
    id: `${image.name}-${image.size}-${crypto.randomUUID()}`
  }
}

/**
 * 将粘贴的浏览器 File 转成 prompt 图片草稿。
 * @param file - 图片文件。
 * @returns prompt 图片草稿。
 */
function fileToPromptImageDraft(file: File): Promise<PromptImageDraft> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('读取粘贴图片失败'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const [, data = ''] = result.split(',', 2)
      resolve({
        type: 'image',
        mimeType: file.type || 'image/png',
        data,
        name: file.name || 'pasted-image.png',
        size: file.size
      })
    }
    reader.readAsDataURL(file)
  })
}

/**
 * 获取 timeline 项对应组件。
 * @param item - timeline 项。
 * @returns Vue component。
 */
function getTimelineItemComponent(
  item: TimelineItem
):
  | typeof UserMessage
  | typeof AssistantMessage
  | typeof SystemMessage
  | typeof ToolMessage
  | typeof ThinkingMessage {
  if (item.type === 'thinking') {
    return ThinkingMessage
  }
  if (item.type === 'tool') {
    return ToolMessage
  }
  return getMessageComponent(item.message.role)
}

/**
 * 获取 timeline 项布局 class 后缀。
 * @param item - timeline 项。
 * @returns class 后缀。
 */
function getTimelineItemClassSuffix(item: TimelineItem): string {
  if (item.type === 'message') {
    return item.message.role
  }
  return item.type
}

/**
 * 获取 timeline 项消息。
 * @param item - timeline 项。
 * @returns 消息。
 */
function getTimelineItemMessage(item: TimelineItem): RenderableThreadMessage | undefined {
  return item.type === 'message' || item.type === 'thinking' ? item.message : undefined
}

/**
 * 获取 timeline 项文本。
 * @param item - timeline 项。
 * @returns 文本。
 */
function getTimelineItemText(item: TimelineItem): string | undefined {
  return item.type === 'message' || item.type === 'thinking' ? item.text : undefined
}

/**
 * 获取 timeline 项的渲染 ID。
 * @param item - timeline 项。
 * @returns 渲染 ID。
 */
function getTimelineItemMessageId(item: TimelineItem): string {
  return item.key
}

/**
 * 获取 timeline 项是否仍在流式输出。
 * @param item - timeline 项。
 * @returns 是否流式输出中。
 */
function getTimelineItemStreaming(item: TimelineItem): boolean {
  return item.type === 'message' || item.type === 'thinking'
    ? item.message.renderState === 'streaming'
    : false
}

/**
 * 获取 thinking 项是否应在后续响应内容出现后自动收起。
 * @param item - timeline 项。
 * @returns 是否自动收起。
 */
function getTimelineItemCollapseWhenResponseAppears(item: TimelineItem): boolean {
  return item.type === 'thinking' ? item.collapseWhenResponseAppears : false
}

/**
 * 获取 timeline 项工具调用。
 * @param item - timeline 项。
 * @returns 工具调用。
 */
function getTimelineItemToolCall(item: TimelineItem): DesktopToolCall | undefined {
  return item.type === 'message' || item.type === 'tool' ? item.toolCall : undefined
}

/**
 * 将 assistant message 的 thinking、text、toolCall content 拆成 timeline 项。
 * @param message - assistant message。
 * @param resultToolCallIds - 已在时间线中消费的工具调用 ID。
 * @returns timeline 项。
 */
function getAssistantTimelineItems(
  message: RenderableThreadMessage,
  resultToolCallIds: Set<string>
): TimelineItem[] {
  const content = getMessageRawRecord(message).content
  if (!Array.isArray(content)) {
    const text = getMessageText(message)
    return text
      ? [
          {
            type: 'message',
            key: `${message.id}:text`,
            message,
            text,
            revision: message.revision
          }
        ]
      : []
  }

  const items: TimelineItem[] = []
  content.forEach((part, index) => {
    if (!isRecord(part) || typeof part.type !== 'string') {
      return
    }
    if (part.type === 'thinking' && typeof part.thinking === 'string' && part.thinking) {
      items.push({
        type: 'thinking',
        key: `${message.id}:thinking:${index}`,
        message,
        text: part.thinking,
        collapseWhenResponseAppears: hasFollowingResponseContent(content, index),
        revision: message.revision
      })
      return
    }
    if (part.type === 'text' && typeof part.text === 'string' && part.text) {
      items.push({
        type: 'message',
        key: `${message.id}:text:${index}`,
        message,
        text: part.text,
        revision: message.revision
      })
      return
    }
    if (part.type === 'toolCall' && typeof part.id === 'string') {
      const toolCall =
        toolCalls.value.find((item) => item.toolCallId === part.id) ?? createPendingToolCall(part)
      resultToolCallIds.add(toolCall.toolCallId)
      items.push({
        type: 'tool',
        key: `${message.id}:tool:${toolCall.toolCallId}`,
        toolCall
      })
    }
  })

  return items
}

/**
 * 判断指定 content block 后面是否已经出现正文或工具调用。
 * @param content - assistant content block 列表。
 * @param index - 当前 block 下标。
 * @returns 后续是否存在非空 text block 或 toolCall block。
 */
function hasFollowingResponseContent(content: unknown[], index: number): boolean {
  return content
    .slice(index + 1)
    .some(
      (part) =>
        isRecord(part) &&
        ((part.type === 'text' && typeof part.text === 'string' && Boolean(part.text)) ||
          (part.type === 'toolCall' && typeof part.id === 'string' && Boolean(part.id)))
    )
}

/**
 * 从 assistant toolCall block 创建等待中的工具投影。
 * @param block - toolCall content block。
 * @returns 工具投影。
 */
function createPendingToolCall(block: Record<string, unknown>): DesktopToolCall {
  return {
    threadId: workspaceSession.activeSessionId ?? '',
    toolCallId: String(block.id),
    toolName: typeof block.name === 'string' ? block.name : 'tool',
    status: 'queued',
    args: 'arguments' in block ? block.arguments : undefined
  }
}

/**
 * 获取 tool result 消息关联的工具调用投影。
 * @param message - Thread message。
 * @returns 工具调用投影。
 */
function getToolResultMessageToolCall(
  message: RenderableThreadMessage
): DesktopToolCall | undefined {
  const raw = getMessageRawRecord(message)
  if (typeof raw.toolCallId !== 'string') {
    return undefined
  }
  return toolCalls.value.find((toolCall) => toolCall.toolCallId === raw.toolCallId)
}

/**
 * 更新底部距离状态。
 */
function updateScrollState(): void {
  const metrics = timelineRef.value?.getScrollMetrics()
  if (!metrics) {
    isNearBottom.value = true
    shouldFollowBottom.value = true
    return
  }

  const distanceToBottom = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight
  const nextIsNearBottom = distanceToBottom < NEAR_BOTTOM_DISTANCE
  isNearBottom.value = shouldFollowBottom.value && isRunning.value ? true : nextIsNearBottom
  if (distanceToBottom <= STICKY_BOTTOM_DISTANCE) {
    shouldFollowBottom.value = true
  } else if (!isRunning.value) {
    shouldFollowBottom.value = nextIsNearBottom
  }
}

/**
 * 滚动到最新消息。
 * @param behavior - 滚动行为。
 */
function scrollToLatest(behavior: TimelineScrollBehavior = 'smooth'): void {
  shouldFollowBottom.value = true
  timelineRef.value?.scrollBottom(behavior)
}

/** 滚动更新 rAF 句柄。 */
let scrollRafId: number | null = null
let pendingScrollBehavior: TimelineScrollBehavior = 'smooth'
let followBottomRafId: number | null = null
let followBottomSettleFrames = 0

/**
 * 合并滚动更新到下一帧，每帧最多执行一次。
 * @param behavior - 滚动行为。
 */
function scheduleScrollToLatest(behavior: TimelineScrollBehavior = 'smooth'): void {
  pendingScrollBehavior = behavior
  if (scrollRafId !== null) return
  scrollRafId = requestAnimationFrame(() => {
    scrollRafId = null
    scrollToLatest(pendingScrollBehavior)
  })
}

/**
 * streaming 期间持续把 timeline 贴到底部，覆盖 Markdown 分批渲染带来的晚到布局变化。
 */
function startFollowBottomLoop(settleFrames = 2): void {
  followBottomSettleFrames = Math.max(followBottomSettleFrames, settleFrames)
  if (followBottomRafId !== null) return

  followBottomRafId = requestAnimationFrame(() => {
    followBottomRafId = null
    if (!shouldFollowBottom.value) {
      followBottomSettleFrames = 0
      return
    }

    keepBottomInCurrentFrame()
    updateScrollState()

    const shouldKeepFollowing = isRunning.value || followBottomSettleFrames > 0
    if (followBottomSettleFrames > 0) {
      followBottomSettleFrames -= 1
    }
    if (shouldKeepFollowing) {
      startFollowBottomLoop(0)
    }
  })
}

/**
 * 内容高度变化时同步贴底，避免渲染批次之间露出底部空隙。
 */
function keepBottomInCurrentFrame(): void {
  if (!shouldFollowBottom.value) {
    return
  }
  timelineRef.value?.scrollBottom('auto')
  isNearBottom.value = true
}

/**
 * 用户明确向上滚动时退出自动跟随。
 * @param event - wheel 事件。
 */
function handleTimelineWheel(event: WheelEvent): void {
  if (event.deltaY < 0) {
    shouldFollowBottom.value = false
  } else if (isNearBottom.value) {
    shouldFollowBottom.value = true
  }
}

/**
 * 发送当前 Composer 草稿。
 */
async function sendComposerPrompt(): Promise<void> {
  await workspaceSession.sendPrompt()
}

watch(
  () => [
    workspaceSession.activeSessionId,
    timelineItems.value.length,
    timelineItems.value.at(-1)?.key,
    getTimelineItemRevision(timelineItems.value.at(-1)),
    composerHeight.value,
    isRunning.value
  ],
  async ([sessionId], [previousSessionId]) => {
    const isSessionChanged = sessionId !== previousSessionId
    const shouldFollow = isSessionChanged || shouldFollowBottom.value
    await nextTick()

    if (shouldFollow) {
      if (isSessionChanged) {
        scheduleScrollToLatest('auto')
      } else if (isRunning.value) {
        startFollowBottomLoop(4)
      } else {
        scheduleScrollToLatest('smooth')
      }
    } else {
      updateScrollState()
    }
  },
  { flush: 'post' }
)

useResizeObserver(timelineInnerRef, keepBottomInCurrentFrame)

onMounted(async () => {
  await nextTick()
  scheduleScrollToLatest('auto')
  updateScrollState()
})

onBeforeUnmount(() => {
  if (scrollRafId !== null) {
    cancelAnimationFrame(scrollRafId)
  }
  if (followBottomRafId !== null) {
    cancelAnimationFrame(followBottomRafId)
  }
})

/**
 * 获取时间线项的轻量更新依赖。
 * @param item - 时间线项。
 * @returns 更新依赖。
 */
function getTimelineItemRevision(item: TimelineItem | undefined): unknown[] {
  if (!item) {
    return []
  }
  if (item.type === 'message') {
    return [item.revision]
  }
  if (item.type === 'thinking') {
    return [item.revision, item.text, item.collapseWhenResponseAppears]
  }
  return [
    item.toolCall.status,
    item.toolCall.args,
    item.toolCall.partialResult,
    item.toolCall.result
  ]
}
</script>

<template>
  <div class="chat-view">
    <ScrollArea
      ref="timelineRef"
      class="chat-view__timeline"
      :class="{ 'chat-view__timeline--empty': !messages.length }"
      @scroll="updateScrollState"
      @wheel.passive="handleTimelineWheel"
    >
      <div ref="timelineInnerRef" class="chat-view__timeline-inner" :style="timelineStyle">
        <div
          v-for="item in timelineItems"
          :key="item.key"
          v-memo="getTimelineItemRevision(item)"
          class="chat-view__message"
          :class="`chat-view__message--${getTimelineItemClassSuffix(item)}`"
        >
          <component
            :is="getTimelineItemComponent(item)"
            :message="getTimelineItemMessage(item)"
            :message-id="getTimelineItemMessageId(item)"
            :text="getTimelineItemText(item)"
            :is-streaming="getTimelineItemStreaming(item)"
            :collapse-when-response-appears="getTimelineItemCollapseWhenResponseAppears(item)"
            :tool-call="getTimelineItemToolCall(item)"
          />
        </div>

        <div v-if="isRunning" class="chat-view__activity" aria-live="polite">
          <span />
          <span>Agent 正在工作</span>
        </div>
      </div>
    </ScrollArea>

    <button
      v-if="workspaceSession.activeSession && messages.length > 0 && !isNearBottom"
      type="button"
      class="chat-view__jump"
      :style="jumpBtnStyle"
      @click="scrollToLatest()"
    >
      回到最新
    </button>

    <div ref="composerRef" class="chat-view__composer">
      <Composer
        v-model="workspaceSession.draftMessage"
        :is-running="isRunning"
        :can-send="canSend"
        :thread-id="workspaceSession.activeSessionId"
        :project-id="workspaceSession.activeProjectId"
        :projects="workspaceProject.projectList"
        :images="workspaceSession.draftImages"
        :image-error="imageSelectionError"
        :selecting-images="selectingImages"
        placeholder="描述你想让 Agent 完成的事"
        @submit="sendComposerPrompt"
        @select-project="workspaceSession.startNewSession"
        @select-images="handleSelectImages"
        @paste-images="handlePasteImages"
        @remove-image="workspaceSession.removeComposerImage"
        @abort="workspaceSession.abortActive"
      />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.chat-view {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.chat-view__timeline {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  scroll-behavior: smooth;
  scroll-padding: var(--space-8);
}

.chat-view__timeline-inner {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  max-width: 768px;
  min-height: 100%;
  margin: 0 auto;
  padding: var(--space-6) var(--space-8) var(--space-8);
}

.chat-view__timeline--empty {
  &::before,
  &::after {
    display: none;
  }

  .chat-view__timeline-inner {
    padding: var(--space-8) var(--space-3);
  }
}

.chat-view__message {
  display: flex;
  min-width: 0;
  animation: message-in var(--duration-base) var(--ease-standard);
}

.chat-view__message--user {
  justify-content: flex-end;
}

.chat-view__message--assistant,
.chat-view__message--thinking,
.chat-view__message--system,
.chat-view__message--tool {
  justify-content: flex-start;
}

.chat-view__empty {
  display: grid;
  place-content: center;
  gap: var(--space-2);
  align-self: center;
  width: min(420px, 100%);
  min-height: 100%;
  color: var(--color-text-muted);
  text-align: center;

  strong {
    color: var(--color-text);
    font-size: 15px;
    font-weight: 680;
  }

  span {
    font-size: 12px;
    line-height: 1.6;
  }
}

.chat-view__activity {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  align-self: flex-start;
  margin-top: var(--space-1);
  padding: var(--space-1) var(--space-2);
  color: var(--color-text-muted);
  font-size: 12px;
  background: color-mix(in srgb, var(--color-control-track) 86%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-primary) 24%, var(--color-border));
  border-radius: 999px;
  box-shadow: var(--shadow-sm);

  span:first-child {
    width: 6px;
    height: 6px;
    background: var(--color-primary);
    border-radius: 50%;
    animation: pulse 1.1s var(--ease-standard) infinite;
  }
}

.chat-view__jump {
  position: absolute;
  left: 50%;
  transform: translate(-50%, 0);
  z-index: 4;
  padding: 6px var(--space-3);
  color: var(--color-primary-ink);
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  background: var(--color-primary);
  border: 1px solid var(--color-primary);
  border-radius: 999px;
  box-shadow: var(--shadow-md);
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);

  &:hover {
    background: var(--color-primary-strong);
    transform: translate(-50%, -1px);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus), var(--shadow-md);
  }
}

.chat-view__composer {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translate(-50%, 0);
  width: 100%;
  max-width: 768px;
  padding: 0 var(--space-8) 24px;
  margin: 0 auto;
}

@keyframes pulse {
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

@keyframes message-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (width <= 720px) {
  .chat-view {
    padding: 0 var(--space-3) var(--space-3);
  }

  .chat-view__timeline {
    padding-inline: 0;
  }

  .chat-view__jump {
    right: var(--space-5);
  }
}
</style>
