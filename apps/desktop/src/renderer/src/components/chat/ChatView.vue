<script setup lang="ts">
/**
 * ChatView.vue - 当前活跃会话的消息流与输入区组件。
 */

import type { ComponentPublicInstance, CSSProperties } from 'vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { Message } from '@ag-ui/core'
import type { JSONContent } from '@tiptap/vue-3'
import { useElementSize, useResizeObserver } from '@vueuse/core'
import { useVirtualizer, type VirtualItem } from '@tanstack/vue-virtual'
import { ChevronDown, CornerDownRight, ListEnd, MapPin, Undo2, X } from 'lucide-vue-next'
import Composer from './composer/Composer.vue'
import ExtensionDialogHost from './ExtensionDialogHost.vue'
import AssistantMessage from './messages/AssistantMessage.vue'
import CompactionDivider from './messages/CompactionDivider.vue'
import ThinkingMessage from './messages/ThinkingMessage.vue'
import SystemMessage from './messages/SystemMessage.vue'
import ToolMessage from './messages/ToolMessage.vue'
import UserMessage from './messages/UserMessage.vue'
import ToolGroup from './messages/tools/ToolGroup.vue'
import type { ToolCall, ToolGroupStatus } from './messages/tools/support/tool-group'
import { getQueuedUserPromptDisplayText } from './messages/support/message-format'
import {
  scheduleInitialSettingsLoad,
  type InitialSettingsLoadSchedule
} from './settings/initialSettingsLoad'
import useAgentSettingsStore from '@renderer/stores/agent-settings'
import useModelSettingsStore from '@renderer/stores/model-settings'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import { createComposerContentFromText } from '@renderer/stores/workspace-session-composer'
import { isComposerEditorRequest } from '@renderer/stores/workspace-session-extension'
import useWorkspaceProjectStore from '@renderer/stores/workspace-project'
import { useSessionContext } from '@renderer/composables/useSessionContext'
import { useAppearanceSettings } from '@renderer/composables/useAppearanceSettings'
import type { DesktopToolCall } from '@coding-agent-desktop-src/protocol/tool'
import ScrollArea from '../ui/scroll-area/ScrollArea.vue'
import BaseIconButton from '@/components/base/BaseIconButton.vue'
import type {
  ComposerFileAttachment,
  ComposerImageAttachment,
  ComposerQuoteAttachment,
  MessageRenderState
} from '@renderer/stores/workspace-session'
import {
  createDisplayTimelineItems,
  createProcessingCollapseResult,
  createTimelineProjectionCache,
  getTimelineChangedStartIndex,
  getTimelineItemRevision as getBaseTimelineItemRevision,
  getTimelineItemToolGroupStatus,
  getToolResultMessageToolCall,
  isCollapsedHistoryItem,
  projectTimelineItems,
  resolveTimelineToolCall as resolveTimelineToolCallFromState,
  stabilizeTimelineItems,
  type CollapsedHistoryTimelineItem,
  type ProcessingCollapseContext,
  type ProcessingCollapseResult,
  type TimelineItem
} from './timeline/chatTimelineDisplay'
import type {
  PromptImageAttachment,
  PromptImageDraft,
  PromptQuoteContext,
  ThinkingLevel
} from '@shared/coding-agent/types'
import type { TokenUsage } from './composer/Usage.vue'
import {
  ensureChatTimelineOpenState,
  type ChatTimelineOpenStateBySession
} from './timeline/chatTimelineOpenState'
import {
  CHAT_TIMELINE_OVERSCAN,
  createVirtualTimelineRows,
  estimateTimelineItemSize,
  findDirectTimelineRow,
  getChatTimelineGap,
  getVirtualTimelineRowOffset,
  prepareTimelineVirtualizerForSession,
  resolveTimelineFollowState
} from './timeline/chatTimelineVirtualization'
import { isWorkspaceRouteName } from '@renderer/router/workspace-route-host'

const workspaceSession = useWorkspaceSessionStore()
const route = useRoute()
const appearanceSettings = useAppearanceSettings()
const { openPanelTab } = useSessionContext()
const workspaceProject = useWorkspaceProjectStore()
const agentSettings = useAgentSettingsStore()
const modelSettings = useModelSettingsStore()
const chatAppearanceStyle = computed<CSSProperties>(() => {
  if (appearanceSettings.markdownFontStyle.value !== 'custom') return {}
  return {
    '--markdown-body-font': appearanceSettings.customMarkdownFontFamily.value || 'var(--font-sans)'
  } as CSSProperties
})
const defaultToolOpen = computed(() => {
  if (appearanceSettings.toolExpansion.value === 'expanded') return true
  if (appearanceSettings.toolExpansion.value === 'collapsed') return false
  return workspaceSession.activeExtensionToolsExpanded
})
let initialSettingsLoadSchedule: InitialSettingsLoadSchedule | undefined

const SESSION_ACTION_AUTO_DISMISS_MS = 5000
const SESSION_NOTIFICATION_AUTO_DISMISS_MS = 5000
const sessionNotificationTimeouts = new Map<string, number>()

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
  | typeof ToolGroup
  | typeof CompactionDivider
type TimelineViewItem = {
  key: string
  item: TimelineItem
  className: string
  isCollapsedHistory: boolean
  collapsedItem?: CollapsedHistoryTimelineItem
  component?: TimelineItemComponent
  message?: Message
  messageId: string
  text?: string
  revision: number
  isStreaming: boolean
  /** 消息更新是否已完成。 */
  isDone: boolean
  collapseWhenResponseAppears: boolean
  toolCall?: DesktopToolCall
  toolCallIds?: string[]
  toolCalls?: ToolCall[]
  summary?: string
  status?: ToolGroupStatus
  avatarLane?: 'user' | 'assistant'
  avatarKind?: 'user' | 'assistant'
}

/** 时间线交互展开状态按 session 隔离，切换回来时恢复原有布局。 */
const timelineOpenStateBySession = ref<ChatTimelineOpenStateBySession>({})
const activeTimelineOpenState = computed(() =>
  ensureChatTimelineOpenState(
    timelineOpenStateBySession.value,
    workspaceSession.activeSessionId,
    workspaceSession.activeSnapshot?.sessionFile ?? workspaceSession.activeSession?.sessionFile
  )
)

/** 已折叠处理段的展开状态。 */
const collapsedHistoryOpenByKey = computed(() => activeTimelineOpenState.value.collapsedHistory)

/** Thinking 展开状态，按稳定 timeline key 保存。 */
const thinkingOpenByKey = computed(() => activeTimelineOpenState.value.thinking)

/** 工具组展开状态，按稳定 timeline key 保存。 */
const toolGroupOpenByKey = computed(() => activeTimelineOpenState.value.toolGroup)

/** 单个工具展开状态，按稳定 toolCallId 保存。 */
const toolOpenByKey = computed(() => activeTimelineOpenState.value.tool)

/** 当前页面直接消费 main-owned AG-UI session message feed。 */
const messages = computed<Message[]>(() => workspaceSession.activeSessionMessages)

/** 当前会话的工具调用结构列表。 */
const toolCallStructures = computed(() => workspaceSession.activeToolCallStructures)
const toolCallsById = computed(() => workspaceSession.activeToolCallsById)
const runtimeTimelineEvents = computed(() => workspaceSession.activeRuntimeTimelineEvents)
const activeMessageRenderStates = computed(() => {
  const threadId = workspaceSession.activeSnapshot?.threadId
  return threadId ? workspaceSession.runtimeByThreadId[threadId]?.renderState : undefined
})

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
    autoCompactionEnabled: snapshot?.autoCompactionEnabled
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
const hideThinkingBlock = computed(() => agentSettings.snapshot?.display.hideThinkingBlock ?? true)

/** Composer session actions 中可展示的引导消息。 */
const pendingSteeringPrompts = computed(() =>
  pendingQueue.value.steering
    .map(getQueuedUserPromptDisplayText)
    .filter((message): message is string => Boolean(message))
)

/** Composer session actions 中可展示的后续消息。 */
const pendingFollowUpPrompts = computed(() =>
  pendingQueue.value.followUp
    .map(getQueuedUserPromptDisplayText)
    .filter((message): message is string => Boolean(message))
)

/** Composer session actions 中是否存在用户 prompt。 */
const hasVisiblePendingQueue = computed(
  () => pendingSteeringPrompts.value.length > 0 || pendingFollowUpPrompts.value.length > 0
)

/** 当前 thread 是否处于运行态。 */
const isThreadRunning = computed(() => {
  const threadId = workspaceSession.activeSessionId
  // 直接依赖 sessions[threadId]，避免 activeSession 旧对象引用让 running 状态回退失效。
  return ['queued', 'starting', 'running', 'stopping'].includes(
    threadId ? (workspaceSession.sessions[threadId]?.status ?? '') : ''
  )
})

/** 当前会话是否正在压缩上下文。 */
const isCompacting = computed(() => Boolean(workspaceSession.activeCompactionState?.running))

/** 当前会话是否正在执行。 */
const isRunning = computed(() => isThreadRunning.value || isCompacting.value)

/** 当前会话 activity 文案。 */
const activityLabel = computed(() => {
  if (appearanceSettings.customActivityText.value) {
    return appearanceSettings.customActivityText.value
  }
  return isCompacting.value
    ? '正在压缩上下文'
    : (workspaceSession.activeExtensionWorkingMessage ?? '正在工作')
})

/** extension 是否允许显示工作行。 */
const activityVisible = computed(
  () =>
    appearanceSettings.activityDisplay.value !== 'hidden' &&
    isRunning.value &&
    workspaceSession.activeExtensionWorkingVisible !== false
)
const activityIndicatorVisible = computed(
  () => activityVisible.value && appearanceSettings.activityIndicatorStyle.value !== 'hidden'
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

const timelineProjectionCache = createTimelineProjectionCache()

/** 当前会话的统一时间线。 */
const timelineItems = computed<TimelineItem[]>((previous) =>
  projectTimelineItems(
    {
      messages: messages.value,
      toolCallStructures: toolCallStructures.value,
      runtimeEvents: runtimeTimelineEvents.value,
      getMessageRenderState,
      resolveTimelineToolCall,
      getToolResultMessageToolCall: resolveToolResultMessageToolCall,
      hideThinkingBlock: hideThinkingBlock.value
    },
    previous,
    timelineProjectionCache
  )
)

/** 当前会话内所有 user prompt/steer/follow-up 对应的处理段。 */
const processingCollapseResult = computed<ProcessingCollapseResult>((previous) =>
  createProcessingCollapseResult(
    {
      items: timelineItems.value,
      isRunning: isRunning.value,
      activeSessionId: workspaceSession.activeSessionId,
      now: processingNow.value
    },
    previous
  )
)

/** 当前会话内所有 user prompt/steer/follow-up 对应的处理段。 */
const processingCollapseContexts = computed<ProcessingCollapseContext[]>(
  () => processingCollapseResult.value.contexts
)

/** 最终回复消息的 key 集合，用于标记 isFinalReply。 */
const finalReplyKeys = computed<Set<string>>(() => processingCollapseResult.value.finalReplyKeys)

/** 实际渲染的时间线；运行开始即展示 trigger，最终回复开始后才收起过程项。 */
const displayTimelineItems = computed<TimelineItem[]>((previous) =>
  stabilizeTimelineItems(
    createDisplayTimelineItems({
      timelineItems: timelineItems.value,
      contexts: processingCollapseContexts.value,
      isCollapsedHistoryOpen
    }),
    previous
  )
)

/** 模板直接消费的时间线视图模型，避免 patch 阶段重复调用 item getter。 */
const displayTimelineViewItems = computed<TimelineViewItem[]>((previous) =>
  createStableTimelineViewItems(displayTimelineItems.value, previous)
)

watch(processingCollapseContexts, (contexts) => {
  for (const key of Object.keys(collapsedHistoryOpenByKey.value)) {
    if (!contexts.some((context) => `collapsed-history:${context.key}` === key)) {
      delete collapsedHistoryOpenByKey.value[key]
    }
  }
})

watch(timelineItems, (items) => {
  for (const key of Object.keys(thinkingOpenByKey.value)) {
    if (!items.some((item) => item.type === 'thinking' && item.key === key)) {
      delete thinkingOpenByKey.value[key]
    }
  }

  for (const key of Object.keys(toolGroupOpenByKey.value)) {
    if (!items.some((item) => item.type === 'tool-group' && item.key === key)) {
      delete toolGroupOpenByKey.value[key]
    }
  }

  for (const toolCallId of Object.keys(toolOpenByKey.value)) {
    if (!items.some((item) => getTimelineItemToolCallIdsForOpenState(item).includes(toolCallId))) {
      delete toolOpenByKey.value[toolCallId]
    }
  }
})

/** 消息滚动容器。 */
const timelineRef = ref<ScrollAreaInstance | null>(null)
const timelineListRef = ref<HTMLElement | null>(null)
const timelineWindowRef = ref<HTMLElement | null>(null)
const isNearBottom = ref(true)
const shouldFollowBottom = ref(true)
const timelineGap = computed(() => getChatTimelineGap(appearanceSettings.density.value))
const timelineScrollMargin = ref(0)

function syncTimelineScrollMargin(): void {
  timelineScrollMargin.value = timelineListRef.value?.offsetTop ?? 0
}

function getTimelineScrollElement(): HTMLElement | null {
  return timelineRef.value?.getViewport() ?? null
}

function getTimelineVirtualItemKey(index: number): string {
  const itemKey = displayTimelineViewItems.value[index]?.key ?? index
  return `${workspaceSession.activeSessionId ?? 'draft'}:${itemKey}`
}

function estimateTimelineVirtualItemSize(index: number): number {
  return estimateTimelineItemSize(displayTimelineViewItems.value[index]?.item)
}

const timelineVirtualizer = useVirtualizer(
  computed(() => ({
    count: displayTimelineViewItems.value.length,
    getScrollElement: getTimelineScrollElement,
    getItemKey: getTimelineVirtualItemKey,
    estimateSize: estimateTimelineVirtualItemSize,
    gap: timelineGap.value,
    overscan: CHAT_TIMELINE_OVERSCAN,
    scrollMargin: timelineScrollMargin.value,
    scrollEndThreshold: NEAR_BOTTOM_DISTANCE,
    anchorTo: shouldFollowBottom.value ? ('end' as const) : ('start' as const),
    followOnAppend: shouldFollowBottom.value ? ('auto' as const) : false
  }))
)
const virtualTimelineItems = computed(() => timelineVirtualizer.value.getVirtualItems())
const virtualTimelineTotalSize = computed(() => timelineVirtualizer.value.getTotalSize())
const virtualTimelineRows = computed(() =>
  createVirtualTimelineRows(virtualTimelineItems.value, displayTimelineViewItems.value)
)
const timelineListStyle = computed<CSSProperties>(() => ({
  height: `${virtualTimelineTotalSize.value}px`
}))
function getTimelineVirtualItemStyle(virtualItem: VirtualItem): CSSProperties {
  return {
    transform: `translateY(${getVirtualTimelineRowOffset(
      virtualItem,
      timelineVirtualizer.value.options.scrollMargin
    )}px)`
  }
}

function measureTimelineItem(refValue: Element | ComponentPublicInstance | null): void {
  const element = refValue instanceof Element ? refValue : refValue?.$el
  if (element instanceof Element) {
    timelineVirtualizer.value.measureElement(element)
  }
}

function handleTimelineItemHeightChange(index: number): void {
  const row = findDirectTimelineRow(timelineWindowRef.value, index)
  if (!row) {
    return
  }
  timelineVirtualizer.value.measureElement(row)
  if (!shouldFollowBottom.value) {
    return
  }
  void nextTick(() => {
    if (!shouldFollowBottom.value) {
      return
    }
    scrollToLatest('auto')
  })
}

/** 底部输入区容器。 */
const composerRef = ref<HTMLElement | null>(null)
const { height: composerHeight } = useElementSize(composerRef, undefined, { box: 'border-box' })

/** 给滚动区域预留 absolute 输入区高度。 */
const timelineStyle = computed<CSSProperties>(() => ({
  paddingBottom: `${Math.ceil(composerHeight.value) + 32}px`
}))

const sessionNotificationsRef = ref<HTMLElement | null>(null)
const { height: sessionNotificationsHeight } = useElementSize(sessionNotificationsRef, undefined, {
  box: 'border-box'
})

const jumpBtnStyle = computed<CSSProperties>(() => ({
  bottom: `${
    Math.ceil(composerHeight.value) + Math.max(24, Math.ceil(sessionNotificationsHeight.value) + 20)
  }px`
}))

const imageSelectionError = ref<string>()
const selectingImages = ref(false)
let processingTimerId: number | null = null
let activityIndicatorTimerId: number | null = null

/** Editor request 使用独立草稿，避免覆盖普通 Composer 内容。 */
const composerEditorRequest = computed(() =>
  isComposerEditorRequest(workspaceSession.activeExtensionDialog)
    ? workspaceSession.activeExtensionDialog
    : undefined
)
const extensionComposerDraft = ref<JSONContent>(createComposerContentFromText(''))
const extensionComposerText = ref('')

watch(
  () => composerEditorRequest.value?.id,
  () => {
    const request = composerEditorRequest.value
    const draft = request
      ? (workspaceSession.activeExtensionDialogDrafts[request.id] ??
        (request.type === 'editor' ? request.prefill : '') ??
        '')
      : ''
    extensionComposerDraft.value = createComposerContentFromText(draft)
    extensionComposerText.value = draft
  },
  { immediate: true }
)

const activeComposerDraft = computed<JSONContent>({
  get: () =>
    composerEditorRequest.value ? extensionComposerDraft.value : workspaceSession.draftMessage,
  set: (value) => {
    if (composerEditorRequest.value) extensionComposerDraft.value = value
    else workspaceSession.draftMessage = value
  }
})

// ---------------------------------------------------------------------------
// 俏皮话 Placeholder 轮换
// ---------------------------------------------------------------------------

/** 不同状态下展示的 Composer placeholder 文案组。 */
const PLACEHOLDER_GROUPS: Record<string, string[]> = {
  noProject: [
    '选个项目，咱们开始搞事？',
    '先挑个项目吧，不然我帮你写空气？',
    '项目选好了吗？我等不及要大展身手了',
    '选个项目，让我看看你的野心有多大',
    '没项目怎么干活？点上面选一个'
  ],
  newSession: [
    '新会话已就绪，请下达指令',
    '说吧，这次又想折腾什么？',
    '又开了个新坑？我喜欢',
    '来吧，空白的画布交给你了',
    '新的一轮，你想创造什么？',
    '请开始你的表演'
  ],
  idle: [
    '我就在这里，不躲不藏，稳稳的接住你',
    '又卡在哪了？放马过来',
    '有什么尽管问，我扛得住',
    '说吧，这次想让我帮你写啥',
    '别愣着，有问题尽管砸过来',
    '又遇到 bug 了？来吧',
    '代码写得不错？让我康康',
    '来，把你的难题甩给我',
    '放心问，我代码写得比情书还认真',
    '别客气，尽管使唤',
    '又来了？我喜欢你的求知欲',
    '有 bug 就有我吧，正常'
  ],
  running: [
    '先打着，我听着呢',
    '你说你的，我干我的，不耽误',
    '在想呢，你可以先打着',
    '有话先说着，我忙完就来',
    '排队有效，尽管输入',
    '我先忙，你先说，两不误',
    '你可以继续打，我一会儿看',
    '别停，你的消息我排队处理'
  ]
}

/** 当前应该使用哪组 placeholder。 */
const placeholderGroup = computed<string | null>(() => {
  if (composerEditorRequest.value) return null
  if (!workspaceSession.activeProjectId) return 'noProject'
  if (!workspaceSession.activeSessionId) return 'newSession'
  if (isRunning.value) return 'running'
  return 'idle'
})

/** 当前组内取第几个文案。每次状态切换随机重选。 */
const placeholderIndex = ref(0)

/** 最终 computed placeholder，状态切换时自动轮换。 */
const composerPlaceholder = computed(() => {
  const group = placeholderGroup.value
  if (!group) return ''
  const texts = PLACEHOLDER_GROUPS[group]
  return texts[placeholderIndex.value % texts.length] ?? texts[0]
})

watch(placeholderGroup, (group, prevGroup) => {
  if (!group || group === prevGroup) return
  const texts = PLACEHOLDER_GROUPS[group]
  placeholderIndex.value = Math.floor(Math.random() * texts.length)
})

/** 是否允许发送消息或提交扩展 editor request。 */
const canSend = computed(() =>
  composerEditorRequest.value
    ? true
    : Boolean(workspaceSession.activeProjectId && workspaceSession.hasDraftMessage)
)

function handleComposerTextChange(value: string): void {
  const request = composerEditorRequest.value
  if (request) {
    extensionComposerText.value = value
    workspaceSession.setExtensionDialogDraft(request, value)
  } else {
    workspaceSession.syncActiveEditorText(value)
  }
}

async function submitExtensionComposer(): Promise<void> {
  const request = composerEditorRequest.value
  if (!request) return
  await workspaceSession.respondExtensionDialog(request, extensionComposerText.value)
}

function submitActiveComposer(): void {
  if (composerEditorRequest.value) void submitExtensionComposer()
  else void sendComposerPrompt()
}

function exitExtensionComposer(): void {
  const request = composerEditorRequest.value
  if (request) void workspaceSession.cancelExtensionDialog(request)
}

/**
 * 获取消息 role 对应组件。
 * @param role - 消息角色。
 * @returns Vue component。
 */
function getMessageComponent(
  role: Message['role']
): typeof UserMessage | typeof AssistantMessage | typeof SystemMessage | typeof ToolMessage {
  switch (role) {
    case 'user':
      return UserMessage
    case 'assistant':
      return AssistantMessage
    case 'tool':
      return ToolMessage
    default:
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
 * 处理拖拽进来的本地图片文件。
 * @param files - 由 preload 解析可信路径的 File 对象。
 * @param threadId - 拖拽图片时绑定的 thread ID。
 */
async function handleAddImageFiles(files: File[], threadId?: string): Promise<void> {
  if (files.length === 0) {
    return
  }
  imageSelectionError.value = undefined
  selectingImages.value = true
  try {
    const images = await window.api.codingAgent.processPromptImageFiles(files)
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
function handleAddFiles(files: Array<Omit<ComposerFileAttachment, 'id'>>, threadId?: string): void {
  workspaceSession.addComposerFiles(
    files.map(toComposerFileAttachment),
    workspaceSession.defaultSessionContextId,
    threadId
  )
}

/** 将 assistant 选中文本添加为 Composer 引用。 */
function handleQuoteSelection(quote: PromptQuoteContext): void {
  const attachment: ComposerQuoteAttachment = {
    ...quote,
    id: `quote-${crypto.randomUUID()}`
  }
  workspaceSession.addComposerQuote(attachment)
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
function toComposerFileAttachment(
  file: Omit<ComposerFileAttachment, 'id'>
): ComposerFileAttachment {
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
    return ToolGroup
  }
  if (item.type === 'tool') {
    return ToolMessage
  }
  if (item.type === 'runtime-event') {
    return SystemMessage
  }
  if (item.type === 'compaction-divider') {
    return CompactionDivider
  }
  return getMessageComponent(item.message.role)
}

/**
 * 获取 timeline 项布局 class 后缀。
 * @param item - timeline 项。
 * @returns class 后缀。
 */
function getTimelineItemAvatarLane(item: TimelineItem | undefined): TimelineViewItem['avatarLane'] {
  if (!item) {
    return undefined
  }
  if (item.type === 'thinking' || item.type === 'tool' || item.type === 'tool-group') {
    return 'assistant'
  }
  if (item.type !== 'message') {
    return undefined
  }
  if (item.message.role === 'user') {
    return 'user'
  }
  return item.message.role === 'assistant' || item.message.role === 'tool' ? 'assistant' : undefined
}

function getTimelineItemClassSuffix(item: TimelineItem): string {
  if (item.type === 'collapsed-history') {
    return 'collapsed-history'
  }
  if (item.type === 'message') {
    return item.message.role
  }
  if (item.type === 'runtime-event') {
    return 'system'
  }
  return item.type
}

/**
 * 获取 timeline 项消息。
 * @param item - timeline 项。
 * @returns 消息。
 */
function getTimelineItemMessage(item: TimelineItem): Message | undefined {
  return item.type === 'message' ||
    item.type === 'thinking' ||
    item.type === 'compaction-divider' ||
    item.type === 'runtime-event'
    ? item.message
    : undefined
}

/**
 * 获取单条消息的渲染状态，避免为整条 timeline 重新包装消息对象。
 * @param message - 原始消息。
 * @returns 渲染状态。
 */
function getMessageRenderState(message: Message): MessageRenderState {
  return (
    activeMessageRenderStates.value?.[message.id] ?? {
      revision: 1,
      renderState: 'complete'
    }
  )
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
 * 获取 Thinking 展开状态；未手动操作时，流式阶段默认展开。
 * @param item - timeline 项。
 * @returns 是否展开。
 */
function getTimelineItemThinkingOpen(item: TimelineItem): boolean | undefined {
  if (item.type !== 'thinking') {
    return undefined
  }
  return thinkingOpenByKey.value[item.key] ?? item.renderState === 'streaming'
}

function getTimelineItemOpen(item: TimelineItem): boolean | undefined {
  return item.type === 'thinking'
    ? getTimelineItemThinkingOpen(item)
    : getTimelineItemToolOpen(item)
}

/**
 * 获取工具组展开状态。
 * @param item - timeline 项。
 * @returns 是否展开。
 */
function getTimelineItemToolGroupOpen(item: TimelineItem): boolean | undefined {
  if (item.type !== 'tool-group') {
    return undefined
  }
  return toolGroupOpenByKey.value[item.key] ?? defaultToolOpen.value
}

/**
 * 获取单个工具展开状态。
 * @param item - timeline 项。
 * @returns 是否展开。
 */
function getTimelineItemToolOpen(item: TimelineItem): boolean | undefined {
  const toolCall = getTimelineItemToolCall(item)
  if (!toolCall) {
    return undefined
  }
  return toolOpenByKey.value[toolCall.toolCallId] ?? defaultToolOpen.value
}

function getTimelineItemToolCallIdsForOpenState(item: TimelineItem): string[] {
  if (item.type === 'tool-group') {
    return item.toolCallIds
  }
  const toolCall = getTimelineItemToolCall(item)
  return toolCall ? [toolCall.toolCallId] : []
}

/**
 * 只让 open 状态实际变化的虚拟行失效，避免任一工具切换时 patch 整个窗口。
 */
function getTimelineItemOpenMemoKey(item: TimelineItem): string | undefined {
  if (item.type === 'thinking') {
    return `thinking:${getTimelineItemThinkingOpen(item)}`
  }
  if (item.type === 'tool-group') {
    const toolStates = item.toolCallIds
      .map(
        (toolCallId) => `${toolCallId}:${toolOpenByKey.value[toolCallId] ?? defaultToolOpen.value}`
      )
      .join('|')
    return `group:${getTimelineItemToolGroupOpen(item)}:${toolStates}`
  }
  const toolCall = getTimelineItemToolCall(item)
  return toolCall
    ? `tool:${toolOpenByKey.value[toolCall.toolCallId] ?? defaultToolOpen.value}`
    : undefined
}

/**
 * 将 timeline item 转成模板消费的稳定视图模型。
 * @param item - timeline 项。
 * @returns timeline 视图模型。
 */
function toTimelineViewItem(
  item: TimelineItem,
  previousItem: TimelineItem | undefined
): TimelineViewItem {
  const isCollapsedHistory = isCollapsedHistoryItem(item)
  const isStreaming = getTimelineItemStreaming(item)
  const avatarLane = getTimelineItemAvatarLane(item)
  const avatarKind =
    avatarLane && avatarLane !== getTimelineItemAvatarLane(previousItem) ? avatarLane : undefined
  return {
    key: item.key,
    item,
    className: `chat-view__message--${getTimelineItemClassSuffix(item)}`,
    isCollapsedHistory,
    collapsedItem: isCollapsedHistory ? item : undefined,
    component: isCollapsedHistory ? undefined : getTimelineItemComponent(item),
    message: getTimelineItemMessage(item),
    messageId: getTimelineItemMessageId(item),
    text: getTimelineItemText(item),
    revision: item.type === 'message' || item.type === 'thinking' ? item.revision : 1,
    isStreaming,
    isDone: !isStreaming,
    collapseWhenResponseAppears: getTimelineItemCollapseWhenResponseAppears(item),
    toolCall: getTimelineItemToolCall(item),
    toolCallIds: getTimelineItemToolCallIds(item),
    toolCalls: getTimelineItemToolCalls(item),
    summary: getTimelineItemToolGroupSummary(item),
    status: getTimelineItemToolGroupStatus(item),
    avatarLane,
    avatarKind
  }
}

function createStableTimelineViewItems(
  items: TimelineItem[],
  previous: TimelineViewItem[] | undefined
): TimelineViewItem[] {
  const changedStartIndex = previous
    ? Math.min(getTimelineChangedStartIndex(items), previous.length, items.length)
    : 0
  const next = previous?.slice(0, changedStartIndex) ?? []

  for (let index = changedStartIndex; index < items.length; index += 1) {
    const item = items[index]
    if (!item) {
      continue
    }
    const previousItem = previous?.[index]
    const precedingTimelineItem = items[index - 1]
    const avatarLane = getTimelineItemAvatarLane(item)
    const avatarKind =
      avatarLane && avatarLane !== getTimelineItemAvatarLane(precedingTimelineItem)
        ? avatarLane
        : undefined
    const canReuse =
      previousItem?.item === item &&
      previousItem.avatarLane === avatarLane &&
      previousItem.avatarKind === avatarKind
    next.push(canReuse ? previousItem : toTimelineViewItem(item, precedingTimelineItem))
  }

  return next
}

/**
 * 切换自动折叠历史的展开状态。
 * @param item - 折叠历史项。
 */
function toggleCollapsedHistory(item: Extract<TimelineItem, { type: 'collapsed-history' }>): void {
  if (!item.collapsible) {
    return
  }
  holdUserScroll()
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

function getCollapsedHistoryIconClass(item: Extract<TimelineItem, { type: 'collapsed-history' }>): {
  'is-collapsed': boolean
  'is-pending': boolean
} {
  return {
    'is-collapsed': item.collapsible && !isCollapsedHistoryOpen(item),
    'is-pending': !item.collapsible
  }
}

function setThinkingOpen(viewItem: TimelineViewItem, open: boolean): void {
  if (viewItem.item.type !== 'thinking') {
    return
  }
  holdUserScroll()
  thinkingOpenByKey.value[viewItem.item.key] = open
}

function setToolGroupOpen(viewItem: TimelineViewItem, open: boolean): void {
  if (viewItem.item.type !== 'tool-group') {
    return
  }
  holdUserScroll()
  toolGroupOpenByKey.value[viewItem.item.key] = open
}

function setToolOpen(toolCallId: string, open: boolean): void {
  toolOpenByKey.value[toolCallId] = open
}

function setToolGroupItemOpen(
  _viewItem: TimelineViewItem,
  toolCallId: string,
  open: boolean
): void {
  holdUserScroll()
  setToolOpen(toolCallId, open)
}

function setTimelineItemToolOpen(viewItem: TimelineViewItem, open: boolean): void {
  const toolCallId = viewItem.toolCall?.toolCallId
  if (!toolCallId) {
    return
  }
  holdUserScroll()
  setToolOpen(toolCallId, open)
}

async function forkFromMessage(entryId: string): Promise<void> {
  await workspaceSession.forkActiveSession(entryId)
}

function locateMessageInTree(entryId: string): void {
  openPanelTab('tree', { entryId })
}

function locateCurrentLeafInTree(): void {
  const entryId = workspaceSession.activeSnapshot?.currentEntryId
  if (!entryId) {
    return
  }
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
function resolveToolResultMessageToolCall(message: Message): DesktopToolCall | undefined {
  return getToolResultMessageToolCall(message, toolCallsById.value)
}

/**
 * 更新底部距离状态。
 */
function updateScrollState(allowBottomUnlock = false): void {
  const distanceToBottom = getDistanceToBottom()
  if (distanceToBottom === undefined) {
    isNearBottom.value = true
    shouldFollowBottom.value = true
    return
  }

  const nextState = resolveTimelineFollowState({
    distanceToBottom,
    nearBottomDistance: NEAR_BOTTOM_DISTANCE,
    stickyBottomDistance: STICKY_BOTTOM_DISTANCE,
    isScrollbarDragging: isTimelineScrollbarDragging,
    isUserScrollLocked,
    allowBottomUnlock,
    isRunning: isRunning.value,
    shouldFollowBottom: shouldFollowBottom.value
  })
  isUserScrollLocked = nextState.isUserScrollLocked
  isNearBottom.value = nextState.isNearBottom
  shouldFollowBottom.value = nextState.shouldFollowBottom
}

/**
 * 滚动到最新消息。
 * @param behavior - 滚动行为。
 */
function scrollToLatest(behavior: TimelineScrollBehavior = 'smooth'): void {
  isUserScrollLocked = false
  allowBottomUnlockOnNextScroll = false
  shouldFollowBottom.value = true
  timelineVirtualizer.value.scrollToEnd({ behavior })
}

/** 滚动更新 rAF 句柄。 */
let scrollRafId: number | null = null
let cancelVirtualizerScrollRafId: number | null = null
let pendingScrollBehavior: TimelineScrollBehavior = 'smooth'
let timelineSessionGeneration = 0
let isUserScrollLocked = false
let allowBottomUnlockOnNextScroll = false
let isTimelineScrollbarDragging = false

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
 * 用当前 DOM offset 覆盖未完成的 smooth reconcile，避免用户操作后被再次拉回。
 */
function cancelTimelineVirtualizerScroll(): void {
  if (cancelVirtualizerScrollRafId !== null) {
    return
  }
  const metrics = timelineRef.value?.getScrollMetrics()
  if (!metrics) {
    return
  }
  timelineVirtualizer.value.scrollToOffset(metrics.scrollTop, { behavior: 'auto' })
  cancelVirtualizerScrollRafId = requestAnimationFrame(() => {
    cancelVirtualizerScrollRafId = null
  })
}

/**
 * 用户开始操作滚动时暂停自动贴底。
 */
function holdUserScroll(): void {
  isUserScrollLocked = true
  allowBottomUnlockOnNextScroll = false
  shouldFollowBottom.value = false
  cancelTimelineVirtualizerScroll()
  if (scrollRafId !== null) {
    cancelAnimationFrame(scrollRafId)
    scrollRafId = null
  }
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
 * 用户滚动时退出自动跟随。
 * @param event - wheel 事件。
 */
function handleTimelineWheel(event: WheelEvent): void {
  if (Math.abs(event.deltaY) < 1) {
    return
  }
  const distanceToBottom = getDistanceToBottom()
  if (
    event.deltaY > 0 &&
    distanceToBottom !== undefined &&
    distanceToBottom <= STICKY_BOTTOM_DISTANCE
  ) {
    isUserScrollLocked = false
    allowBottomUnlockOnNextScroll = false
    isNearBottom.value = true
    scrollToLatest('auto')
    return
  }
  holdUserScroll()
  allowBottomUnlockOnNextScroll = event.deltaY > 0
}

/**
 * 只有紧邻用户向下滚动的 scroll 事件可以在底部解除交互锁。
 */
function handleTimelineScroll(): void {
  if (isUserScrollLocked) {
    cancelTimelineVirtualizerScroll()
  }
  const allowBottomUnlock = allowBottomUnlockOnNextScroll
  allowBottomUnlockOnNextScroll = false
  updateScrollState(allowBottomUnlock)
}

/**
 * 用户拖动滚动条时退出自动跟随。
 */
function handleTimelineScrollbarPointerDown(): void {
  isTimelineScrollbarDragging = true
  holdUserScroll()
  window.addEventListener('pointerup', handleTimelineScrollbarPointerEnd, { capture: true })
  window.addEventListener('pointercancel', handleTimelineScrollbarPointerEnd, { capture: true })
}

/**
 * 滚动条拖动结束后，按最终位置决定是否恢复追底。
 */
function handleTimelineScrollbarPointerEnd(): void {
  if (!isTimelineScrollbarDragging) {
    return
  }
  isTimelineScrollbarDragging = false
  window.removeEventListener('pointerup', handleTimelineScrollbarPointerEnd, { capture: true })
  window.removeEventListener('pointercancel', handleTimelineScrollbarPointerEnd, { capture: true })
  updateScrollState(true)
  if (shouldFollowBottom.value) {
    scrollToLatest('auto')
  }
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
  workspaceSession.clearActiveSessionAction()
  await workspaceSession.sendPrompt(
    workspaceSession.defaultSessionContextId,
    workspaceSession.runningDelivery
  )
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

/**
 * 处理 extension 全局快捷键。
 * @param event - 键盘事件。
 */
function handleExtensionShortcutKeyDown(event: KeyboardEvent): void {
  if (!isWorkspaceRouteName(route.name) || event.defaultPrevented || event.isComposing) {
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
  async (threadId, previousThreadId) => {
    if (threadId) {
      void workspaceSession.loadModelOptions(threadId)
    }
    if (threadId === previousThreadId) {
      return
    }

    const generation = ++timelineSessionGeneration
    if (scrollRafId !== null) {
      cancelAnimationFrame(scrollRafId)
      scrollRafId = null
    }
    if (cancelVirtualizerScrollRafId !== null) {
      cancelAnimationFrame(cancelVirtualizerScrollRafId)
      cancelVirtualizerScrollRafId = null
    }
    isUserScrollLocked = false
    isTimelineScrollbarDragging = false
    window.removeEventListener('pointerup', handleTimelineScrollbarPointerEnd, { capture: true })
    window.removeEventListener('pointercancel', handleTimelineScrollbarPointerEnd, {
      capture: true
    })
    shouldFollowBottom.value = true
    isNearBottom.value = true
    prepareTimelineVirtualizerForSession(timelineVirtualizer.value)

    await nextTick()
    if (generation !== timelineSessionGeneration) {
      return
    }
    syncTimelineScrollMargin()
    await nextTick()
    if (generation !== timelineSessionGeneration) {
      return
    }
    scrollToLatest('auto')
  },
  { immediate: true }
)

watch(
  [
    () => workspaceSession.activeSessionActionMessage,
    () => workspaceSession.activePreviousLeafEntryId,
    () => workspaceSession.activeNavigatingTreeEntryId
  ],
  ([message, previousLeafEntryId, navigatingEntryId], _previous, onCleanup) => {
    if (!message || previousLeafEntryId || navigatingEntryId) {
      return
    }
    const timeout = window.setTimeout(
      workspaceSession.clearActiveSessionAction,
      SESSION_ACTION_AUTO_DISMISS_MS
    )
    onCleanup(() => window.clearTimeout(timeout))
  }
)

watch(
  () => workspaceSession.activeSessionNotifications.map((notification) => notification.id),
  (notificationIds) => {
    const activeIds = new Set(notificationIds)
    for (const [notificationId, timeoutId] of sessionNotificationTimeouts) {
      if (!activeIds.has(notificationId)) {
        window.clearTimeout(timeoutId)
        sessionNotificationTimeouts.delete(notificationId)
      }
    }
    for (const notificationId of notificationIds) {
      if (sessionNotificationTimeouts.has(notificationId)) {
        continue
      }
      const timeoutId = window.setTimeout(() => {
        workspaceSession.dismissSessionNotification(notificationId)
        sessionNotificationTimeouts.delete(notificationId)
      }, SESSION_NOTIFICATION_AUTO_DISMISS_MS)
      sessionNotificationTimeouts.set(notificationId, timeoutId)
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

    if (isSessionChanged) {
      return
    }
    if (shouldFollow) {
      if (isRunning.value) {
        scrollToLatest('auto')
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
  () => appearanceSettings.density.value,
  async () => {
    await nextTick()
    syncTimelineScrollMargin()
    await nextTick()
    if (shouldFollowBottom.value) {
      scrollToLatest('auto')
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
  [activityIndicatorFrames, activityIndicatorIntervalMs, activityIndicatorVisible],
  ([frames, intervalMs, visible]) => {
    activityIndicatorFrameIndex.value = 0
    if (activityIndicatorTimerId !== null) {
      window.clearInterval(activityIndicatorTimerId)
      activityIndicatorTimerId = null
    }
    if (!visible || !frames || frames.length <= 1) {
      return
    }
    activityIndicatorTimerId = window.setInterval(
      () => {
        activityIndicatorFrameIndex.value = (activityIndicatorFrameIndex.value + 1) % frames.length
      },
      Math.max(50, intervalMs)
    )
  },
  { immediate: true }
)

useResizeObserver(timelineListRef, () => {
  syncTimelineScrollMargin()
  if (shouldFollowBottom.value) {
    scrollToLatest('auto')
  }
})

onMounted(async () => {
  window.addEventListener('keydown', handleExtensionShortcutKeyDown, { capture: true })
  initialSettingsLoadSchedule = scheduleInitialSettingsLoad(agentSettings, modelSettings)
  await nextTick()
  syncTimelineScrollMargin()
  await nextTick()
  scheduleScrollToLatest('auto')
  updateScrollState()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleExtensionShortcutKeyDown, { capture: true })
  window.removeEventListener('pointerup', handleTimelineScrollbarPointerEnd, { capture: true })
  window.removeEventListener('pointercancel', handleTimelineScrollbarPointerEnd, { capture: true })
  initialSettingsLoadSchedule?.cancel()
  initialSettingsLoadSchedule = undefined
  if (scrollRafId !== null) {
    cancelAnimationFrame(scrollRafId)
  }
  if (cancelVirtualizerScrollRafId !== null) {
    cancelAnimationFrame(cancelVirtualizerScrollRafId)
  }
  if (processingTimerId !== null) {
    window.clearInterval(processingTimerId)
  }
  if (activityIndicatorTimerId !== null) {
    window.clearInterval(activityIndicatorTimerId)
  }
  for (const timeoutId of sessionNotificationTimeouts.values()) {
    window.clearTimeout(timeoutId)
  }
  sessionNotificationTimeouts.clear()
})

/**
 * 获取时间线项的轻量更新依赖。
 * @param item - 时间线项。
 * @returns 更新依赖。
 */
function getTimelineItemRevision(item: TimelineItem | undefined): unknown[] {
  const revision = getBaseTimelineItemRevision(item)
  return item?.type === 'collapsed-history' ? [...revision, isCollapsedHistoryOpen(item)] : revision
}
</script>

<template>
  <div
    class="chat-view"
    :class="[
      `chat-view--density-${appearanceSettings.density.value}`,
      `chat-view--width-${appearanceSettings.chatContentWidth.value}`,
      `chat-view--time-${appearanceSettings.messageTimeDisplay.value}`,
      `chat-view--avatar-${appearanceSettings.avatarStyle.value}`,
      `chat-view--markdown-${appearanceSettings.markdownFontStyle.value}`,
      {
        'chat-view--avatars-hidden': !appearanceSettings.showAvatars.value,
        'chat-view--motion-reduced': appearanceSettings.motion.value === 'reduced',
        'chat-view--user-left': appearanceSettings.userMessageAlignment.value === 'left',
        'chat-view--wrap-code': appearanceSettings.wrapCode.value
      }
    ]"
    :style="chatAppearanceStyle"
  >
    <ScrollArea
      ref="timelineRef"
      class="chat-view__timeline"
      :class="{ 'chat-view__timeline--empty': !messages.length }"
      :vertical-offset="2"
      :vertical-size="7"
      @scroll="handleTimelineScroll"
      @scrollbar-pointer-down="handleTimelineScrollbarPointerDown"
      @wheel.passive="handleTimelineWheel"
    >
      <div class="chat-view__timeline-inner" :style="timelineStyle">
        <div
          :key="workspaceSession.activeSessionId ?? 'draft'"
          ref="timelineListRef"
          class="chat-view__timeline-list"
          :style="timelineListStyle"
        >
          <div ref="timelineWindowRef" class="chat-view__timeline-window">
            <div
              v-for="{ item: viewItem, virtualItem } in virtualTimelineRows"
              :key="`${workspaceSession.activeSessionId ?? 'draft'}:${viewItem.key}`"
              :ref="measureTimelineItem"
              v-memo="[
                viewItem,
                virtualItem.start,
                workspaceSession.activeNavigatingTreeEntryId,
                workspaceSession.activeExtensionHiddenThinkingLabel,
                workspaceSession.activeExtensionToolsExpanded,
                viewItem.collapsedItem ? isCollapsedHistoryOpen(viewItem.collapsedItem) : false,
                finalReplyKeys.has(viewItem.key),
                appearanceSettings.showAvatars.value,
                appearanceSettings.density.value,
                appearanceSettings.chatContentWidth.value,
                appearanceSettings.messageTimeDisplay.value,
                appearanceSettings.wrapCode.value,
                appearanceSettings.toolExpansion.value,
                appearanceSettings.avatarStyle.value,
                appearanceSettings.markdownFontStyle.value,
                appearanceSettings.customMarkdownFontFamily.value,
                appearanceSettings.motion.value,
                appearanceSettings.userMessageAlignment.value,
                getTimelineItemOpenMemoKey(viewItem.item)
              ]"
              :data-index="virtualItem.index"
              :data-timeline-key="viewItem.key"
              class="chat-view__message"
              :style="getTimelineVirtualItemStyle(virtualItem)"
              :class="[
                viewItem.className,
                appearanceSettings.showAvatars.value &&
                  viewItem.avatarLane &&
                  `chat-view__message--${viewItem.avatarLane}-lane`,
                appearanceSettings.showAvatars.value &&
                  viewItem.avatarLane &&
                  !viewItem.avatarKind &&
                  'chat-view__message--avatar-continuation'
              ]"
            >
              <span
                v-if="appearanceSettings.showAvatars.value && viewItem.avatarKind"
                class="chat-view__avatar"
                :class="`chat-view__avatar--${viewItem.avatarKind}`"
                aria-hidden="true"
              >
                <span class="chat-view__avatar-glyph">
                  {{ viewItem.avatarKind === 'assistant' ? 'AI' : 'U' }}
                </span>
              </span>
              <div class="chat-view__message-content">
                <button
                  v-if="viewItem.isCollapsedHistory && viewItem.collapsedItem"
                  type="button"
                  class="chat-view__collapsed-history"
                  :class="{ 'is-pending': !viewItem.collapsedItem.collapsible }"
                  :aria-expanded="isCollapsedHistoryOpen(viewItem.collapsedItem)"
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
                    :class="getCollapsedHistoryIconClass(viewItem.collapsedItem)"
                  />
                </button>
                <ToolGroup
                  v-else-if="viewItem.item.type === 'tool-group'"
                  :open="getTimelineItemToolGroupOpen(viewItem.item)"
                  :tool-call-ids="viewItem.toolCallIds ?? []"
                  :tool-calls="viewItem.toolCalls ?? []"
                  :default-open="defaultToolOpen"
                  :tool-open-by-key="toolOpenByKey"
                  :summary="viewItem.summary ?? ''"
                  :status="viewItem.status"
                  @update:open="setToolGroupOpen(viewItem, $event)"
                  @update-tool-open="
                    (toolCallId, open) => setToolGroupItemOpen(viewItem, toolCallId, open)
                  "
                />
                <component
                  :is="viewItem.component"
                  v-else
                  :message="viewItem.message"
                  :event="viewItem.item.type === 'runtime-event' ? viewItem.item.event : undefined"
                  :message-id="viewItem.messageId"
                  :text="viewItem.text"
                  :revision="viewItem.revision"
                  :is-streaming="viewItem.isStreaming"
                  :is-final-reply="finalReplyKeys.has(viewItem.key)"
                  :is-done="viewItem.isDone"
                  :is-navigating-tree="
                    viewItem.message?.id === workspaceSession.activeNavigatingTreeEntryId
                  "
                  :collapse-when-response-appears="viewItem.collapseWhenResponseAppears"
                  :hidden-label="workspaceSession.activeExtensionHiddenThinkingLabel"
                  :tool-call="viewItem.toolCall"
                  :tool-call-ids="viewItem.toolCallIds"
                  :tool-calls="viewItem.toolCalls"
                  :default-open="defaultToolOpen"
                  :open="getTimelineItemOpen(viewItem.item)"
                  :summary="viewItem.summary"
                  :status="viewItem.status"
                  @update:open="
                    viewItem.item.type === 'thinking'
                      ? setThinkingOpen(viewItem, $event)
                      : setTimelineItemToolOpen(viewItem, $event)
                  "
                  @fork-from-message="forkFromMessage"
                  @locate-in-tree="locateMessageInTree"
                  @navigate-tree="navigateMessageTree"
                  @quote-selection="handleQuoteSelection"
                  @content-height-change="handleTimelineItemHeightChange(virtualItem.index)"
                />
              </div>
            </div>
          </div>
        </div>

        <div v-if="activityVisible" class="chat-view__activity" aria-live="polite">
          <template v-if="appearanceSettings.activityIndicatorStyle.value !== 'hidden'">
            <span
              v-if="
                showDefaultActivityIndicator &&
                appearanceSettings.activityIndicatorStyle.value === 'pixels'
              "
              class="chat-view__activity-pixels"
              aria-hidden="true"
            >
              <i />
              <i />
              <i />
            </span>
            <span
              v-else-if="showDefaultActivityIndicator"
              class="chat-view__activity-pulse"
              aria-hidden="true"
            />
            <span v-else-if="activityIndicatorLabel" class="chat-view__activity-indicator">
              {{ activityIndicatorLabel }}
            </span>
          </template>
          <span
            v-if="appearanceSettings.activityDisplay.value === 'full'"
            class="chat-view__activity-label"
          >
            {{ activityLabel }}
          </span>
        </div>
      </div>
    </ScrollArea>

    <Transition name="jump-latest">
      <button
        v-if="workspaceSession.activeSession && messages.length > 0 && !isNearBottom"
        type="button"
        class="chat-view__jump"
        :style="jumpBtnStyle"
        @click="scrollToLatest()"
      >
        回到最新
      </button>
    </Transition>

    <div
      class="chat-view__composer-backdrop"
      :style="{ height: `${Math.ceil(composerHeight) + 32}px` }"
      aria-hidden="true"
    />

    <div ref="composerRef" class="chat-view__composer">
      <TransitionGroup
        ref="sessionNotificationsRef"
        name="session-notification"
        tag="div"
        class="chat-view__session-notifications"
      >
        <div
          v-for="notification in workspaceSession.activeSessionNotifications"
          :key="notification.id"
          class="chat-view__session-notification"
        >
          <span class="chat-view__session-notification-text">
            {{ notification.message }}
          </span>
          <button
            type="button"
            class="chat-view__session-notification-close"
            aria-label="关闭通知"
            @click="workspaceSession.dismissSessionNotification(notification.id)"
          >
            <X :size="14" />
          </button>
        </div>
      </TransitionGroup>

      <div
        v-if="workspaceSession.activeSessionActionMessage || hasVisiblePendingQueue"
        class="chat-view__session-action"
      >
        <div
          v-if="workspaceSession.activeSessionActionMessage"
          class="chat-view__session-action-row"
        >
          <span class="chat-view__session-action-text">
            {{ workspaceSession.activeSessionActionMessage }}
          </span>
          <div class="chat-view__session-action-buttons">
            <BaseIconButton
              v-if="workspaceSession.activePreviousLeafEntryId"
              label="返回之前位置"
              size="small"
              @click="workspaceSession.navigateBackToPreviousLeaf"
            >
              <Undo2 :size="14" />
            </BaseIconButton>
            <BaseIconButton
              v-if="workspaceSession.activeSnapshot?.currentEntryId"
              label="在 Tree 中定位"
              size="small"
              @click="locateCurrentLeafInTree"
            >
              <MapPin :size="14" />
            </BaseIconButton>
            <BaseIconButton
              label="关闭提示"
              size="small"
              @click="workspaceSession.clearActiveSessionAction"
            >
              <X :size="14" />
            </BaseIconButton>
          </div>
        </div>
        <div
          v-for="(message, index) in pendingSteeringPrompts"
          :key="`steering-${index}-${message}`"
          class="chat-view__session-action-row"
        >
          <CornerDownRight
            :size="14"
            class="chat-view__session-action-type-icon"
            aria-hidden="true"
          />
          <span class="chat-view__session-action-text" :title="`引导消息：${message}`">
            {{ message }}
          </span>
        </div>
        <div
          v-for="(message, index) in pendingFollowUpPrompts"
          :key="`follow-up-${index}-${message}`"
          class="chat-view__session-action-row"
        >
          <ListEnd :size="14" class="chat-view__session-action-type-icon" aria-hidden="true" />
          <span class="chat-view__session-action-text" :title="`后续消息：${message}`">
            {{ message }}
          </span>
        </div>
      </div>
      <Composer
        v-model="activeComposerDraft"
        v-model:running-delivery="workspaceSession.runningDelivery"
        :is-running="isRunning"
        :can-send="canSend"
        :submitting="
          composerEditorRequest
            ? Boolean(workspaceSession.activeExtensionDialogResponding[composerEditorRequest.id])
            : workspaceSession.isSendingPrompt
        "
        :thread-id="workspaceSession.activeSessionId"
        :project-id="workspaceSession.activeProjectId"
        :projects="workspaceProject.projectList"
        :images="composerEditorRequest ? [] : workspaceSession.draftImages"
        :files="composerEditorRequest ? [] : workspaceSession.draftFiles"
        :quotes="composerEditorRequest ? [] : workspaceSession.draftQuotes"
        :image-error="composerEditorRequest ? undefined : imageSelectionError"
        :selecting-images="composerEditorRequest ? false : selectingImages"
        :usage="tokenUsage"
        :current-model="activeModel"
        :model-options="modelOptions"
        :loading-model-options="loadingModelOptions"
        :commands="composerEditorRequest ? [] : workspaceSession.activeCommands"
        :loading-commands="composerEditorRequest ? false : workspaceSession.activeCommandsLoading"
        :disabled="Boolean(workspaceSession.activeExtensionDialog && !composerEditorRequest)"
        :model-select-disabled="
          isRunning || (!workspaceSession.activeSessionId && !workspaceSession.activeProjectId)
        "
        :current-thinking-level="activeThinkingLevel"
        :thinking-select-disabled="
          isRunning || (!workspaceSession.activeSessionId && !workspaceSession.activeProjectId)
        "
        :placeholder="composerEditorRequest ? composerEditorRequest.title : composerPlaceholder"
        :mode-label="composerEditorRequest?.title"
        :mode-error="
          composerEditorRequest
            ? workspaceSession.activeExtensionDialogErrors[composerEditorRequest.id]
            : undefined
        "
        @submit="submitActiveComposer"
        @select-model="handleSelectModel"
        @select-thinking-level="handleSelectThinkingLevel"
        @select-project="workspaceSession.startNewSession"
        @select-images="handleSelectImages"
        @paste-images="handlePasteImages"
        @add-image-files="handleAddImageFiles"
        @add-files="handleAddFiles"
        @remove-image="workspaceSession.removeComposerImage"
        @remove-file="workspaceSession.removeComposerFile"
        @remove-quote="workspaceSession.removeComposerQuote"
        @clear-images="handleClearImages"
        @dismiss-image-error="handleDismissImageError"
        @load-commands="workspaceSession.loadCommands()"
        @run-command="workspaceSession.runCommand"
        @text-change="handleComposerTextChange"
        @abort="workspaceSession.abortActive"
        @exit-mode="exitExtensionComposer"
      >
        <template v-if="workspaceSession.activeExtensionDialog && !composerEditorRequest" #overlay>
          <ExtensionDialogHost
            :request="workspaceSession.activeExtensionDialog"
            :draft="
              workspaceSession.activeExtensionDialogDrafts[
                workspaceSession.activeExtensionDialog.id
              ]
            "
            :responding="
              workspaceSession.activeExtensionDialogResponding[
                workspaceSession.activeExtensionDialog.id
              ]
            "
            :error="
              workspaceSession.activeExtensionDialogErrors[
                workspaceSession.activeExtensionDialog.id
              ]
            "
            @submit="workspaceSession.respondExtensionDialog"
            @cancel="workspaceSession.cancelExtensionDialog"
            @update:draft="workspaceSession.setExtensionDialogDraft"
          />
        </template>
      </Composer>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.chat-view {
  --chat-content-max-width: 768px;
  --chat-avatar-gutter-width: 38px;
  --chat-active-avatar-gutter-width: var(--chat-avatar-gutter-width);
  --chat-message-gap: var(--space-3);
  --chat-timeline-padding-y: var(--space-6);
  --chat-composer-padding-bottom: 24px;

  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  container-type: inline-size;
}

.chat-view--avatars-hidden {
  --chat-active-avatar-gutter-width: 0px;
}

.chat-view--avatar-circle .chat-view__avatar {
  clip-path: none;
  border-radius: 50%;
}

.chat-view--avatar-circle .chat-view__avatar::after {
  display: none;
}

.chat-view--markdown-serif {
  --markdown-body-font: Georgia, 'Times New Roman', serif;
}

.chat-view--motion-reduced,
.chat-view--motion-reduced :deep(*) {
  scroll-behavior: auto !important;
  transition-duration: 0.01ms !important;
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
}

.chat-view--user-left :deep(.user-message-stack) {
  align-items: flex-start;
}

.chat-view--user-left :deep(.is-user-message .message__actions) {
  justify-content: flex-start;
}

.chat-view--user-left .chat-view__message--user-lane .chat-view__avatar {
  right: auto;
  left: calc(var(--chat-avatar-gutter-width) * -1);
}

.chat-view--width-narrow {
  --chat-content-max-width: 640px;
}

.chat-view--width-wide {
  --chat-content-max-width: 960px;
}

.chat-view--density-compact {
  --chat-message-gap: var(--space-2);
  --chat-timeline-padding-y: var(--space-3);
  --chat-composer-padding-bottom: var(--space-3);
}

.chat-view--density-comfortable {
  --chat-message-gap: var(--space-5);
  --chat-timeline-padding-y: var(--space-8);
  --chat-composer-padding-bottom: var(--space-8);
}

.chat-view--time-hidden :deep(.message__time) {
  display: none;
}

.chat-view--time-always :deep(.message__actions) {
  opacity: 1;
}

.chat-view--time-always :deep(.message__action-btn) {
  opacity: 0;
}

.chat-view--time-always :deep(.message:hover .message__action-btn) {
  opacity: 1;
}

.chat-view--wrap-code :deep(.streaming-code-block__pre),
.chat-view--wrap-code :deep(.streaming-code-block__highlight),
.chat-view--wrap-code :deep(.streaming-code-block__highlight code),
.chat-view--wrap-code :deep(.streaming-code-block__token) {
  width: auto;
  max-width: 100%;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.chat-view__timeline {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  scroll-behavior: smooth;
  scroll-padding: var(--space-8);

  :deep([data-slot='scroll-area-viewport']) {
    overflow-anchor: none;
  }
}

.chat-view__timeline-inner {
  display: flex;
  flex-direction: column;
  gap: var(--chat-message-gap);
  width: 100%;
  max-width: var(--chat-content-max-width);
  min-height: 100%;
  margin: 0 auto;
  padding: var(--chat-timeline-padding-y) var(--space-8) var(--space-8);
  transition:
    max-width var(--duration-base) var(--ease-standard),
    padding-inline var(--duration-base) var(--ease-standard);
}

.chat-view__session-notifications {
  position: absolute;
  right: var(--space-8);
  bottom: calc(100% + var(--space-3));
  left: var(--space-8);
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  pointer-events: none;
}

.chat-view__session-notification {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  box-sizing: border-box;
  width: fit-content;
  max-width: min(100%, 480px);
  min-height: 36px;
  padding: 6px 7px 6px 11px;
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--font-size-ui-sm);
  line-height: 1.35;
  background: color-mix(in srgb, var(--color-surface) 97%, transparent);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: 0 6px 18px rgb(20 35 48 / 9%);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.chat-view__session-notification-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-view__session-notification-close {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  color: var(--color-text-subtle);
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs);
  cursor: pointer;
  pointer-events: auto;
  transition:
    color var(--duration-fast) var(--ease-standard),
    background-color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }
}

.session-notification-enter-active,
.session-notification-leave-active,
.session-notification-move {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.session-notification-enter-from,
.session-notification-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

.session-notification-enter-to,
.session-notification-leave-from {
  opacity: 1;
  transform: translateY(0);
}

.session-notification-leave-active {
  position: absolute;
}

.chat-view__session-action {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  width: calc(100% - 32px);
  margin: 0 auto -12px;
  padding: var(--space-1) var(--space-3) calc(var(--space-1) + 12px) var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-sm);
  line-height: 1.4;
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  border-bottom: 0;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

.chat-view__session-action-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.chat-view__session-action-type-icon {
  flex: 0 0 auto;
  color: var(--color-text-subtle);
}

.chat-view__session-action-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-view__session-action-buttons {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  margin-left: auto;
  gap: var(--space-1);
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

.chat-view__timeline-list {
  position: relative;
  flex: 0 0 auto;
  width: 100%;
}

.chat-view__timeline-window {
  position: absolute;
  inset: 0;
  width: 100%;
}

.chat-view__message {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  align-items: flex-start;
  width: 100%;
  min-width: 0;
}

.chat-view__message-content {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
}

.chat-view__message--user-lane .chat-view__avatar {
  right: calc(var(--chat-avatar-gutter-width) * -1);
  left: auto;
}

.chat-view__avatar {
  --avatar-accent: color-mix(in srgb, var(--color-primary) 82%, #35f2e5);

  position: absolute;
  top: 0;
  left: calc(var(--chat-avatar-gutter-width) * -1);
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin-top: 1px;
  color: var(--avatar-accent);
  background:
    linear-gradient(90deg, var(--avatar-accent) 2px, transparent 2px) 4px 4px / 6px 2px no-repeat,
    color-mix(in srgb, var(--color-surface-raised) 88%, var(--avatar-accent));
  border: 1px solid color-mix(in srgb, var(--avatar-accent) 68%, var(--color-border));
  clip-path: polygon(0 5px, 5px 0, 100% 0, 100% 23px, 23px 100%, 0 100%);
  box-shadow:
    inset 0 0 0 2px color-mix(in srgb, var(--avatar-accent) 8%, transparent),
    0 0 10px color-mix(in srgb, var(--avatar-accent) 14%, transparent);
}

.chat-view__avatar::after {
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 3px;
  height: 3px;
  content: '';
  background: var(--avatar-accent);
  box-shadow: -4px 0 0 color-mix(in srgb, var(--avatar-accent) 45%, transparent);
}

.chat-view__avatar--user {
  --avatar-accent: color-mix(in srgb, var(--color-warning, #ffcc4a) 84%, #ff4fd8);
}

.chat-view__avatar-glyph {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0;
  text-shadow: 1px 0 0 color-mix(in srgb, var(--avatar-accent) 30%, transparent);
}

.chat-view__message--assistant,
.chat-view__message--thinking,
.chat-view__message--system,
.chat-view__message--tool,
.chat-view__message--collapsed-history {
  justify-content: flex-start;
}

.chat-view__message--compaction-divider {
  justify-content: stretch;
  width: 100%;
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
  display: inline-flex;
  align-items: center;
  gap: 7px;
  align-self: flex-start;
  min-width: 0;
  max-width: 100%;
  padding: 3px 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-sm);
  line-height: 1.3;
}

.chat-view__activity-pixels {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  width: 14px;
  flex: 0 0 auto;

  i {
    width: 3px;
    height: 3px;
    background: var(--color-primary);
    animation: activity-pixel-hop 900ms steps(2, end) infinite;
  }

  i:nth-child(2) {
    animation-delay: 120ms;
  }

  i:nth-child(3) {
    animation-delay: 240ms;
  }
}

.chat-view__activity-pulse {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  background: var(--color-primary);
  border-radius: 50%;
  animation: pulse 900ms var(--ease-standard) infinite;
}

.chat-view__activity-indicator {
  min-width: 1ch;
  flex: 0 0 auto;
  color: var(--color-primary-strong);
  font-family: var(--font-mono);
  font-size: var(--font-size-ui-xs);
}

.chat-view__activity-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-view__jump {
  position: absolute;
  left: 50%;
  transform: translate(-50%, 0);
  z-index: 4;
  padding: 7px var(--space-3);
  color: var(--color-primary-ink);
  font: inherit;
  font-size: var(--font-size-ui-sm);
  font-weight: 700;
  letter-spacing: 0.02em;
  background: var(--color-primary);
  border: 1px solid var(--color-primary-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);

  &:hover {
    background: var(--color-primary-strong);
    transform: translate(-50%, -1px);
  }
}

.jump-latest-enter-active,
.jump-latest-leave-active {
  transition:
    opacity var(--duration-base) var(--ease-standard),
    transform var(--duration-base) var(--ease-standard);
}

.jump-latest-enter-from,
.jump-latest-leave-to {
  opacity: 0;
  transform: translate(-50%, 6px);
}

.jump-latest-enter-to,
.jump-latest-leave-from {
  opacity: 1;
  transform: translate(-50%, 0);
}

.chat-view__composer-backdrop {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 10;
  background: linear-gradient(to bottom, transparent, var(--color-surface) 32px);
  pointer-events: none;
}

.chat-view__composer {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translate(-50%, 0);
  width: 100%;
  max-width: min(
    calc(var(--chat-content-max-width) + var(--chat-active-avatar-gutter-width) * 2),
    100%
  );
  min-width: 0;
  padding: 0 var(--space-8) var(--chat-composer-padding-bottom);
  margin: 0 auto;
  z-index: 30;
  transition:
    max-width var(--duration-base) var(--ease-standard),
    padding-inline var(--duration-base) var(--ease-standard);
}

@keyframes activity-pixel-hop {
  0%,
  100% {
    opacity: 0.35;
    transform: translateY(1px);
  }

  45% {
    opacity: 1;
    transform: translateY(-2px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-view__activity-pixels i {
    opacity: 0.72;
    animation: none;
  }

  .jump-latest-enter-active,
  .jump-latest-leave-active {
    transition: none;
  }
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

@container (width <= 860px) {
  .chat-view__timeline-inner {
    padding-inline: calc(var(--chat-active-avatar-gutter-width) + var(--space-6));
  }

  .chat-view__composer {
    padding-inline: var(--space-6);
  }
}

@container (width <= 520px) {
  .chat-view {
    --chat-avatar-gutter-width: 30px;
  }

  .chat-view__timeline-inner {
    padding-inline: calc(var(--chat-active-avatar-gutter-width) + var(--space-6));
  }

  .chat-view__composer {
    padding-inline: var(--space-6);
  }

  .chat-view__avatar {
    width: 24px;
    height: 24px;
    clip-path: polygon(0 4px, 4px 0, 100% 0, 100% 20px, 20px 100%, 0 100%);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--avatar-accent) 8%, transparent);
  }

  .chat-view__avatar::after {
    right: 2px;
    bottom: 2px;
    width: 2px;
    height: 2px;
    box-shadow: -3px 0 0 color-mix(in srgb, var(--avatar-accent) 45%, transparent);
  }

  .chat-view__avatar-glyph {
    font-size: 8px;
  }
}

@container (width <= 360px) {
  .chat-view {
    --chat-avatar-gutter-width: 25px;
  }

  .chat-view__timeline-inner,
  .chat-view__composer {
    padding-inline: var(--space-5);
  }

  .chat-view__avatar {
    width: 20px;
    height: 20px;
    clip-path: polygon(0 3px, 3px 0, 100% 0, 100% 17px, 17px 100%, 0 100%);
  }

  .chat-view__avatar::after {
    display: none;
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
