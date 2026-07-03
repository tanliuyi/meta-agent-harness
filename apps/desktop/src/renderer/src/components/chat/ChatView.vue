<script setup lang="ts">
/**
 * ChatView.vue - 当前活跃会话的消息流与输入区组件。
 */

import type { CSSProperties } from 'vue'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  watch
} from 'vue'
import { useElementSize, useResizeObserver } from '@vueuse/core'
import { ChevronDown } from 'lucide-vue-next'
import Composer from './Composer.vue'
import AssistantMessage from './messages/AssistantMessage.vue'
import ThinkingMessage from './messages/ThinkingMessage.vue'
import SystemMessage from './messages/SystemMessage.vue'
import ToolMessage from './messages/ToolMessage.vue'
import UserMessage from './messages/UserMessage.vue'
import ExploreToolGroup from './messages/tools/ExploreToolGroup.vue'
import MutationToolGroup from './messages/tools/MutationToolGroup.vue'
import ToolMessageById from './messages/tools/ToolMessageById.vue'
import { toolCallsByIdKey, type ToolCallsById } from './messages/tools/tool-call-context'
import {
  getToolGroupStatus,
  groupTimelineTools,
  type ToolCall,
  type ToolGroupStatus,
  type ToolGroupTimelineItem
} from './messages/tools/tool-group'
import { getMessageRawRecord, getMessageText, isRecord } from './messages/message-format'
import { toRenderableMessage, type RenderableThreadMessage } from './messages/renderable-message'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import useWorkspaceProjectStore from '@renderer/stores/workspace-project'
import type { DesktopToolCall } from '../../../../../../../packages/coding-agent/src/desktop/protocol/tool.ts'
import ScrollArea from '../ui/scroll-area/ScrollArea.vue'
import type {
  ComposerImageAttachment,
  WorkspaceToolCallStructure
} from '@renderer/stores/workspace-session'
import type { PromptImageAttachment, PromptImageDraft } from '@shared/coding-agent/types'

const workspaceSession = useWorkspaceSessionStore()
const workspaceProject = useWorkspaceProjectStore()
const agentSettings = useAgentSettingsStore()

type TimelineScrollBehavior = 'auto' | 'smooth'
type ScrollAreaInstance = InstanceType<typeof ScrollArea>
const NEAR_BOTTOM_DISTANCE = 32
const STICKY_BOTTOM_DISTANCE = 2
type TimelineItem =
  | {
      type: 'collapsed-history'
      key: string
      hiddenCount: number
      hiddenTurnCount: number
      durationLabel?: string
      collapsible: boolean
    }
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
      toolCall: WorkspaceToolCallStructure
    }
  | ToolGroupTimelineItem
type UngroupedTimelineItem = Exclude<TimelineItem, ToolGroupTimelineItem>
type CollapsedHistoryTimelineItem = Extract<TimelineItem, { type: 'collapsed-history' }>
type TimelineItemComponent =
  | typeof UserMessage
  | typeof AssistantMessage
  | typeof SystemMessage
  | typeof ToolMessage
  | typeof ThinkingMessage
  | typeof MutationToolGroup
  | typeof ExploreToolGroup
  | typeof ToolMessageById
type TimelineViewItem = {
  key: string
  item: TimelineItem
  revision: unknown[]
  className: string
  isCollapsedHistory: boolean
  collapsedItem?: CollapsedHistoryTimelineItem
  collapsedOpen: boolean
  collapsedIconClass?: {
    'is-collapsed': boolean
    'is-pending': boolean
  }
  component?: TimelineItemComponent
  message?: RenderableThreadMessage
  messageId: string
  text?: string
  isStreaming: boolean
  collapseWhenResponseAppears: boolean
  toolCall?: DesktopToolCall
  toolCallId?: string
  toolCallIds?: string[]
  summary?: string
  status?: ToolGroupStatus
}

/** 已折叠处理段的展开状态。 */
const collapsedHistoryOpenByKey = ref<Record<string, boolean>>({})

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

/** 当前会话的工具调用结构列表。 */
const toolCallStructures = computed(() => workspaceSession.activeToolCallStructures)
const toolCallsById = computed(() => workspaceSession.activeToolCallsById)
provide(toolCallsByIdKey, toolCallsById as ToolCallsById)

/** 当前会话的待交付消息队列。 */
const pendingQueue = computed(
  () => workspaceSession.activeSnapshot?.queue ?? { steering: [], followUp: [] }
)

/** 是否隐藏 assistant thinking block。 */
const hideThinkingBlock = computed(() => agentSettings.snapshot?.display.hideThinkingBlock ?? false)

/** 是否存在待交付队列消息。 */
const hasPendingQueue = computed(
  () => pendingQueue.value.steering.length > 0 || pendingQueue.value.followUp.length > 0
)

/** 当前会话的统一时间线。 */
const timelineItems = computed<TimelineItem[]>(() => {
  const resultToolCallIds = new Set<string>()
  const toolResultMessageIds = collectToolResultMessageIds(messages.value)
  const items: UngroupedTimelineItem[] = []
  for (const message of messages.value) {
    if (message.role === 'assistant') {
      items.push(...getAssistantTimelineItems(message, resultToolCallIds, toolResultMessageIds))
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
  for (const toolCall of toolCallStructures.value) {
    if (resultToolCallIds.has(toolCall.toolCallId)) {
      continue
    }
    items.push({
      type: 'tool',
      key: `tool-${toolCall.toolCallId}`,
      toolCall
    })
  }
  return groupTimelineTools(items)
})

type ProcessingCollapseContext = {
  key: string
  boundaryIndex: number
  processEndIndex: number
  hiddenCount: number
  hiddenTurnCount: number
  durationLabel?: string
  collapsible: boolean
}

/** 当前会话内所有 user prompt/steer/follow-up 对应的处理段。 */
const processingCollapseContexts = computed<ProcessingCollapseContext[]>(() => {
  const items = timelineItems.value
  const contexts: ProcessingCollapseContext[] = []
  for (let index = 0; index < items.length; index += 1) {
    if (!isUserMessageItem(items[index])) {
      continue
    }
    const boundaryIndex = index + 1
    const segmentEndIndex = findNextUserMessageIndex(items, boundaryIndex)
    const endIndex = segmentEndIndex < 0 ? items.length : segmentEndIndex
    const finalReplyIndex = findFinalReplyIndexInRange(items, boundaryIndex, endIndex)
    const hasFinalReply = finalReplyIndex >= boundaryIndex
    const processEndIndex = hasFinalReply ? finalReplyIndex : endIndex
    const hiddenItems = items.slice(boundaryIndex, processEndIndex)
    const isActiveSegment = segmentEndIndex < 0 && !hasFinalReply && isRunning.value
    if (hiddenItems.length === 0 && !isActiveSegment) {
      continue
    }
    contexts.push({
      key: `${workspaceSession.activeSessionId ?? 'session'}:${boundaryIndex}`,
      boundaryIndex,
      processEndIndex,
      hiddenCount: hiddenItems.length,
      hiddenTurnCount: countTurns(hiddenItems),
      durationLabel: formatProcessingDuration(
        items[index],
        hiddenItems,
        hasFinalReply
          ? items[finalReplyIndex]
          : segmentEndIndex >= 0
            ? items[segmentEndIndex]
            : undefined
      ),
      collapsible: hasFinalReply || segmentEndIndex >= 0
    })
  }
  return contexts
})

/** 实际渲染的时间线；运行开始即展示 trigger，最终回复开始后才收起过程项。 */
const displayTimelineItems = computed<TimelineItem[]>(() => {
  const contexts = processingCollapseContexts.value
  if (contexts.length === 0) {
    return timelineItems.value
  }
  const items: TimelineItem[] = []
  let cursor = 0
  for (const context of contexts) {
    items.push(...timelineItems.value.slice(cursor, context.boundaryIndex))
    const collapsedItem: TimelineItem = {
      type: 'collapsed-history',
      key: `collapsed-history:${context.key}`,
      hiddenCount: context.hiddenCount,
      hiddenTurnCount: context.hiddenTurnCount,
      durationLabel: context.durationLabel,
      collapsible: context.collapsible
    }
    items.push(collapsedItem)
    if (isCollapsedHistoryOpen(collapsedItem)) {
      items.push(...timelineItems.value.slice(context.boundaryIndex, context.processEndIndex))
    }
    cursor = context.processEndIndex
  }
  items.push(...timelineItems.value.slice(cursor))
  return items
})

/** 模板直接消费的时间线视图模型，避免 patch 阶段重复调用 item getter。 */
const displayTimelineViewItems = computed<TimelineViewItem[]>(() =>
  displayTimelineItems.value.map(toTimelineViewItem)
)

watch(
  () => processingCollapseContexts.value.map((context) => `collapsed-history:${context.key}`),
  (keys) => {
    const keySet = new Set(keys)
    for (const key of Object.keys(collapsedHistoryOpenByKey.value)) {
      if (!keySet.has(key)) {
        delete collapsedHistoryOpenByKey.value[key]
      }
    }
  }
)

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
const runningDelivery = ref<'steer' | 'followUp'>('steer')
const processingNow = ref(Date.now())
let processingTimerId: number | null = null

/** 当前会话是否正在执行。 */
const isRunning = computed(() =>
  ['queued', 'starting', 'running', 'stopping'].includes(
    workspaceSession.activeSession?.status ?? ''
  )
)

/** 是否允许发送消息。 */
const canSend = computed(() =>
  Boolean(workspaceSession.activeProjectId && workspaceSession.hasDraftMessage)
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
): TimelineItemComponent {
  if (item.type === 'collapsed-history') {
    return SystemMessage
  }
  if (item.type === 'thinking') {
    return ThinkingMessage
  }
  if (item.type === 'tool-group') {
    return item.groupKind === 'mutation' ? MutationToolGroup : ExploreToolGroup
  }
  if (item.type === 'tool') {
    return ToolMessageById
  }
  return getMessageComponent(item.message.role)
}

/**
 * 获取 timeline 项布局 class 后缀。
 * @param item - timeline 项。
 * @returns class 后缀。
 */
function getTimelineItemClassSuffix(item: TimelineItem): string {
  if (item.type === 'collapsed-history') {
    return 'collapsed-history'
  }
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
  return item.type === 'message' ? item.toolCall : undefined
}

/**
 * 获取 timeline 项工具调用 ID。
 * @param item - timeline 项。
 * @returns 工具调用 ID。
 */
function getTimelineItemToolCallId(item: TimelineItem): string | undefined {
  return item.type === 'tool' ? item.toolCall.toolCallId : undefined
}

/**
 * 获取 timeline 项工具调用 ID 组。
 * @param item - timeline 项。
 * @returns 工具调用 ID 组。
 */
function getTimelineItemToolCallIds(item: TimelineItem): string[] | undefined {
  return item.type === 'tool-group' ? item.toolCallIds : undefined
}

/**
 * 获取工具组摘要。
 * @param item - timeline 项。
 * @returns 工具组摘要。
 */
function getTimelineItemToolGroupSummary(item: TimelineItem): string | undefined {
  return item.type === 'tool-group' ? item.summary : undefined
}

/**
 * 获取工具组聚合状态。
 * @param item - timeline 项。
 * @returns 工具组状态。
 */
function getTimelineItemToolGroupStatus(item: TimelineItem): ToolGroupStatus | undefined {
  if (item.type !== 'tool-group') {
    return undefined
  }
  const toolCalls = item.toolCallIds
    .map((toolCallId) => toolCallsById.value[toolCallId])
    .filter((toolCall): toolCall is ToolCall => Boolean(toolCall))
  return getToolGroupStatus(toolCalls)
}

/**
 * 将 timeline item 转成模板消费的稳定视图模型。
 * @param item - timeline 项。
 * @returns timeline 视图模型。
 */
function toTimelineViewItem(item: TimelineItem): TimelineViewItem {
  const isCollapsedHistory = isCollapsedHistoryItem(item)
  const collapsedOpen = isCollapsedHistory ? isCollapsedHistoryOpen(item) : false
  return {
    key: item.key,
    item,
    revision: getTimelineItemRevision(item),
    className: `chat-view__message--${getTimelineItemClassSuffix(item)}`,
    isCollapsedHistory,
    collapsedItem: isCollapsedHistory ? item : undefined,
    collapsedOpen,
    collapsedIconClass: isCollapsedHistory
      ? {
          'is-collapsed': item.collapsible && !collapsedOpen,
          'is-pending': !item.collapsible
        }
      : undefined,
    component: isCollapsedHistory ? undefined : getTimelineItemComponent(item),
    message: getTimelineItemMessage(item),
    messageId: getTimelineItemMessageId(item),
    text: getTimelineItemText(item),
    isStreaming: getTimelineItemStreaming(item),
    collapseWhenResponseAppears: getTimelineItemCollapseWhenResponseAppears(item),
    toolCall: getTimelineItemToolCall(item),
    toolCallId: getTimelineItemToolCallId(item),
    toolCallIds: getTimelineItemToolCallIds(item),
    summary: getTimelineItemToolGroupSummary(item),
    status: getTimelineItemToolGroupStatus(item)
  }
}

/**
 * 判断 timeline 项是否是自动折叠的历史占位。
 * @param item - timeline 项。
 * @returns 是否折叠历史项。
 */
function isCollapsedHistoryItem(
  item: TimelineItem
): item is Extract<TimelineItem, { type: 'collapsed-history' }> {
  return item.type === 'collapsed-history'
}

/**
 * 切换自动折叠历史的展开状态。
 * @param item - 折叠历史项。
 */
function toggleCollapsedHistory(item: Extract<TimelineItem, { type: 'collapsed-history' }>): void {
  if (!item.collapsible) {
    return
  }
  collapsedHistoryOpenByKey.value[item.key] = !collapsedHistoryOpenByKey.value[item.key]
}

/**
 * 获取处理段是否展开。
 * @param item - 折叠历史项。
 * @returns 是否展开。
 */
function isCollapsedHistoryOpen(
  item: Extract<TimelineItem, { type: 'collapsed-history' }>
): boolean {
  return !item.collapsible || Boolean(collapsedHistoryOpenByKey.value[item.key])
}

/**
 * 将 assistant message 的 thinking、text、toolCall content 拆成 timeline 项。
 * @param message - assistant message。
 * @param resultToolCallIds - 已在时间线中消费的工具调用 ID。
 * @returns timeline 项。
 */
function getAssistantTimelineItems(
  message: RenderableThreadMessage,
  resultToolCallIds: Set<string>,
  toolResultMessageIds: Set<string>
): UngroupedTimelineItem[] {
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

  const items: UngroupedTimelineItem[] = []
  content.forEach((part, index) => {
    if (!isRecord(part) || typeof part.type !== 'string') {
      return
    }
    if (
      part.type === 'thinking' &&
      typeof part.thinking === 'string' &&
      part.thinking &&
      !hideThinkingBlock.value
    ) {
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
      if (toolResultMessageIds.has(part.id)) {
        return
      }
      const toolCall =
        toolCallStructures.value.find((item) => item.toolCallId === part.id) ??
        createPendingToolCall(part)
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
 * 收集已落地为 tool result message 的工具调用 ID。
 * @param items - 当前消息列表。
 * @returns tool result 关联的 toolCallId 集合。
 */
function collectToolResultMessageIds(items: RenderableThreadMessage[]): Set<string> {
  const ids = new Set<string>()
  for (const message of items) {
    if (message.role !== 'tool') {
      continue
    }
    const raw = getMessageRawRecord(message)
    if (typeof raw.toolCallId === 'string') {
      ids.add(raw.toolCallId)
    }
  }
  return ids
}

/**
 * 在指定范围内查找最终回复候选：assistant 正文已开始，且同一 assistant message 尚无 toolCall。
 * @param items - timeline 项。
 * @param startIndex - 起始下标，包含。
 * @param endIndex - 结束下标，不包含。
 * @returns timeline 下标，未找到时返回 -1。
 */
function findFinalReplyIndexInRange(
  items: TimelineItem[],
  startIndex: number,
  endIndex: number
): number {
  let candidateIndex = -1
  for (let index = startIndex; index < endIndex; index += 1) {
    const item = items[index]
    if (
      item.type === 'message' &&
      item.message.role === 'assistant' &&
      Boolean(item.text) &&
      !hasAssistantToolCall(item.message)
    ) {
      candidateIndex = index
    }
  }
  return candidateIndex
}

/**
 * 查找下一个 user message。
 * @param items - timeline 项。
 * @param startIndex - 起始下标，包含。
 * @returns user message 下标，未找到时返回 -1。
 */
function findNextUserMessageIndex(items: TimelineItem[], startIndex: number): number {
  for (let index = startIndex; index < items.length; index += 1) {
    if (isUserMessageItem(items[index])) {
      return index
    }
  }
  return -1
}

/**
 * 判断 timeline 项是否是 user message。
 * @param item - timeline 项。
 * @returns 是否 user message。
 */
function isUserMessageItem(item: TimelineItem | undefined): boolean {
  return item?.type === 'message' && item.message.role === 'user'
}

/**
 * 判断 assistant message 是否已经包含工具调用。
 * @param message - assistant message。
 * @returns 是否包含 toolCall block。
 */
function hasAssistantToolCall(message: RenderableThreadMessage): boolean {
  const content = getMessageRawRecord(message).content
  return (
    Array.isArray(content) &&
    content.some(
      (part) => isRecord(part) && part.type === 'toolCall' && typeof part.id === 'string'
    )
  )
}

/**
 * 粗略统计折叠区包含的历史轮次数。
 * @param items - 被折叠的 timeline 项。
 * @returns 历史轮次数。
 */
function countTurns(items: TimelineItem[]): number {
  const userMessageCount = items.filter(
    (item) => item.type === 'message' && item.message.role === 'user'
  ).length
  return Math.max(1, userMessageCount)
}

/**
 * 格式化被折叠过程的处理耗时。
 * @param promptItem - 触发处理段的用户消息。
 * @param hiddenItems - 被折叠的过程项。
 * @param finalReplyItem - 最终回复项。
 * @returns 耗时标签。
 */
function formatProcessingDuration(
  promptItem: TimelineItem,
  hiddenItems: TimelineItem[],
  finalReplyItem: TimelineItem | undefined
): string | undefined {
  const startedAt =
    getTimelineItemStartTime(promptItem) ??
    hiddenItems.map(getTimelineItemStartTime).find((time) => time !== undefined)
  const endedAt = getTimelineItemEndTime(finalReplyItem) ?? processingNow.value
  if (startedAt === undefined || endedAt <= startedAt) {
    return undefined
  }
  const seconds = Math.max(1, Math.round((endedAt - startedAt) / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
}

/**
 * 获取 timeline 项开始时间戳。
 * @param item - timeline 项。
 * @returns 时间戳。
 */
function getTimelineItemStartTime(item: TimelineItem | undefined): number | undefined {
  if (!item || item.type === 'collapsed-history') {
    return undefined
  }
  if (item.type === 'tool') {
    return parseTime(item.toolCall.startedAt)
  }
  if (item.type === 'tool-group') {
    return item.toolCallIds
      .map(findToolCallStructureById)
      .filter((toolCall): toolCall is WorkspaceToolCallStructure => Boolean(toolCall))
      .map((toolCall) => parseTime(toolCall.startedAt))
      .find((time) => time !== undefined)
  }
  return parseTime(item.message.createdAt)
}

/**
 * 获取 timeline 项结束时间戳。
 * @param item - timeline 项。
 * @returns 时间戳。
 */
function getTimelineItemEndTime(item: TimelineItem | undefined): number | undefined {
  if (!item || item.type === 'collapsed-history') {
    return undefined
  }
  if (item.type === 'tool') {
    return parseTime(item.toolCall.finishedAt ?? item.toolCall.startedAt)
  }
  if (item.type === 'tool-group') {
    return [...item.toolCallIds]
      .reverse()
      .map(findToolCallStructureById)
      .filter((toolCall): toolCall is WorkspaceToolCallStructure => Boolean(toolCall))
      .map((toolCall) => parseTime(toolCall.finishedAt ?? toolCall.startedAt))
      .find((time) => time !== undefined)
  }
  return parseTime(item.message.createdAt)
}

/**
 * 从 timeline 结构索引中查找工具调用，避免父级订阅完整流式 result。
 * @param toolCallId - 工具调用 ID。
 * @returns 工具调用结构。
 */
function findToolCallStructureById(toolCallId: string): WorkspaceToolCallStructure | undefined {
  return toolCallStructures.value.find((toolCall) => toolCall.toolCallId === toolCallId)
}

/**
 * 解析 ISO 时间。
 * @param value - ISO 时间。
 * @returns 时间戳。
 */
function parseTime(value: string | undefined): number | undefined {
  if (!value) {
    return undefined
  }
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? undefined : time
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
  return toolCallsById.value[raw.toolCallId]
}

/**
 * 更新底部距离状态。
 */
function updateScrollState(): void {
  const distanceToBottom = getDistanceToBottom()
  if (distanceToBottom === undefined) {
    isNearBottom.value = true
    shouldFollowBottom.value = true
    return
  }

  const nextIsNearBottom = distanceToBottom < NEAR_BOTTOM_DISTANCE
  if (distanceToBottom <= STICKY_BOTTOM_DISTANCE) {
    isUserScrollLocked = false
    isNearBottom.value = true
    shouldFollowBottom.value = true
  } else if (isUserScrollLocked) {
    isNearBottom.value = nextIsNearBottom
    shouldFollowBottom.value = false
  } else if (!isRunning.value) {
    isNearBottom.value = nextIsNearBottom
    shouldFollowBottom.value = nextIsNearBottom
  } else {
    isNearBottom.value = shouldFollowBottom.value ? true : nextIsNearBottom
  }
}

/**
 * 滚动到最新消息。
 * @param behavior - 滚动行为。
 */
function scrollToLatest(behavior: TimelineScrollBehavior = 'smooth'): void {
  isUserScrollLocked = false
  shouldFollowBottom.value = true
  timelineRef.value?.scrollBottom(behavior)
}

/** 滚动更新 rAF 句柄。 */
let scrollRafId: number | null = null
let pendingScrollBehavior: TimelineScrollBehavior = 'smooth'
let followBottomRafId: number | null = null
let followBottomSettleFrames = 0
let isUserScrollLocked = false

/**
 * 获取当前距离底部的距离。
 * @returns 底部距离。
 */
function getDistanceToBottom(): number | undefined {
  const metrics = timelineRef.value?.getScrollMetrics()
  if (!metrics) {
    return undefined
  }
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight
}

/**
 * 用户开始操作滚动时暂停自动贴底。
 */
function holdUserScroll(): void {
  isUserScrollLocked = true
  shouldFollowBottom.value = false
  if (scrollRafId !== null) {
    cancelAnimationFrame(scrollRafId)
    scrollRafId = null
  }
  if (followBottomRafId !== null) {
    cancelAnimationFrame(followBottomRafId)
    followBottomRafId = null
  }
  followBottomSettleFrames = 0
}

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
 * 用户滚动时退出自动跟随。
 * @param event - wheel 事件。
 */
function handleTimelineWheel(event: WheelEvent): void {
  if (Math.abs(event.deltaY) < 1) {
    return
  }
  holdUserScroll()
}

/**
 * 发送当前 Composer 草稿。
 */
async function sendComposerPrompt(): Promise<void> {
  await workspaceSession.sendPrompt(workspaceSession.defaultSessionContextId, runningDelivery.value)
}

watch(
  () => [
    workspaceSession.activeSessionId,
    displayTimelineItems.value.length,
    displayTimelineItems.value.at(-1)?.key,
    getTimelineItemRevision(displayTimelineItems.value.at(-1)),
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

watch(
  isRunning,
  (running) => {
    processingNow.value = Date.now()
    if (running) {
      processingTimerId ??= window.setInterval(() => {
        processingNow.value = Date.now()
      }, 1000)
      return
    }
    if (processingTimerId !== null) {
      window.clearInterval(processingTimerId)
      processingTimerId = null
    }
  },
  { immediate: true }
)

useResizeObserver(timelineInnerRef, keepBottomInCurrentFrame)

onMounted(async () => {
  if (!agentSettings.snapshot) {
    void agentSettings.load()
  }
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
  if (processingTimerId !== null) {
    window.clearInterval(processingTimerId)
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
  if (item.type === 'collapsed-history') {
    return [
      item.hiddenCount,
      item.hiddenTurnCount,
      item.durationLabel,
      item.collapsible,
      isCollapsedHistoryOpen(item)
    ]
  }
  if (item.type === 'message') {
    return [item.revision, ...getToolCallRevision(item.toolCall)]
  }
  if (item.type === 'thinking') {
    return [item.revision, item.text, item.collapseWhenResponseAppears]
  }
  if (item.type === 'tool-group') {
    return [item.groupKind, item.summary, getTimelineItemToolGroupStatus(item), ...item.toolCallIds]
  }
  return [
    item.toolCall.toolCallId,
    item.toolCall.toolName,
    item.toolCall.args,
    item.toolCall.startedAt,
    item.toolCall.finishedAt
  ]
}

/**
 * 获取工具调用渲染依赖，避免 v-memo 跳过 tool result 状态/结果更新。
 * @param toolCall - 工具调用。
 * @returns 更新依赖。
 */
function getToolCallRevision(toolCall: DesktopToolCall | undefined): unknown[] {
  if (!toolCall) {
    return []
  }
  return [
    toolCall.toolCallId,
    toolCall.toolName,
    toolCall.status,
    toolCall.args,
    toolCall.partialResult,
    toolCall.result,
    toolCall.startedAt,
    toolCall.finishedAt
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
          v-for="viewItem in displayTimelineViewItems"
          :key="viewItem.key"
          v-memo="viewItem.revision"
          class="chat-view__message"
          :class="viewItem.className"
        >
          <button
            v-if="viewItem.isCollapsedHistory && viewItem.collapsedItem"
            type="button"
            class="chat-view__collapsed-history"
            :class="{ 'is-pending': !viewItem.collapsedItem.collapsible }"
            :aria-expanded="viewItem.collapsedOpen"
            :aria-disabled="!viewItem.collapsedItem.collapsible"
            @click="toggleCollapsedHistory(viewItem.collapsedItem)"
          >
            <span class="chat-view__collapsed-history-label">
              已处理<span v-if="viewItem.collapsedItem.durationLabel"
                >&nbsp;{{ viewItem.collapsedItem.durationLabel }}</span
              >
            </span>
            <ChevronDown
              v-if="viewItem.collapsedItem.collapsible"
              :size="16"
              class="chat-view__collapsed-history-icon"
              :class="viewItem.collapsedIconClass"
            />
          </button>
          <component
            :is="viewItem.component"
            v-else
            :message="viewItem.message"
            :message-id="viewItem.messageId"
            :text="viewItem.text"
            :is-streaming="viewItem.isStreaming"
            :collapse-when-response-appears="viewItem.collapseWhenResponseAppears"
            :tool-call="viewItem.toolCall"
            :tool-call-id="viewItem.toolCallId"
            :tool-call-ids="viewItem.toolCallIds"
            :summary="viewItem.summary"
            :status="viewItem.status"
          />
        </div>

        <div v-if="isRunning" class="chat-view__activity" aria-live="polite">
          <span />
          <span>
            Agent 正在工作
            <template v-if="hasPendingQueue">
              · 已排队 {{ pendingQueue.steering.length }} 条 steer /
              {{ pendingQueue.followUp.length }} 条 follow-up
            </template>
          </span>
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
        v-model:running-delivery="runningDelivery"
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
}

.chat-view__message--user {
  justify-content: flex-end;
}

.chat-view__message--assistant,
.chat-view__message--thinking,
.chat-view__message--system,
.chat-view__message--tool,
.chat-view__message--collapsed-history {
  justify-content: flex-start;
}

.chat-view__collapsed-history {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  height: 28px;
  padding: 0 0 var(--space-3);
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--font-size-ui);
  line-height: 1.4;
  text-align: left;
  background: transparent;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 58%, transparent);
  border-radius: 0;
  cursor: pointer;
  transition:
    color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-text);
    border-color: var(--color-border);
  }

  &:focus-visible {
    outline: none;
    color: var(--color-text);
    border-color: var(--color-primary);
  }

  &.is-pending {
    cursor: default;

    &:hover {
      color: var(--color-text-muted);
      border-color: color-mix(in srgb, var(--color-border) 58%, transparent);
    }
  }
}

.chat-view__collapsed-history-label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.chat-view__collapsed-history-icon {
  flex: 0 0 auto;
  color: var(--color-text-subtle);
  transition: transform var(--duration-fast) var(--ease-standard);

  &.is-collapsed {
    transform: rotate(-90deg);
  }

  &.is-pending {
    transform: none;
  }
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
    font-size: var(--font-size-ui-lg);
    font-weight: 680;
  }

  span {
    font-size: var(--font-size-ui-sm);
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
  font-size: var(--font-size-ui-sm);
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
  font-size: var(--font-size-ui-sm);
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
