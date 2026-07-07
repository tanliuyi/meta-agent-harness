<script setup lang="ts">
/**
 * ChatView.vue - 当前活跃会话的消息流与输入区组件。
 */

import type { CSSProperties } from 'vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useElementSize, useResizeObserver } from '@vueuse/core'
import { ChevronDown } from 'lucide-vue-next'
import Composer from './composer/Composer.vue'
import AssistantMessage from './messages/AssistantMessage.vue'
import ThinkingMessage from './messages/ThinkingMessage.vue'
import SystemMessage from './messages/SystemMessage.vue'
import ToolMessage from './messages/ToolMessage.vue'
import UserMessage from './messages/UserMessage.vue'
import ExploreToolGroup from './messages/tools/ExploreToolGroup.vue'
import MutationToolGroup from './messages/tools/MutationToolGroup.vue'
import type { ToolCall, ToolGroupStatus } from './messages/tools/support/tool-group'
import {
  scheduleInitialSettingsLoad,
  type InitialSettingsLoadSchedule
} from './settings/initialSettingsLoad'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import useModelSettingsStore from '@renderer/stores/model-settings'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import useWorkspaceProjectStore from '@renderer/stores/workspace-project'
import { useSessionContext } from '@renderer/composables/useSessionContext'
import type { DesktopToolCall } from '@coding-agent-src/desktop/protocol/tool.ts'
import ScrollArea from '../ui/scroll-area/ScrollArea.vue'
import type {
  ComposerFileAttachment,
  ComposerImageAttachment,
  MessageRenderState
} from '@renderer/stores/workspace-session'
import {
  createDisplayTimelineItems,
  createProcessingCollapseResult,
  createTimelineItems,
  getTimelineItemToolGroupStatus,
  getToolResultMessageToolCall,
  isCollapsedHistoryItem,
  resolveTimelineToolCall as resolveTimelineToolCallFromState,
  type CollapsedHistoryTimelineItem,
  type ProcessingCollapseContext,
  type ProcessingCollapseResult,
  type TimelineItem
} from './timeline/chatTimelineDisplay'
import type {
  ExtensionUiRequest,
  PromptImageAttachment,
  PromptImageDraft,
  ThreadMessage,
  ThinkingLevel
} from '@shared/coding-agent/types'
import type { TokenUsage } from './composer/Usage.vue'

const workspaceSession = useWorkspaceSessionStore()
const { openPanelTab } = useSessionContext()
const workspaceProject = useWorkspaceProjectStore()
const agentSettings = useAgentSettingsStore()
const modelSettings = useModelSettingsStore()
let initialSettingsLoadSchedule: InitialSettingsLoadSchedule | undefined

type TimelineScrollBehavior = 'auto' | 'smooth'
type ScrollAreaInstance = InstanceType<typeof ScrollArea>
const NEAR_BOTTOM_DISTANCE = 32
const STICKY_BOTTOM_DISTANCE = 2
type TimelineItemComponent =
  | typeof UserMessage
  | typeof AssistantMessage
  | typeof SystemMessage
  | typeof ToolMessage
  | typeof ThinkingMessage
  | typeof MutationToolGroup
  | typeof ExploreToolGroup
type TimelineViewItem = {
  key: string
  item: TimelineItem
  className: string
  isCollapsedHistory: boolean
  collapsedItem?: CollapsedHistoryTimelineItem
  collapsedOpen: boolean
  collapsedIconClass?: {
    'is-collapsed': boolean
    'is-pending': boolean
  }
  component?: TimelineItemComponent
  message?: ThreadMessage
  messageId: string
  text?: string
  revision: number
  isStreaming: boolean
  /** 是否是最终回复（无工具调用的 assistant 消息）。 */
  isFinalReply: boolean
  /** 消息更新是否已完成。 */
  isDone: boolean
  collapseWhenResponseAppears: boolean
  toolCall?: DesktopToolCall
  toolCallIds?: string[]
  toolCalls?: ToolCall[]
  summary?: string
  status?: ToolGroupStatus
}

/** 已折叠处理段的展开状态。 */
const collapsedHistoryOpenByKey = ref<Record<string, boolean>>({})

/** 当前会话的渲染消息列表。 */
const messages = computed<ThreadMessage[]>(() => workspaceSession.activeSnapshot?.messages ?? [])

/** 当前会话的工具调用结构列表。 */
const toolCallStructures = computed(() => workspaceSession.activeToolCallStructures)
const toolCallsById = computed(() => workspaceSession.activeToolCallsById)

/** 当前会话的待交付消息队列。 */
const pendingQueue = computed(
  () => workspaceSession.activeSnapshot?.queue ?? { steering: [], followUp: [] }
)

/** 当前会话的 token usage 信息。 */
const tokenUsage = computed<TokenUsage | undefined>(() => {
  const snapshot = workspaceSession.activeSnapshot
  const context = snapshot?.context
  if (!context || !context.contextWindow) {
    return undefined
  }
  return {
    tokens: context.tokens,
    contextWindow: context.contextWindow,
    percent: context.percent,
    autoCompactionEnabled: snapshot?.autoCompactionEnabled ?? false
  }
})

/** 当前会话模型。 */
const activeModel = computed(() => {
  if (workspaceSession.activeSnapshot?.model) {
    return workspaceSession.activeSnapshot.model
  }
  const selected = workspaceSession.orphanModel
  if (selected) {
    return { provider: selected.provider, id: selected.modelId }
  }
  const defaultModel = modelSettings.snapshot?.settings
  if (defaultModel?.defaultProvider && defaultModel.defaultModel) {
    return {
      provider: defaultModel.defaultProvider,
      id: defaultModel.defaultModel
    }
  }
  return undefined
})

/** 当前模型选择器可选项。 */
const modelOptions = computed(() => {
  if (workspaceSession.activeSessionId) {
    return workspaceSession.activeModelOptions
  }
  return modelSettings.models
    .filter((model) => model.status === 'available')
    .map((model) => ({
      provider: model.provider,
      id: model.id,
      displayName: model.displayName
    }))
})

/** 当前模型列表是否加载中。 */
const loadingModelOptions = computed(() =>
  workspaceSession.activeSessionId
    ? workspaceSession.activeModelOptionsLoading
    : modelSettings.loading
)

/** 当前会话 thinking level。 */
const activeThinkingLevel = computed<ThinkingLevel>(() => {
  if (workspaceSession.activeSnapshot?.thinkingLevel) {
    return workspaceSession.activeSnapshot.thinkingLevel
  }
  if (workspaceSession.orphanThinkingLevel) {
    return workspaceSession.orphanThinkingLevel
  }
  return modelSettings.snapshot?.settings.defaultThinkingLevel ?? 'medium'
})

/** 是否隐藏 assistant thinking block。 */
const hideThinkingBlock = computed(() => agentSettings.snapshot?.display.hideThinkingBlock ?? false)

/** 是否存在待交付队列消息。 */
const hasPendingQueue = computed(
  () => pendingQueue.value.steering.length > 0 || pendingQueue.value.followUp.length > 0
)

/** 当前 thread 是否处于运行态。 */
const isThreadRunning = computed(() =>
  ['queued', 'starting', 'running', 'stopping'].includes(
    workspaceSession.activeSession?.status ?? ''
  )
)

/** 当前会话是否正在压缩上下文。 */
const isCompacting = computed(() => Boolean(workspaceSession.activeCompactionState?.running))

/** 当前会话是否正在执行。 */
const isRunning = computed(() => isThreadRunning.value || isCompacting.value)

/** 当前会话 activity 文案。 */
const activityLabel = computed(() =>
  isCompacting.value
    ? '正在压缩上下文'
    : (workspaceSession.activeExtensionWorkingMessage ?? '正在工作')
)

/** extension 是否允许显示工作行。 */
const activityVisible = computed(
  () => isRunning.value && workspaceSession.activeExtensionWorkingVisible !== false
)

/** extension 自定义工作指示器帧。 */
const activityIndicatorFrames = computed(
  () => workspaceSession.activeExtensionWorkingIndicator?.frames
)

/** extension 自定义工作指示器轮播间隔。 */
const activityIndicatorIntervalMs = computed(
  () => workspaceSession.activeExtensionWorkingIndicator?.intervalMs ?? 250
)

/** 自定义工作指示器当前帧索引。 */
const activityIndicatorFrameIndex = ref(0)

/** 是否显示默认工作指示器。 */
const showDefaultActivityIndicator = computed(() => activityIndicatorFrames.value === undefined)

/** 自定义工作指示器文本。 */
const activityIndicatorLabel = computed(() => {
  const frames = activityIndicatorFrames.value
  if (!frames || frames.length === 0) {
    return ''
  }
  return frames[activityIndicatorFrameIndex.value % frames.length] ?? ''
})

/** 当前处理耗时 ticker。 */
const processingNow = ref(Date.now())

/** 当前会话的统一时间线。 */
const timelineItems = computed<TimelineItem[]>(() =>
  createTimelineItems({
    messages: messages.value,
    toolCallStructures: toolCallStructures.value,
    getMessageRenderState,
    resolveTimelineToolCall,
    getToolResultMessageToolCall: resolveToolResultMessageToolCall,
    hideThinkingBlock: hideThinkingBlock.value
  })
)

/** 当前会话内所有 user prompt/steer/follow-up 对应的处理段。 */
const processingCollapseResult = computed<ProcessingCollapseResult>(() =>
  createProcessingCollapseResult({
    items: timelineItems.value,
    isRunning: isRunning.value,
    activeSessionId: workspaceSession.activeSessionId,
    now: processingNow.value
  })
)

/** 当前会话内所有 user prompt/steer/follow-up 对应的处理段。 */
const processingCollapseContexts = computed<ProcessingCollapseContext[]>(
  () => processingCollapseResult.value.contexts
)

/** 最终回复消息的 key 集合，用于标记 isFinalReply。 */
const finalReplyKeys = computed<Set<string>>(() => processingCollapseResult.value.finalReplyKeys)

/** 实际渲染的时间线；运行开始即展示 trigger，最终回复开始后才收起过程项。 */
const displayTimelineItems = computed<TimelineItem[]>(() =>
  createDisplayTimelineItems({
    timelineItems: timelineItems.value,
    contexts: processingCollapseContexts.value,
    isCollapsedHistoryOpen
  })
)

/** 模板直接消费的时间线视图模型，避免 patch 阶段重复调用 item getter。 */
const displayTimelineViewItems = computed<TimelineViewItem[]>((previous) =>
  createStableTimelineViewItems(displayTimelineItems.value, previous)
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
let processingTimerId: number | null = null
let activityIndicatorTimerId: number | null = null

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
  role: ThreadMessage['role']
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
 * 处理拖拽进来的本地图片路径。
 * @param paths - 本地图片路径。
 * @param threadId - 拖拽图片时绑定的 thread ID。
 */
async function handleAddImagePaths(paths: string[], threadId?: string): Promise<void> {
  if (paths.length === 0) {
    return
  }
  imageSelectionError.value = undefined
  selectingImages.value = true
  try {
    const images = await window.api.codingAgent.processPromptImageFiles(paths)
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
 * 处理拖拽进来的本地文件路径。
 * @param files - 本地文件路径附件。
 * @param threadId - 拖拽文件时绑定的 thread ID。
 */
function handleAddFiles(
  files: Array<Omit<ComposerFileAttachment, 'id'>>,
  threadId?: string
): void {
  workspaceSession.addComposerFiles(
    files.map(toComposerFileAttachment),
    workspaceSession.defaultSessionContextId,
    threadId
  )
}

/**
 * 清空当前 Composer 图片附件。
 */
function handleClearImages(): void {
  workspaceSession.clearComposerImages()
  imageSelectionError.value = undefined
}

/**
 * 关闭图片处理错误提示。
 */
function handleDismissImageError(): void {
  imageSelectionError.value = undefined
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
 * 给文件路径附件补充前端稳定 ID。
 * @param file - 文件路径附件。
 * @returns Composer 文件路径附件。
 */
function toComposerFileAttachment(file: Omit<ComposerFileAttachment, 'id'>): ComposerFileAttachment {
  return {
    ...file,
    id: `${file.name}-${file.size}-${crypto.randomUUID()}`
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
function getTimelineItemComponent(item: TimelineItem): TimelineItemComponent {
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
function getTimelineItemMessage(item: TimelineItem): ThreadMessage | undefined {
  return item.type === 'message' || item.type === 'thinking' ? item.message : undefined
}

/**
 * 获取单条消息的渲染状态，避免为整条 timeline 重新包装消息对象。
 * @param message - 原始消息。
 * @returns 渲染状态。
 */
function getMessageRenderState(message: ThreadMessage): MessageRenderState {
  const threadId = workspaceSession.activeSnapshot?.threadId
  return threadId
    ? workspaceSession.getMessageRenderState(threadId, message.id)
    : { revision: 1, renderState: 'complete' }
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
    ? item.renderState === 'streaming'
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
 * 获取 timeline 项工具调用 ID 组。
 * @param item - timeline 项。
 * @returns 工具调用 ID 组。
 */
function getTimelineItemToolCallIds(item: TimelineItem): string[] | undefined {
  return item.type === 'tool-group' ? item.toolCallIds : undefined
}

/**
 * 获取 timeline 项工具调用列表。
 * @param item - timeline 项。
 * @returns 工具调用列表。
 */
function getTimelineItemToolCalls(item: TimelineItem): ToolCall[] | undefined {
  return item.type === 'tool-group' ? item.toolCalls : undefined
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
 * 将 timeline item 转成模板消费的稳定视图模型。
 * @param item - timeline 项。
 * @returns timeline 视图模型。
 */
function toTimelineViewItem(item: TimelineItem): TimelineViewItem {
  const isCollapsedHistory = isCollapsedHistoryItem(item)
  const collapsedOpen = isCollapsedHistory ? isCollapsedHistoryOpen(item) : false
  const isStreaming = getTimelineItemStreaming(item)
  return {
    key: item.key,
    item,
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
    revision: item.type === 'message' || item.type === 'thinking' ? item.revision : 1,
    isStreaming,
    isFinalReply: finalReplyKeys.value.has(item.key),
    isDone: !isStreaming,
    collapseWhenResponseAppears: getTimelineItemCollapseWhenResponseAppears(item),
    toolCall: getTimelineItemToolCall(item),
    toolCallIds: getTimelineItemToolCallIds(item),
    toolCalls: getTimelineItemToolCalls(item),
    summary: getTimelineItemToolGroupSummary(item),
    status: getTimelineItemToolGroupStatus(item)
  }
}

function createStableTimelineViewItems(
  items: TimelineItem[],
  previous: TimelineViewItem[] | undefined
): TimelineViewItem[] {
  let hasChanged = previous?.length !== items.length
  const next: TimelineViewItem[] = []

  for (let index = 0; index < items.length; index += 1) {
    const viewItem = toTimelineViewItem(items[index])
    const previousItem = previous?.[index]
    if (previousItem && isSameTimelineViewItem(previousItem, viewItem)) {
      next.push(previousItem)
    } else {
      hasChanged = true
      next.push(viewItem)
    }
  }

  return hasChanged ? next : (previous ?? next)
}

function isSameTimelineViewItem(left: TimelineViewItem, right: TimelineViewItem): boolean {
  return (
    left.key === right.key &&
    left.item === right.item &&
    left.className === right.className &&
    left.isCollapsedHistory === right.isCollapsedHistory &&
    left.collapsedItem === right.collapsedItem &&
    left.collapsedOpen === right.collapsedOpen &&
    isSameCollapsedIconClass(left.collapsedIconClass, right.collapsedIconClass) &&
    left.component === right.component &&
    left.message === right.message &&
    left.messageId === right.messageId &&
    left.text === right.text &&
    left.revision === right.revision &&
    left.isStreaming === right.isStreaming &&
    left.isFinalReply === right.isFinalReply &&
    left.isDone === right.isDone &&
    left.collapseWhenResponseAppears === right.collapseWhenResponseAppears &&
    left.toolCall === right.toolCall &&
    left.toolCallIds === right.toolCallIds &&
    left.toolCalls === right.toolCalls &&
    left.summary === right.summary &&
    left.status === right.status
  )
}

function isSameCollapsedIconClass(
  left: TimelineViewItem['collapsedIconClass'],
  right: TimelineViewItem['collapsedIconClass']
): boolean {
  if (left === right) {
    return true
  }
  return (
    left?.['is-collapsed'] === right?.['is-collapsed'] &&
    left?.['is-pending'] === right?.['is-pending']
  )
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

async function forkFromMessage(entryId: string): Promise<void> {
  await workspaceSession.forkActiveSession(entryId)
}

function locateMessageInTree(entryId: string): void {
  openPanelTab('tree', { entryId })
}

async function navigateMessageTree(entryId: string): Promise<void> {
  await workspaceSession.navigateActiveSessionTree(entryId)
}

/**
 * 解析 timeline 展示用工具调用。
 * full map 承载 result/status，structure 承载稳定的 timeline 身份；当 full map 中
 * 工具名退化为通用 tool 时，以 structure 的具名工具身份为准。
 * @param toolCallId - 工具调用 ID。
 * @returns timeline 工具调用。
 */
function resolveTimelineToolCall(toolCallId: string): DesktopToolCall | undefined {
  return resolveTimelineToolCallFromState({
    toolCallId,
    toolCallsById: toolCallsById.value,
    toolCallStructures: toolCallStructures.value
  })
}

/**
 * 获取 tool result 消息关联的工具调用投影。
 * @param message - Thread message。
 * @returns 工具调用投影。
 */
function resolveToolResultMessageToolCall(message: ThreadMessage): DesktopToolCall | undefined {
  return getToolResultMessageToolCall(message, toolCallsById.value)
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
 * 用户拖动滚动条时退出自动跟随。
 */
function handleTimelineScrollbarPointerDown(): void {
  holdUserScroll()
}

/**
 * 发送当前 Composer 草稿。
 */
async function sendComposerPrompt(): Promise<void> {
  if (!workspaceSession.activeSessionId) {
    const model = activeModel.value
    if (model) {
      await workspaceSession.setActiveModel(model.provider, model.id)
    }
    await workspaceSession.setActiveThinkingLevel(activeThinkingLevel.value)
  }
  await workspaceSession.sendPrompt(workspaceSession.defaultSessionContextId, runningDelivery.value)
}

/**
 * 设置当前会话模型。
 * @param provider - provider。
 * @param modelId - 模型 ID。
 */
async function handleSelectModel(provider: string, modelId: string): Promise<void> {
  await workspaceSession.setActiveModel(provider, modelId)
}

/**
 * 设置当前会话 thinking level。
 * @param level - thinking level。
 */
async function handleSelectThinkingLevel(level: ThinkingLevel): Promise<void> {
  await workspaceSession.setActiveThinkingLevel(level)
}

async function handleRespondExtensionRequest(
  request: ExtensionUiRequest,
  value?: string | boolean
): Promise<void> {
  const threadId = workspaceSession.activeSessionId
  if (!threadId) {
    return
  }
  if (request.type === 'confirm') {
    await workspaceSession.respondExtensionUi(threadId, {
      id: request.id,
      confirmed: value === true
    })
    return
  }
  if (typeof value !== 'string') {
    return
  }
  await workspaceSession.respondExtensionUi(threadId, {
    id: request.id,
    value
  })
}

async function handleCancelExtensionRequest(request: ExtensionUiRequest): Promise<void> {
  const threadId = workspaceSession.activeSessionId
  if (!threadId) {
    return
  }
  await workspaceSession.respondExtensionUi(threadId, {
    id: request.id,
    cancelled: true
  })
}

/**
 * 处理 extension 全局快捷键。
 * @param event - 键盘事件。
 */
function handleExtensionShortcutKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) {
    return
  }
  const shortcut = toPiShortcutId(event)
  if (!shortcut) {
    return
  }
  void workspaceSession.dispatchExtensionShortcut(shortcut).then((handled) => {
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  })
}

/**
 * 将浏览器 KeyboardEvent 规范成 Pi KeyId。
 * @param event - 键盘事件。
 * @returns KeyId。
 */
function toPiShortcutId(event: KeyboardEvent): string | undefined {
  const key = normalizeShortcutKey(event.key)
  if (!key) {
    return undefined
  }
  const hasModifier = event.shiftKey || event.ctrlKey || event.altKey || event.metaKey
  if (!hasModifier && !isFunctionShortcutKey(key)) {
    return undefined
  }
  const modifiers: string[] = []
  if (event.shiftKey) modifiers.push('shift')
  if (event.ctrlKey) modifiers.push('ctrl')
  if (event.altKey) modifiers.push('alt')
  if (event.metaKey) modifiers.push('meta')
  return [...modifiers, key].join('+')
}

/**
 * 标准化 KeyboardEvent.key。
 * @param key - 浏览器 key。
 * @returns Pi shortcut key。
 */
function normalizeShortcutKey(key: string): string | undefined {
  if (!key || ['Shift', 'Control', 'Alt', 'Meta'].includes(key)) {
    return undefined
  }
  const aliases: Record<string, string> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    Escape: 'escape',
    ' ': 'space'
  }
  return aliases[key] ?? key.toLowerCase()
}

/**
 * 判断无修饰键时是否仍可作为全局快捷键。
 * @param key - 标准化 key。
 * @returns 是否为功能键。
 */
function isFunctionShortcutKey(key: string): boolean {
  return /^f\d{1,2}$/.test(key)
}

watch(
  () => workspaceSession.activeSessionId,
  (threadId) => {
    if (threadId) {
      void workspaceSession.loadModelOptions(threadId)
    }
  },
  { immediate: true }
)

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

watch(
  [activityIndicatorFrames, activityIndicatorIntervalMs, activityVisible],
  ([frames, intervalMs, visible]) => {
    activityIndicatorFrameIndex.value = 0
    if (activityIndicatorTimerId !== null) {
      window.clearInterval(activityIndicatorTimerId)
      activityIndicatorTimerId = null
    }
    if (!visible || !frames || frames.length <= 1) {
      return
    }
    activityIndicatorTimerId = window.setInterval(() => {
      activityIndicatorFrameIndex.value = (activityIndicatorFrameIndex.value + 1) % frames.length
    }, Math.max(50, intervalMs))
  },
  { immediate: true }
)

useResizeObserver(timelineInnerRef, keepBottomInCurrentFrame)

onMounted(async () => {
  window.addEventListener('keydown', handleExtensionShortcutKeyDown, { capture: true })
  initialSettingsLoadSchedule = scheduleInitialSettingsLoad(agentSettings, modelSettings)
  await nextTick()
  scheduleScrollToLatest('auto')
  updateScrollState()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleExtensionShortcutKeyDown, { capture: true })
  initialSettingsLoadSchedule?.cancel()
  initialSettingsLoadSchedule = undefined
  if (scrollRafId !== null) {
    cancelAnimationFrame(scrollRafId)
  }
  if (followBottomRafId !== null) {
    cancelAnimationFrame(followBottomRafId)
  }
  if (processingTimerId !== null) {
    window.clearInterval(processingTimerId)
  }
  if (activityIndicatorTimerId !== null) {
    window.clearInterval(activityIndicatorTimerId)
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
    return [
      item.groupKind,
      item.summary,
      getTimelineItemToolGroupStatus(item),
      ...item.toolCalls.flatMap((toolCall) => [
        toolCall.toolCallId,
        toolCall.toolName,
        toolCall.args
      ])
    ]
  }
  return [
    item.toolCall.toolCallId,
    item.toolCall.toolName,
    item.toolCall.args,
    item.toolCall.startedAt,
    item.toolCall.finishedAt
  ]
}

/** 获取工具调用渲染依赖。 */
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
      :vertical-offset="4"
      :vertical-size="7"
      @scroll="updateScrollState"
      @scrollbar-pointer-down="handleTimelineScrollbarPointerDown"
      @wheel.passive="handleTimelineWheel"
    >
      <div ref="timelineInnerRef" class="chat-view__timeline-inner" :style="timelineStyle">
        <div
          v-for="viewItem in displayTimelineViewItems"
          :key="viewItem.key"
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
            :revision="viewItem.revision"
            :is-streaming="viewItem.isStreaming"
            :is-final-reply="viewItem.isFinalReply"
            :is-done="viewItem.isDone"
            :collapse-when-response-appears="viewItem.collapseWhenResponseAppears"
            :hidden-label="workspaceSession.activeExtensionHiddenThinkingLabel"
            :tool-call="viewItem.toolCall"
            :tool-call-ids="viewItem.toolCallIds"
            :tool-calls="viewItem.toolCalls"
            :default-open="workspaceSession.activeExtensionToolsExpanded"
            :summary="viewItem.summary"
            :status="viewItem.status"
            @fork-from-message="forkFromMessage"
            @locate-in-tree="locateMessageInTree"
            @navigate-tree="navigateMessageTree"
          />
        </div>

        <div v-if="activityVisible" class="chat-view__activity" aria-live="polite">
          <span v-if="showDefaultActivityIndicator" class="chat-view__activity-dot" />
          <span v-else-if="activityIndicatorLabel" class="chat-view__activity-indicator">
            {{ activityIndicatorLabel }}
          </span>
          <span>
            {{ activityLabel }}
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
        :submitting="workspaceSession.isSendingPrompt"
        :thread-id="workspaceSession.activeSessionId"
        :project-id="workspaceSession.activeProjectId"
        :projects="workspaceProject.projectList"
        :images="workspaceSession.draftImages"
        :files="workspaceSession.draftFiles"
        :image-error="imageSelectionError"
        :selecting-images="selectingImages"
        :usage="tokenUsage"
        :current-model="activeModel"
        :model-options="modelOptions"
        :loading-model-options="loadingModelOptions"
        :commands="workspaceSession.activeCommands"
        :loading-commands="workspaceSession.activeCommandsLoading"
        :extension-widgets="workspaceSession.activeExtensionWidgets"
        :extension-requests="workspaceSession.activeExtensionUiRequests"
        :model-select-disabled="
          isRunning || (!workspaceSession.activeSessionId && !workspaceSession.activeProjectId)
        "
        :current-thinking-level="activeThinkingLevel"
        :thinking-select-disabled="
          isRunning || (!workspaceSession.activeSessionId && !workspaceSession.activeProjectId)
        "
        placeholder="描述你想让 Agent 完成的事"
        @submit="sendComposerPrompt"
        @select-model="handleSelectModel"
        @select-thinking-level="handleSelectThinkingLevel"
        @select-project="workspaceSession.startNewSession"
        @select-images="handleSelectImages"
        @paste-images="handlePasteImages"
        @add-image-paths="handleAddImagePaths"
        @add-files="handleAddFiles"
        @remove-image="workspaceSession.removeComposerImage"
        @remove-file="workspaceSession.removeComposerFile"
        @clear-images="handleClearImages"
        @dismiss-image-error="handleDismissImageError"
        @load-commands="workspaceSession.loadCommands()"
        @run-command="workspaceSession.runCommand"
        @text-change="workspaceSession.syncActiveEditorText"
        @respond-extension-request="handleRespondExtensionRequest"
        @cancel-extension-request="handleCancelExtensionRequest"
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
  gap: var(--space-3);
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
  border-bottom: 1px solid var(--chat-history-border-muted);
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
      border-color: var(--chat-history-border-muted);
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
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  align-self: flex-start;
  padding: var(--space-1) 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui);

  .chat-view__activity-dot {
    width: 8px;
    height: 8px;
    background: var(--color-primary);
    border-radius: 50%;
    animation: pulse 1.1s var(--ease-standard) infinite;
  }

  .chat-view__activity-indicator {
    min-width: 1ch;
    color: var(--color-primary);
    font-family: var(--font-mono) !important;
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
