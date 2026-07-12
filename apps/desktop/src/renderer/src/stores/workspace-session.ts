/**
 * workspace-session.ts - 管理 renderer 中 coding thread 的状态与 IPC 调用。
 */

import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowReactive } from 'vue'
import router from '@renderer/router'
import useWorkspaceProjectStore from './workspace-project'
import {
  createComposerContentFromText,
  createEmptyComposerContent,
  ensureComposerDraft,
  ensureComposerFiles,
  ensureComposerImages,
  ensureComposerQuotes,
  getPromptImagePayload,
  restoreComposerPromptDraft,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type ComposerQuoteAttachment
} from './workspace-session-composer'
import { useToast } from '@renderer/composables/useToast'
import { transferStoredSessionPanelTabsState } from '@renderer/components/session/panel/state/useSessionPanelTabsState'
import { getBuiltinCommandInfos } from '@shared/coding-agent/builtin-commands'
import { formatFileArgForInsertion } from '@shared/coding-agent/file-reference-format'
import {
  createExtensionDialogCancellation,
  createExtensionDialogResponse,
  enqueueExtensionDialog,
  getExtensionDialogInitialDraft,
  removeExtensionDialog
} from './workspace-session-extension'
import { toDesktopMessageContent } from '@shared/coding-agent/types'
import type { JSONContent } from '@tiptap/vue-3'
import type {
  AgentSessionIpcEvent,
  ApprovalRequest,
  ApprovalResponse,
  CodingAgentIpcEvent,
  CommandInfo,
  CreateThreadInput,
  DesktopExtensionWebviewPanel,
  ExtensionDialogRequest,
  ExtensionPanelProjection,
  ExtensionUiRequest,
  ExtensionUiResponseInput,
  ExportSessionResult,
  LoadSessionTreeBranchesInput,
  LoadSessionTreeBranchesResult,
  ModelInfo,
  RunCommandResult,
  SessionTreeBranchEntryRow,
  ThinkingLevel,
  ThreadSnapshot,
  ThreadMessage,
  ThreadSummary
} from '@shared/coding-agent/types'

const PROMPT_TITLE_MAX_CHARS = 30
const EXTENSION_INLINE_NOTIFY_MAX_CHARS = 180
const DEFERRED_SNAPSHOT_REFRESH_DELAY_MS = 900
const MAX_SESSION_NOTIFICATIONS = 4
const MAX_COMPOSER_QUOTES = 5
const MAX_COMPOSER_QUOTE_CHARS = 4000
const MAX_COMPOSER_QUOTE_TOTAL_CHARS = 12000

/** 会话面板 UI 状态。 */
export type SessionUiState = {
  /** 面板是否展开。 */
  panelOpen: boolean
  /** 面板宽度。 */
  panelWidth: number
}

export type { ComposerImageAttachment } from './workspace-session-composer'
export type { ComposerFileAttachment } from './workspace-session-composer'
export type { ComposerQuoteAttachment } from './workspace-session-composer'

export interface SessionNotification {
  id: string
  message: string
}

/** 运行中消息的交付方式。 */
export type RunningMessageDelivery = 'steer' | 'followUp'

/** 扩展自定义工作指示器配置。 */
type ExtensionWorkingIndicatorOptions = Extract<
  ExtensionUiRequest,
  { type: 'setWorkingIndicator' }
>['options']

/** 消息渲染状态。 */
export interface MessageRenderState {
  /** 渲染版本号，流式更新时递增。 */
  revision: number
  /** 当前渲染状态。 */
  renderState: 'streaming' | 'complete'
}

/** 工作区会话对象。 */
export type WorkspaceSession = ThreadSummary & {
  /** 当前快照。 */
  snapshot?: ThreadSnapshot
}

/** Workspace 中某个视图上下文的状态。 */
export type WorkspaceSessionContext = {
  /** 当前上下文选中的 thread ID。 */
  activeThreadId?: string
  /** 未绑定 thread 的新会话草稿所属 Project。 */
  selectedProjectId?: string
  /** 未绑定 thread 的新会话草稿模型。 */
  orphanModel?: {
    /** provider。 */
    provider: string
    /** 模型 ID。 */
    modelId: string
  }
  /** 未绑定 thread 的新会话草稿 thinking level。 */
  orphanThinkingLevel?: ThinkingLevel
  /** 未选中会话时的临时 Composer 草稿。 */
  orphanDraftMessage: JSONContent
  /** 当前上下文内每个 thread 独立的 Composer 草稿。 */
  composerDrafts: Record<string, JSONContent>
  /** 未选中会话时的临时图片草稿。 */
  orphanImageAttachments: ComposerImageAttachment[]
  /** 当前上下文内每个 thread 独立的图片草稿。 */
  composerImageAttachments: Record<string, ComposerImageAttachment[]>
  /** 未选中会话时的临时文件路径附件草稿。 */
  orphanFileAttachments: ComposerFileAttachment[]
  /** 当前上下文内每个 thread 独立的文件路径附件草稿。 */
  composerFileAttachments: Record<string, ComposerFileAttachment[]>
  /** 未选中会话时的临时文本引用草稿。 */
  orphanQuoteAttachments: ComposerQuoteAttachment[]
  /** 当前上下文内每个 thread 独立的文本引用草稿。 */
  composerQuoteAttachments: Record<string, ComposerQuoteAttachment[]>
  /** 未选中会话时运行中消息交付方式。 */
  orphanRunningDelivery: RunningMessageDelivery
  /** 当前上下文内每个 thread 独立的运行中消息交付方式。 */
  runningDeliveries: Record<string, RunningMessageDelivery>
  /** 当前上下文未绑定 thread 时的面板 UI 状态。 */
  panel: SessionUiState
  /** 未绑定 thread 的 panel tabs 状态 key。 */
  orphanSessionPanelTabsKey: string
  /** 当前上下文内每个 thread 独立的面板 UI 状态。 */
  sessionPanels: Record<string, SessionUiState>
  /** 未绑定 thread 时按 Project 发现到的命令列表。 */
  orphanCommands: CommandInfo[]
  /** 未绑定 thread 时命令列表是否正在加载。 */
  orphanCommandsLoading: boolean
  /** 未绑定 thread 时命令列表是否已加载。 */
  orphanCommandsLoaded: boolean
}

/** 单个 thread 的运行态。 */
export type WorkspaceSessionRuntime = {
  /** 待处理的审批请求。 */
  approvals: Record<string, ApprovalRequest>
  /** 按到达顺序等待用户响应的 extension 对话框。 */
  extensionDialogQueue: ExtensionDialogRequest[]
  /** extension 对话框按 request ID 保存的草稿。 */
  extensionDialogDrafts: Record<string, string>
  /** extension 对话框提交状态。 */
  extensionDialogResponding: Record<string, boolean>
  /** extension 对话框最近一次提交错误。 */
  extensionDialogErrors: Record<string, string | undefined>
  /** extension 设置的状态文本。 */
  extensionStatuses: Record<string, string | undefined>
  /** extension notify 的完整消息列表。 */
  extensionNotifications: string[]
  /** desktop extension 注册的 webview panels。 */
  extensionPanels: Record<string, DesktopExtensionWebviewPanel>
  /** extension 发给 desktop panel 的最近消息及尚未消费的有界消息日志。 */
  extensionPanelMessages: Record<
    string,
    {
      sequence: number
      message: unknown
      messages: Array<{ sequence: number; message: unknown }>
    }
  >
  /** desktop webview panel 内容通过 piPanel.setState 保存的状态。 */
  extensionPanelStates: Record<string, unknown>
  /** extension 设置的会话标题提示。 */
  extensionTitle?: string
  /** extension 设置的工作中文案。 */
  extensionWorkingMessage?: string
  /** extension 设置的工作行可见性。 */
  extensionWorkingVisible?: boolean
  /** extension 设置的工作指示器。 */
  extensionWorkingIndicator?: ExtensionWorkingIndicatorOptions
  /** extension 设置的隐藏 thinking 标签。 */
  extensionHiddenThinkingLabel?: string
  /** extension 设置的工具输出展开状态。 */
  extensionToolsExpanded?: boolean
  /** 最近接收到的 IPC 事件列表。 */
  events: CodingAgentIpcEvent[]
  /** 仅用于 renderer timeline 展示的运行时事件，不写入 session 文件。 */
  timelineEvents: WorkspaceRuntimeTimelineEvent[]
  /** 消息渲染状态，key 为 messageId。 */
  renderState: Record<string, MessageRenderState>
  /** 当前自动重试状态。 */
  retry?: WorkspaceRetryState
  /** 当前上下文压缩状态。 */
  compaction?: WorkspaceCompactionState
  /** 最近一次导出结果。 */
  lastExport?: ExportSessionResult
  /** fork/switch 前的 session 文件，用于快速切回。 */
  previousSessionFile?: string
  /** tree 导航前的 leaf entry，用于快速回到上一个位置。 */
  previousLeafEntryId?: string
  /** 最近一次返回前的 leaf entry，预留给后续前进能力。 */
  nextLeafEntryId?: string
  /** 是否正在刷新当前 thread snapshot。 */
  loadingSnapshot: boolean
  /** 当前 thread 最近一次错误。 */
  errorMessage?: string
}

/** renderer timeline 展示用运行时事件。 */
export interface WorkspaceRuntimeTimelineEvent {
  /** 稳定事件 ID。 */
  id: string
  /** 事件类型。 */
  type: 'worker-error'
  /** 展示标题。 */
  title: string
  /** 展示描述。 */
  message: string
  /** 创建时间 ISO 字符串。 */
  createdAt: string
  /** 短元信息标签。 */
  meta: string[]
}

/** 当前 thread 的自动重试状态。 */
export interface WorkspaceRetryState {
  /** 当前重试序号。 */
  attempt: number
  /** 最大重试次数。 */
  maxAttempts: number
  /** 下次重试延迟。 */
  delayMs: number
  /** 触发重试的错误摘要。 */
  errorMessage: string
}

/** 当前 thread 的上下文压缩状态。 */
export interface WorkspaceCompactionState {
  /** 触发原因。 */
  reason: 'manual' | 'threshold' | 'overflow'
  /** 是否正在压缩。 */
  running: boolean
  /** 开始时间。 */
  startedAt: string
  /** 完成时间。 */
  finishedAt?: string
  /** 是否被中止。 */
  aborted?: boolean
  /** 是否会重试。 */
  willRetry?: boolean
  /** 错误信息。 */
  error?: string
}

/** main 派生的扁平 branch 视图状态。 */
export interface WorkspaceSessionTreeBranchesState {
  /** 最近一次加载结果。 */
  result?: LoadSessionTreeBranchesResult
  /** 是否正在加载。 */
  loading: boolean
  /** 分支视图失效版本，用于通知已打开的 Tree tab 重新加载。 */
  revision: number
  /** 最近一次查询 key，用于丢弃过期响应。 */
  requestKey?: string
  /** 最近一次错误。 */
  errorMessage?: string
}

function isSameSessionTreeEntryRow(
  previous: SessionTreeBranchEntryRow,
  next: SessionTreeBranchEntryRow
): boolean {
  return (
    previous.kind === next.kind &&
    previous.id === next.id &&
    previous.entryId === next.entryId &&
    previous.parentId === next.parentId &&
    previous.type === next.type &&
    previous.timestamp === next.timestamp &&
    previous.title === next.title &&
    previous.summary === next.summary &&
    previous.label === next.label &&
    previous.labelTimestamp === next.labelTimestamp &&
    previous.depth === next.depth &&
    previous.visualDepth === next.visualDepth &&
    previous.childCount === next.childCount &&
    previous.leaf === next.leaf &&
    previous.branchPoint === next.branchPoint &&
    previous.current === next.current
  )
}

/**
 * 按 entry ID 复用未变化的 Tree row，使 Vue 只 patch 实际变化的虚拟行。
 */
export function reconcileSessionTreeBranchesResult(
  previous: LoadSessionTreeBranchesResult | undefined,
  next: LoadSessionTreeBranchesResult
): LoadSessionTreeBranchesResult {
  if (!previous) {
    return next
  }
  const previousRowsById = new Map(previous.rows.map((row) => [row.entryId, row]))
  let rowsChanged = previous.rows.length !== next.rows.length
  const rows = next.rows.map((nextRow, index) => {
    const previousRow = previousRowsById.get(nextRow.entryId)
    if (previousRow && isSameSessionTreeEntryRow(previousRow, nextRow)) {
      if (previous.rows[index] !== previousRow) {
        rowsChanged = true
      }
      return previousRow
    }
    rowsChanged = true
    return nextRow
  })
  const metadataChanged =
    previous.totalEntries !== next.totalEntries ||
    previous.visibleEntries !== next.visibleEntries ||
    previous.currentEntryId !== next.currentEntryId
  return rowsChanged || metadataChanged ? { ...next, rows } : previous
}

/** 按 toolCallId 归一化的工具调用索引。 */
export type WorkspaceToolCallsById = Record<string, ThreadSnapshot['toolCalls'][number] | undefined>

/** timeline 使用的轻量工具调用结构。 */
export type WorkspaceToolCallStructure = Pick<
  ThreadSnapshot['toolCalls'][number],
  'threadId' | 'toolCallId' | 'toolName' | 'args' | 'startedAt' | 'finishedAt'
>

/** 会话面板最小宽度。 */
const minSessionPanelWidth = 300

/** 会话面板最大宽度；undefined 表示不限制。 */
const maxSessionPanelWidth: number | undefined = undefined

/** 默认会话上下文 ID。 */
const defaultSessionContextId = 'main'

/** 当前窗口会话中活跃 thread 的 sessionStorage key 前缀。 */
const activeThreadSessionStoragePrefix = 'meta-agent.workspace-session.active-thread.'

/** 当前窗口会话中 panel UI 状态 localStorage key 前缀。 */
const sessionPanelUiStoragePrefix = 'meta-agent.workspace-session.panel-ui.v1.'

let orphanSessionPanelTabsKeySequence = 0

function createFreshOrphanSessionPanelTabsKey(contextId: string): string {
  orphanSessionPanelTabsKeySequence += 1
  return `__orphan__.${contextId}.${orphanSessionPanelTabsKeySequence}`
}

/** 后端真实 agent session 事件类型集合。 */
const agentSessionEventTypes = new Set<AgentSessionIpcEvent['type']>([
  'agent_start',
  'agent_end',
  'turn_start',
  'turn_end',
  'message_start',
  'message_update',
  'message_end',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
  'queue_update',
  'compaction_start',
  'session_info_changed',
  'thinking_level_changed',
  'model_changed',
  'compaction_end',
  'auto_retry_start',
  'auto_retry_end'
])

/**
 * 创建默认会话 UI 状态。
 * @returns 默认会话 UI 状态。
 */
const createUiState = (): SessionUiState => ({
  panelOpen: false,
  panelWidth: 420
})

function cloneUiState(state: SessionUiState): SessionUiState {
  return {
    panelOpen: state.panelOpen,
    panelWidth: state.panelWidth
  }
}

/**
 * Composer 文本缓存，避免频繁从同一份 Tiptap JSON 递归取文本。
 */
const composerTextCache = new WeakMap<JSONContent, string>()

/** 空工具调用索引，避免 computed 读取路径创建新对象或写入 store。 */
const emptyToolCallsById: WorkspaceToolCallsById = Object.freeze({})

/** 空工具调用结构列表，避免 computed 读取路径创建新数组或写入 store。 */
const emptyToolCallStructures = Object.freeze([]) as unknown as WorkspaceToolCallStructure[]

/** 空 Composer 草稿，作为纯读兜底；真实 thread 草稿在切换时显式初始化。 */
const emptyComposerDraft = createEmptyComposerContent()

/** 空 Composer 图片列表，避免草稿 getter 为无附件 thread 创建新数组。 */
const emptyComposerImages = Object.freeze([]) as unknown as ComposerImageAttachment[]

/** 空 Composer 文件路径附件列表，避免草稿 getter 为无附件 thread 创建新数组。 */
const emptyComposerFiles = Object.freeze([]) as unknown as ComposerFileAttachment[]

/** 空 Composer 文本引用列表，避免草稿 getter 为无引用 thread 创建新数组。 */
const emptyComposerQuotes = Object.freeze([]) as unknown as ComposerQuoteAttachment[]

/**
 * Workspace Session Store。
 * 负责加载、创建、管理 thread，处理 IPC 事件以及审批请求。
 */
export default defineStore('workspace-session', () => {
  const toast = useToast()

  /** 全局错误提示信息。 */
  const globalErrorMessage = ref<string>()

  /** 是否正在加载 thread 列表。 */
  const loadingThreads = ref(false)
  const orphanCommandsRequestGenerationByContextId: Record<string, number> = {}

  /** 所有会话数据。 */
  const sessions = shallowReactive<Record<string, WorkspaceSession>>({})

  /** 每个视图上下文的选择态与 UI 状态。 */
  const contexts = shallowReactive<Record<string, WorkspaceSessionContext>>({})

  /** 每个 thread 的运行态。 */
  const runtimeByThreadId = shallowReactive<Record<string, WorkspaceSessionRuntime>>({})

  /** 每个 thread 的工具调用索引，用于 renderer 按 id 原子订阅。 */
  const toolCallsByThreadId = shallowReactive<Record<string, WorkspaceToolCallsById>>({})

  /** 每个 thread 的工具调用结构列表，避免 timeline 订阅流式 result。 */
  const toolCallStructuresByThreadId = shallowReactive<
    Record<string, WorkspaceToolCallStructure[]>
  >({})

  /** 每个 thread 的可用模型列表。 */
  const modelOptionsByThreadId = shallowReactive<Record<string, ModelInfo[]>>({})

  /** 每个 thread 的模型列表加载状态。 */
  const modelOptionsLoadingByThreadId = shallowReactive<Record<string, boolean>>({})

  /** 每个 thread 的命令列表。 */
  const commandsByThreadId = shallowReactive<Record<string, CommandInfo[]>>({})

  /** 每个 thread 的命令列表加载状态。 */
  const commandsLoadingByThreadId = shallowReactive<Record<string, boolean>>({})

  /** 每个 thread 的命令列表是否已完成一次加载。 */
  const commandsLoadedByThreadId = shallowReactive<Record<string, boolean>>({})

  /** 每个 thread 的最近一次 session 操作结果。 */
  const sessionActionMessageByThreadId = shallowReactive<Record<string, string | undefined>>({})
  const sessionActionDetailsByThreadId = shallowReactive<
    Record<string, RunCommandResult['details'] | undefined>
  >({})
  const sessionNotificationsByThreadId = shallowReactive<Record<string, SessionNotification[]>>({})
  let sessionNotificationSequence = 0

  /** 每个 thread 当前正在导航到的 session tree entry。 */
  const navigatingTreeEntryByThreadId = shallowReactive<Record<string, string | undefined>>({})

  /** 每个视图上下文当前是否正在提交 Composer。 */
  const sendingPromptByContextId = shallowReactive<Record<string, boolean>>({})

  const workspaceProject = useWorkspaceProjectStore()

  /** Chat timeline 请求 SessionPanel Tree 定位的 entry。 */
  const treeFocusRequest = ref<{ entryId: string; requestId: number }>()
  const loadingTreeChildrenByEntryId = shallowReactive<Record<string, boolean>>({})
  const sessionTreeBranchesByThreadId = shallowReactive<
    Record<string, WorkspaceSessionTreeBranchesState>
  >({})

  /** 待提交的渲染版本更新。 */
  const pendingRevisions = new Map<string, MessageRenderState>()
  let revisionFlushId: number | null = null

  /** 待提交的 agent message 事件，按 thread + message 合并。 */
  const pendingMessageEvents = new Map<string, AgentMessageIpcEvent>()
  let messageEventFlushId: number | null = null

  /** 待提交的工具更新事件，按 thread + toolCall 合并。 */
  const pendingToolUpdateEvents = new Map<string, ToolUpdateIpcEvent>()
  let toolUpdateEventFlushId: number | null = null
  let deferredSnapshotRefreshTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * 确保指定上下文存在。
   * @param contextId - 上下文 ID。
   * @returns 上下文状态。
   */
  function ensureSessionContext(contextId = defaultSessionContextId): WorkspaceSessionContext {
    contexts[contextId] ??= reactive({
      orphanDraftMessage: createEmptyComposerContent(),
      composerDrafts: {},
      orphanImageAttachments: [],
      composerImageAttachments: {},
      orphanFileAttachments: [],
      composerFileAttachments: {},
      orphanQuoteAttachments: [],
      composerQuoteAttachments: {},
      orphanRunningDelivery: 'steer',
      runningDeliveries: {},
      panel: createUiState(),
      orphanSessionPanelTabsKey:
        contextId === defaultSessionContextId
          ? '__orphan__'
          : createFreshOrphanSessionPanelTabsKey(contextId),
      sessionPanels: {},
      orphanCommands: [],
      orphanCommandsLoading: false,
      orphanCommandsLoaded: false
    }) as WorkspaceSessionContext
    return contexts[contextId]
  }

  /** 默认上下文在 store 创建时初始化，后续 computed 保持纯读。 */
  const mainContextState = ensureSessionContext(defaultSessionContextId)

  /**
   * 获取指定上下文当前 thread 对应的面板 UI 状态。
   * 未选中 thread 时使用上下文 orphan 面板状态。
   * @param contextId - 上下文 ID。
   * @returns 面板 UI 状态。
   */
  function getSessionPanelState(contextId = defaultSessionContextId): SessionUiState {
    const context = ensureSessionContext(contextId)
    if (!context.activeThreadId) {
      context.panel = readStoredSessionPanelState(contextId, undefined) ?? context.panel
      return context.panel
    }
    context.sessionPanels[context.activeThreadId] ??=
      readStoredSessionPanelState(contextId, context.activeThreadId) ?? createUiState()
    return context.sessionPanels[context.activeThreadId]
  }

  /**
   * 纯读取当前面板状态；初始化由上下文切换路径负责。
   * @param contextId - 上下文 ID。
   * @returns 面板 UI 状态。
   */
  function readSessionPanelState(contextId = defaultSessionContextId): SessionUiState {
    const context = contexts[contextId] ?? mainContextState
    if (!context.activeThreadId) {
      return context.panel
    }
    return context.sessionPanels[context.activeThreadId] ?? context.panel
  }

  /**
   * 初始化 thread 绑定的 Composer UI 状态。
   * @param context - 会话上下文。
   * @param threadId - thread ID。
   */
  function initializeThreadComposerState(context: WorkspaceSessionContext, threadId: string): void {
    context.composerDrafts[threadId] ??= createEmptyComposerContent()
    context.composerImageAttachments[threadId] ??= []
    context.composerFileAttachments[threadId] ??= []
    context.composerQuoteAttachments[threadId] ??= []
    context.runningDeliveries[threadId] ??= 'steer'
  }

  /**
   * 确保指定 thread 的运行态存在。
   * @param threadId - thread ID。
   * @returns thread 运行态。
   */
  function ensureRuntime(threadId: string): WorkspaceSessionRuntime {
    runtimeByThreadId[threadId] ??= reactive({
      approvals: {},
      extensionDialogQueue: [],
      extensionDialogDrafts: {},
      extensionDialogResponding: {},
      extensionDialogErrors: {},
      extensionStatuses: {},
      extensionNotifications: [],
      extensionPanels: {},
      extensionPanelMessages: {},
      extensionPanelStates: {},
      events: [],
      timelineEvents: [],
      renderState: {},
      loadingSnapshot: false
    }) as WorkspaceSessionRuntime
    return runtimeByThreadId[threadId]
  }

  /**
   * 获取已有 thread 运行态。
   * @param threadId - thread ID。
   * @returns thread 运行态。
   */
  function getRuntime(threadId: string | undefined): WorkspaceSessionRuntime | undefined {
    return threadId ? runtimeByThreadId[threadId] : undefined
  }

  function initializeExtensionDialogState(
    runtime: WorkspaceSessionRuntime,
    request: ExtensionDialogRequest
  ): void {
    runtime.extensionDialogDrafts[request.id] ??= getExtensionDialogInitialDraft(request)
  }

  function clearExtensionDialogState(runtime: WorkspaceSessionRuntime, requestId: string): void {
    delete runtime.extensionDialogDrafts[requestId]
    delete runtime.extensionDialogResponding[requestId]
    delete runtime.extensionDialogErrors[requestId]
  }

  function replaceExtensionDialogQueue(
    runtime: WorkspaceSessionRuntime,
    requests: ExtensionDialogRequest[]
  ): void {
    const requestIds = new Set(requests.map((request) => request.id))
    for (const requestId of Object.keys(runtime.extensionDialogDrafts)) {
      if (!requestIds.has(requestId)) {
        clearExtensionDialogState(runtime, requestId)
      }
    }
    for (const request of requests) {
      initializeExtensionDialogState(runtime, request)
    }
    runtime.extensionDialogQueue = requests
  }

  /**
   * 确保指定 thread 的工具调用索引存在。
   * @param threadId - thread ID。
   * @returns 工具调用索引。
   */
  function ensureToolCallsById(threadId: string): WorkspaceToolCallsById {
    toolCallsByThreadId[threadId] ??= shallowReactive({} as WorkspaceToolCallsById)
    return toolCallsByThreadId[threadId]
  }

  /**
   * 确保指定 thread 的工具调用结构列表存在。
   * @param threadId - thread ID。
   * @returns 工具调用结构列表。
   */
  function ensureToolCallStructures(threadId: string): WorkspaceToolCallStructure[] {
    toolCallStructuresByThreadId[threadId] ??= shallowReactive([])
    return toolCallStructuresByThreadId[threadId]
  }

  /**
   * 确保指定 thread 的 branch rows 状态存在。
   * @param threadId - thread ID。
   * @returns branch rows 状态。
   */
  function ensureSessionTreeBranchesState(threadId: string): WorkspaceSessionTreeBranchesState {
    sessionTreeBranchesByThreadId[threadId] ??= shallowReactive({
      loading: false,
      revision: 0
    }) as WorkspaceSessionTreeBranchesState
    return sessionTreeBranchesByThreadId[threadId]
  }

  /**
   * 标记指定 thread 的 main 派生 branch 视图需要重新加载。
   * @param threadId - thread ID。
   */
  function invalidateSessionTreeBranches(threadId: string): void {
    const state = sessionTreeBranchesByThreadId[threadId]
    if (!state) {
      return
    }
    state.revision += 1
  }

  /**
   * 从完整 snapshot 同步工具调用索引。
   * @param snapshot - thread snapshot。
   */
  function syncToolCallsByIdFromSnapshot(snapshot: ThreadSnapshot): void {
    const toolCallsById = ensureToolCallsById(snapshot.threadId)
    const nextIds = new Set<string>()
    for (const toolCall of snapshot.toolCalls) {
      nextIds.add(toolCall.toolCallId)
      toolCallsById[toolCall.toolCallId] = toolCall
    }
    for (const toolCallId of Object.keys(toolCallsById)) {
      if (!nextIds.has(toolCallId)) {
        delete toolCallsById[toolCallId]
      }
    }
    syncToolCallStructuresFromSnapshot(snapshot)
  }

  /**
   * 从当前 session snapshot 同步单个工具调用。
   * @param threadId - thread ID。
   * @param toolCallId - 工具调用 ID。
   */
  function syncToolCallByIdFromSession(threadId: string, toolCallId: string): void {
    const toolCall = sessions[threadId]?.snapshot?.toolCalls.find(
      (item) => item.toolCallId === toolCallId
    )
    const toolCallsById = ensureToolCallsById(threadId)
    if (toolCall) {
      toolCallsById[toolCallId] = toolCall
      syncToolCallStructure(threadId, toolCall)
    } else {
      delete toolCallsById[toolCallId]
      removeToolCallStructure(threadId, toolCallId)
    }
  }

  /**
   * 从完整 snapshot 同步工具调用结构。
   * @param snapshot - thread snapshot。
   */
  function syncToolCallStructuresFromSnapshot(snapshot: ThreadSnapshot): void {
    const structures = ensureToolCallStructures(snapshot.threadId)
    structures.splice(0, structures.length, ...snapshot.toolCalls.map(toToolCallStructure))
  }

  /**
   * 同步单个工具调用结构，仅在结构字段变化时替换。
   * @param threadId - thread ID。
   * @param toolCall - 工具调用。
   */
  function syncToolCallStructure(
    threadId: string,
    toolCall: ThreadSnapshot['toolCalls'][number]
  ): void {
    const structures = ensureToolCallStructures(threadId)
    const next = toToolCallStructure(toolCall)
    const index = structures.findIndex((item) => item.toolCallId === toolCall.toolCallId)
    if (index < 0) {
      structures.push(next)
      return
    }
    if (!isSameToolCallStructure(structures[index], next)) {
      structures[index] = next
    }
  }

  /**
   * 移除单个工具调用结构。
   * @param threadId - thread ID。
   * @param toolCallId - 工具调用 ID。
   */
  function removeToolCallStructure(threadId: string, toolCallId: string): void {
    const structures = ensureToolCallStructures(threadId)
    const index = structures.findIndex((item) => item.toolCallId === toolCallId)
    if (index >= 0) {
      structures.splice(index, 1)
    }
  }

  /**
   * 获取上下文选中的 thread ID。
   * @param contextId - 上下文 ID。
   * @returns thread ID。
   */
  function getContextActiveThreadId(contextId = defaultSessionContextId): string | undefined {
    return ensureSessionContext(contextId).activeThreadId
  }

  /**
   * 获取当前窗口会话中保存的活跃 thread ID。
   * @param contextId - 上下文 ID。
   * @returns thread ID。
   */
  function readSessionActiveThreadId(contextId = defaultSessionContextId): string | undefined {
    try {
      return window.sessionStorage?.getItem(getActiveThreadStorageKey(contextId)) || undefined
    } catch {
      return undefined
    }
  }

  /**
   * 保存当前窗口会话中的活跃 thread ID。
   * @param threadId - thread ID。
   * @param contextId - 上下文 ID。
   */
  function writeSessionActiveThreadId(
    threadId: string | undefined,
    contextId = defaultSessionContextId
  ): void {
    try {
      const key = getActiveThreadStorageKey(contextId)
      if (threadId) {
        window.sessionStorage?.setItem(key, threadId)
      } else {
        window.sessionStorage?.removeItem(key)
      }
    } catch {
      // sessionStorage 不可用时降级为内存态，不阻塞主流程。
    }
  }

  function readStoredSessionPanelState(
    contextId = defaultSessionContextId,
    threadId: string | undefined
  ): SessionUiState | undefined {
    try {
      const value = window.localStorage?.getItem(getSessionPanelUiStorageKey(contextId, threadId))
      if (!value) {
        return undefined
      }
      const parsed = JSON.parse(value) as Partial<SessionUiState>
      if (typeof parsed.panelOpen !== 'boolean' || typeof parsed.panelWidth !== 'number') {
        return undefined
      }
      return {
        panelOpen: parsed.panelOpen,
        panelWidth: Math.max(minSessionPanelWidth, parsed.panelWidth)
      }
    } catch {
      return undefined
    }
  }

  function writeStoredSessionPanelState(
    contextId: string,
    state: SessionUiState,
    threadId = ensureSessionContext(contextId).activeThreadId
  ): void {
    writeStoredSessionPanelStateByKey(contextId, threadId, state)
  }

  function writeStoredSessionPanelStateByKey(
    contextId: string,
    threadId: string | undefined,
    state: SessionUiState
  ): void {
    try {
      window.localStorage?.setItem(
        getSessionPanelUiStorageKey(contextId, threadId),
        JSON.stringify(cloneUiState(state))
      )
    } catch {
      // localStorage 不可用时降级为内存态，不阻塞主流程。
    }
  }

  function getSessionPanelUiStorageKey(
    contextId = defaultSessionContextId,
    threadId: string | undefined
  ): string {
    return `${sessionPanelUiStoragePrefix}${contextId}.${threadId ?? '__orphan__'}`
  }

  /**
   * 设置上下文选中的 thread ID。
   * @param threadId - thread ID。
   * @param contextId - 上下文 ID。
   */
  function setContextActiveThreadId(
    threadId: string | undefined,
    contextId = defaultSessionContextId
  ): void {
    const context = ensureSessionContext(contextId)
    context.activeThreadId = threadId
    writeSessionActiveThreadId(threadId, contextId)
    if (threadId) {
      context.sessionPanels[threadId] ??=
        readStoredSessionPanelState(contextId, threadId) ?? createUiState()
      initializeThreadComposerState(context, threadId)
      context.selectedProjectId = sessions[threadId]?.projectId ?? context.selectedProjectId
      if (context.selectedProjectId) {
        workspaceProject.setActiveProjectId(context.selectedProjectId)
      }
    }
  }

  /**
   * 进入未绑定 thread 的新会话草稿态。
   * @param projectId - 草稿所属 Project ID。
   * @param contextId - 上下文 ID。
   */
  function startNewSession(projectId: string, contextId = defaultSessionContextId): void {
    const context = ensureSessionContext(contextId)
    context.activeThreadId = undefined
    writeSessionActiveThreadId(undefined, contextId)
    context.orphanCommands = []
    context.orphanCommandsLoaded = false
    context.selectedProjectId = projectId
    workspaceProject.setActiveProjectId(projectId)
    globalErrorMessage.value = undefined
    if (workspaceProject.projects[projectId]) {
      const generation = (orphanCommandsRequestGenerationByContextId[contextId] ?? 0) + 1
      orphanCommandsRequestGenerationByContextId[contextId] = generation
      void loadOrphanCommands(contextId, generation)
    }
  }

  /**
   * 获取指定上下文的 Composer 草稿桶。
   * @param contextId - 上下文 ID。
   * @returns Composer 草稿桶。
   */
  function getContextComposerDrafts(
    contextId = defaultSessionContextId
  ): Record<string, JSONContent> {
    return ensureSessionContext(contextId).composerDrafts
  }

  /**
   * 清理已不存在 thread 的上下文草稿与运行态，避免长期使用内存增长。
   * @param existingThreadIds - 当前存在的 thread ID 集合。
   */
  function pruneThreadScopedState(existingThreadIds: Set<string>): void {
    for (const threadId of Object.keys(sessions)) {
      if (!existingThreadIds.has(threadId)) {
        delete sessions[threadId]
      }
    }
    for (const threadId of Object.keys(runtimeByThreadId)) {
      if (!existingThreadIds.has(threadId)) {
        delete runtimeByThreadId[threadId]
      }
    }
    for (const threadId of Object.keys(toolCallsByThreadId)) {
      if (!existingThreadIds.has(threadId)) {
        delete toolCallsByThreadId[threadId]
      }
    }
    for (const threadId of Object.keys(toolCallStructuresByThreadId)) {
      if (!existingThreadIds.has(threadId)) {
        delete toolCallStructuresByThreadId[threadId]
      }
    }
    for (const threadId of Object.keys(modelOptionsByThreadId)) {
      if (!existingThreadIds.has(threadId)) {
        delete modelOptionsByThreadId[threadId]
      }
    }
    for (const threadId of Object.keys(modelOptionsLoadingByThreadId)) {
      if (!existingThreadIds.has(threadId)) {
        delete modelOptionsLoadingByThreadId[threadId]
      }
    }
    for (const threadId of Object.keys(commandsByThreadId)) {
      if (!existingThreadIds.has(threadId)) {
        delete commandsByThreadId[threadId]
      }
    }
    for (const threadId of Object.keys(commandsLoadingByThreadId)) {
      if (!existingThreadIds.has(threadId)) {
        delete commandsLoadingByThreadId[threadId]
      }
    }
    for (const threadId of Object.keys(commandsLoadedByThreadId)) {
      if (!existingThreadIds.has(threadId)) {
        delete commandsLoadedByThreadId[threadId]
      }
    }
    for (const threadId of Object.keys(sessionTreeBranchesByThreadId)) {
      if (!existingThreadIds.has(threadId)) {
        delete sessionTreeBranchesByThreadId[threadId]
      }
    }
    for (const context of Object.values(contexts)) {
      if (context.activeThreadId && !existingThreadIds.has(context.activeThreadId)) {
        context.activeThreadId = undefined
      }
      for (const threadId of Object.keys(context.composerDrafts)) {
        if (!existingThreadIds.has(threadId)) {
          delete context.composerDrafts[threadId]
        }
      }
      for (const threadId of Object.keys(context.composerImageAttachments)) {
        if (!existingThreadIds.has(threadId)) {
          delete context.composerImageAttachments[threadId]
        }
      }
      for (const threadId of Object.keys(context.composerFileAttachments)) {
        if (!existingThreadIds.has(threadId)) {
          delete context.composerFileAttachments[threadId]
        }
      }
      for (const threadId of Object.keys(context.composerQuoteAttachments)) {
        if (!existingThreadIds.has(threadId)) {
          delete context.composerQuoteAttachments[threadId]
        }
      }
      for (const threadId of Object.keys(context.runningDeliveries)) {
        if (!existingThreadIds.has(threadId)) {
          delete context.runningDeliveries[threadId]
        }
      }
    }
  }

  /**
   * 将 pending 的版本更新 flush 到响应式状态。
   */
  function flushRevisionUpdates(): void {
    revisionFlushId = null
    for (const [id, state] of pendingRevisions) {
      const { threadId, messageId } = parseMessageRenderStateKey(id)
      ensureRuntime(threadId).renderState[messageId] = { ...state }
    }
    pendingRevisions.clear()
  }

  /**
   * 递增指定消息的渲染版本号。
   * 同一帧内多次更新会合并为一次响应式提交。
   * @param messageId - 消息 ID。
   * @param renderState - 当前渲染状态。
   */
  function getMessageRenderStateKey(threadId: string, messageId: string): string {
    return `${threadId}:${messageId}`
  }

  function bumpMessageRevision(
    threadId: string,
    messageId: string,
    renderState: 'streaming' | 'complete'
  ): void {
    const key = getMessageRenderStateKey(threadId, messageId)
    const existing = pendingRevisions.get(key) ?? ensureRuntime(threadId).renderState[messageId]
    const next: MessageRenderState = {
      revision: (existing?.revision ?? 0) + 1,
      renderState
    }
    pendingRevisions.set(key, next)
    if (revisionFlushId === null) {
      revisionFlushId = requestAnimationFrame(flushRevisionUpdates)
    }
  }

  /**
   * 将 pending 的 agent message 事件 flush 到 snapshot。
   */
  function flushPendingMessageEvents(): void {
    messageEventFlushId = null
    const events = [...pendingMessageEvents.values()]
    pendingMessageEvents.clear()
    for (const event of events) {
      applyEventToSessions(sessions, event, (messageId, renderState) => {
        bumpMessageRevision(event.threadId, messageId, renderState)
      })
      syncToolCallsFromMessageEvent(event)
      if (event.type === 'message_end') {
        invalidateSessionTreeBranches(event.threadId)
      }
    }

    // Snapshot 和 revision 在同一任务内提交，让 Vue 每个 token 批次只渲染一次。
    if (revisionFlushId !== null) {
      cancelAnimationFrame(revisionFlushId)
      revisionFlushId = null
    }
    if (pendingRevisions.size > 0) {
      flushRevisionUpdates()
    }
  }

  /**
   * 将 pending 的工具更新事件 flush 到 snapshot。
   */
  function flushPendingToolUpdateEvents(): void {
    toolUpdateEventFlushId = null
    const events = [...pendingToolUpdateEvents.values()]
    pendingToolUpdateEvents.clear()
    for (const event of events) {
      applyEventToSessions(sessions, event)
      syncToolCallByIdFromSession(event.threadId, event.toolCallId)
    }
  }

  /**
   * 丢弃 authoritative snapshot 之前为指定 thread 排队的增量事件。
   * Tree 导航会缩短当前 branch；旧分支事件若在下一帧才 flush，会把已隐藏的尾部重新追加回来。
   */
  function discardPendingProjectionEvents(threadId: string): void {
    for (const [key, event] of pendingMessageEvents) {
      if (event.threadId === threadId) pendingMessageEvents.delete(key)
    }
    for (const [key, event] of pendingToolUpdateEvents) {
      if (event.threadId === threadId) pendingToolUpdateEvents.delete(key)
    }
    for (const key of pendingRevisions.keys()) {
      if (parseMessageRenderStateKey(key).threadId === threadId) pendingRevisions.delete(key)
    }
  }

  /**
   * 合并 agent message 事件到下一帧提交。
   * @param event - agent message IPC 事件。
   */
  function scheduleMessageEvent(event: AgentMessageIpcEvent): void {
    const session = sessions[event.threadId]
    const snapshot = session?.snapshot
    const content = toDesktopMessageContent(event.message)
    if (!snapshot || !content) {
      applyEventToSessions(sessions, event, (messageId, renderState) => {
        bumpMessageRevision(event.threadId, messageId, renderState)
      })
      syncToolCallsFromMessageEvent(event)
      if (event.type === 'message_end') {
        invalidateSessionTreeBranches(event.threadId)
      }
      return
    }

    syncToolCallsFromMessageEvent(event)
    const messageId = getPiMessageId(snapshot.messages, content)
    pendingMessageEvents.set(getMessageRenderStateKey(event.threadId, messageId), event)
    if (messageEventFlushId === null) {
      messageEventFlushId = requestAnimationFrame(flushPendingMessageEvents)
    }
  }

  /**
   * 从 assistant message event 中同步已具名工具结构。
   * @param event - agent message IPC 事件。
   */
  function syncToolCallsFromMessageEvent(event: AgentMessageIpcEvent): void {
    const snapshot = sessions[event.threadId]?.snapshot
    if (snapshot) {
      applyAssistantToolCallBlocks(snapshot, event.message)
    }
    for (const toolCallId of getNamedAssistantToolCallIds(event.message)) {
      syncToolCallByIdFromSession(event.threadId, toolCallId)
    }
  }

  /**
   * 合并工具 update 事件到下一帧提交。
   * @param event - 工具更新事件。
   */
  function scheduleToolUpdateEvent(event: ToolUpdateIpcEvent): void {
    pendingToolUpdateEvents.set(getToolUpdateEventKey(event), event)
    if (toolUpdateEventFlushId === null) {
      toolUpdateEventFlushId = requestAnimationFrame(flushPendingToolUpdateEvents)
    }
  }

  /**
   * 获取消息的渲染状态，未记录时返回初始状态。
   * @param messageId - 消息 ID。
   * @returns 渲染状态。
   */
  function getMessageRenderState(threadId: string, messageId: string): MessageRenderState {
    return (
      getRuntime(threadId)?.renderState[messageId] ?? {
        revision: 1,
        renderState: 'complete'
      }
    )
  }

  /**
   * 从完整快照同步消息渲染状态。
   * @param snapshot - 线程快照。
   * @param streamingMessageIds - snapshot 刷新期间从 renderer live 投影保留的消息 ID。
   */
  function syncRenderStateFromSnapshot(
    snapshot: ThreadSnapshot,
    streamingMessageIds: ReadonlySet<string> = new Set()
  ): void {
    const runtime = ensureRuntime(snapshot.threadId)
    const messageIds = new Set(snapshot.messages.map((message) => message.id))
    for (const messageId of Object.keys(runtime.renderState)) {
      if (!messageIds.has(messageId)) {
        delete runtime.renderState[messageId]
      }
    }
    for (const message of snapshot.messages) {
      runtime.renderState[message.id] = {
        revision: runtime.renderState[message.id]?.revision ?? 1,
        renderState: streamingMessageIds.has(message.id) ? 'streaming' : 'complete'
      }
    }
  }

  /** 以 worker live snapshot 为准同步等待用户响应的交互。 */
  function syncPendingInteractionsFromSnapshot(snapshot: ThreadSnapshot): void {
    const runtime = ensureRuntime(snapshot.threadId)
    runtime.approvals = Object.fromEntries(
      snapshot.approvals.map((approval) => [approval.approvalId, approval])
    )
    replaceExtensionDialogQueue(runtime, snapshot.extensionDialogs ?? [])
  }

  /** 默认上下文。 */
  const mainContext = computed(() => mainContextState)

  /** 当前活跃会话 ID。 */
  const activeSessionId = computed(() => mainContext.value.activeThreadId)

  /** 当前活跃会话对象。 */
  const activeSession = computed(() => {
    return activeSessionId.value ? sessions[activeSessionId.value] : undefined
  })

  /** 当前活跃会话的快照。 */
  const activeSnapshot = computed(() => activeSession.value?.snapshot)

  /** 当前活跃会话的工具调用索引。 */
  const activeToolCallsById = computed<WorkspaceToolCallsById>(() =>
    activeSessionId.value
      ? (toolCallsByThreadId[activeSessionId.value] ?? emptyToolCallsById)
      : emptyToolCallsById
  )

  /** 当前活跃会话的工具调用结构列表。 */
  const activeToolCallStructures = computed<WorkspaceToolCallStructure[]>(() =>
    activeSessionId.value
      ? (toolCallStructuresByThreadId[activeSessionId.value] ?? emptyToolCallStructures)
      : emptyToolCallStructures
  )

  /** 当前活跃或新会话草稿所属 Project ID。 */
  const activeProjectId = computed(
    () =>
      activeSession.value?.projectId ??
      mainContext.value.selectedProjectId ??
      workspaceProject.activeProjectId
  )

  /** 当前是否处于尚未创建 thread 的新会话草稿态。 */
  const isNewSessionActive = computed(
    () => !activeSessionId.value && Boolean(mainContext.value.selectedProjectId)
  )

  /** 当前活跃 thread 的运行态。 */
  const activeRuntime = computed(() => getRuntime(activeSessionId.value))

  /** 当前活跃会话面板状态。 */
  const activeSessionPanel = computed(() => readSessionPanelState(defaultSessionContextId))

  /** 当前活跃会话的审批请求。 */
  const activePendingApprovals = computed(() => activeRuntime.value?.approvals ?? {})

  /** 当前活跃会话按到达顺序排列的 extension 对话框。 */
  const activeExtensionDialogs = computed(() => activeRuntime.value?.extensionDialogQueue ?? [])

  /** 当前需要优先响应的 extension 对话框。 */
  const activeExtensionDialog = computed(() => activeExtensionDialogs.value[0])

  const activeExtensionDialogDrafts = computed(
    () => activeRuntime.value?.extensionDialogDrafts ?? {}
  )
  const activeExtensionDialogResponding = computed(
    () => activeRuntime.value?.extensionDialogResponding ?? {}
  )
  const activeExtensionDialogErrors = computed(
    () => activeRuntime.value?.extensionDialogErrors ?? {}
  )

  /** 当前活跃会话的 extension 状态文本。 */
  const activeExtensionStatuses = computed(() => activeRuntime.value?.extensionStatuses ?? {})

  /** 当前活跃会话的 extension notify 完整内容。 */
  const activeExtensionNotifications = computed(
    () => activeRuntime.value?.extensionNotifications ?? []
  )

  /** Desktop 内置扩展无需等待 thread worker 即可展示的原生 panel。 */
  const builtinExtensionPanels: Record<string, DesktopExtensionWebviewPanel> = {
    'browser-preview': {
      id: 'browser-preview',
      viewType: 'meta.browser-preview',
      title: 'Browser',
      icon: 'globe',
      order: 15,
      retainContextWhenHidden: true,
      source: { type: 'native', component: 'browser-preview' }
    },
    'hermes-memory': {
      id: 'hermes-memory',
      viewType: 'pi.hermes-memory',
      title: '记忆',
      icon: 'brain',
      order: 35,
      source: { type: 'native', component: 'memory' }
    }
  }

  /** 当前活跃会话的 desktop extension panels，包含无需 runtime 的 Desktop 内置 panel。 */
  const activeExtensionPanels = computed<Record<string, DesktopExtensionWebviewPanel>>(() => ({
    ...builtinExtensionPanels,
    ...(activeRuntime.value?.extensionPanels ?? {})
  }))

  /** 当前活跃会话的 desktop extension panel 消息。 */
  const activeExtensionPanelMessages = computed(
    () => activeRuntime.value?.extensionPanelMessages ?? {}
  )

  /** 当前活跃会话的 desktop extension panel 持久状态。 */
  const activeExtensionPanelStates = computed(() => activeRuntime.value?.extensionPanelStates ?? {})

  /** 当前活跃会话的 extension 标题。 */
  const activeExtensionTitle = computed(() => activeRuntime.value?.extensionTitle)

  /** 当前活跃会话的 extension 工作中文案。 */
  const activeExtensionWorkingMessage = computed(() => activeRuntime.value?.extensionWorkingMessage)

  /** 当前活跃会话的 extension 工作行可见性。 */
  const activeExtensionWorkingVisible = computed(() => activeRuntime.value?.extensionWorkingVisible)

  /** 当前活跃会话的 extension 工作指示器。 */
  const activeExtensionWorkingIndicator = computed(
    () => activeRuntime.value?.extensionWorkingIndicator
  )

  /** 当前活跃会话的 extension 隐藏 thinking 标签。 */
  const activeExtensionHiddenThinkingLabel = computed(
    () => activeRuntime.value?.extensionHiddenThinkingLabel
  )

  /** 当前活跃会话的 extension 工具输出展开状态。 */
  const activeExtensionToolsExpanded = computed(() => activeRuntime.value?.extensionToolsExpanded)

  /** 当前活跃会话的自动重试状态。 */
  const activeRetryState = computed(() => activeRuntime.value?.retry)

  /** 当前活跃会话的上下文压缩状态。 */
  const activeCompactionState = computed(() => activeRuntime.value?.compaction)

  /** 当前活跃会话最近一次导出结果。 */
  const activeExportResult = computed(() => activeRuntime.value?.lastExport)

  /** 当前活跃会话可快速切回的上一个 session 文件。 */
  const activePreviousSessionFile = computed(() => activeRuntime.value?.previousSessionFile)

  /** 当前活跃会话可快速返回的上一个 leaf entry。 */
  const activePreviousLeafEntryId = computed(() => activeRuntime.value?.previousLeafEntryId)

  /** 当前活跃会话的 main 派生 branch 视图状态。 */
  const activeSessionTreeBranchesState = computed(() =>
    activeSessionId.value ? sessionTreeBranchesByThreadId[activeSessionId.value] : undefined
  )

  /** 当前活跃会话的 main 派生 branch 视图结果。 */
  const activeSessionTreeBranches = computed(() => activeSessionTreeBranchesState.value?.result)

  /** 当前活跃会话 branch 视图是否正在加载。 */
  const activeSessionTreeBranchesLoading = computed(() =>
    Boolean(activeSessionTreeBranchesState.value?.loading)
  )

  /** 当前活跃会话 branch 视图最近一次错误。 */
  const activeSessionTreeBranchesError = computed(
    () => activeSessionTreeBranchesState.value?.errorMessage
  )

  /** 当前活跃会话的最近事件。 */
  const activeEvents = computed(() => activeRuntime.value?.events ?? [])

  /** 当前活跃会话的 renderer-only timeline 事件。 */
  const activeRuntimeTimelineEvents = computed(() => activeRuntime.value?.timelineEvents ?? [])

  /** 当前活跃会话的可用模型。 */
  const activeModelOptions = computed<ModelInfo[]>(() =>
    activeSessionId.value ? (modelOptionsByThreadId[activeSessionId.value] ?? []) : []
  )

  /** 当前活跃会话是否正在加载可用模型。 */
  const activeModelOptionsLoading = computed(() =>
    activeSessionId.value ? Boolean(modelOptionsLoadingByThreadId[activeSessionId.value]) : false
  )

  /** 当前活跃会话的可用命令。 */
  const activeCommands = computed<CommandInfo[]>(() =>
    activeSessionId.value
      ? (commandsByThreadId[activeSessionId.value] ?? [])
      : mainContext.value.orphanCommands
  )

  /** 当前活跃会话命令列表是否加载中。 */
  const activeCommandsLoading = computed(() =>
    activeSessionId.value
      ? Boolean(commandsLoadingByThreadId[activeSessionId.value])
      : mainContext.value.orphanCommandsLoading
  )

  /** 当前活跃会话命令列表是否已按需加载。 */
  const activeCommandsLoaded = computed(() =>
    activeSessionId.value
      ? Boolean(commandsLoadedByThreadId[activeSessionId.value])
      : mainContext.value.orphanCommandsLoaded
  )

  /** 当前活跃会话最近一次 session 操作结果。 */
  const activeSessionActionMessage = computed(() =>
    activeSessionId.value ? sessionActionMessageByThreadId[activeSessionId.value] : undefined
  )
  const activeSessionActionDetails = computed(() =>
    activeSessionId.value ? sessionActionDetailsByThreadId[activeSessionId.value] : undefined
  )
  const activeSessionNotifications = computed(() =>
    activeSessionId.value ? (sessionNotificationsByThreadId[activeSessionId.value] ?? []) : []
  )
  const activeNavigatingTreeEntryId = computed(() =>
    activeSessionId.value ? navigatingTreeEntryByThreadId[activeSessionId.value] : undefined
  )

  /** 清除当前活跃会话的 session action 提示。 */
  const clearActiveSessionAction = (): void => {
    const threadId = activeSessionId.value
    if (!threadId) {
      return
    }
    delete sessionActionMessageByThreadId[threadId]
    delete sessionActionDetailsByThreadId[threadId]
  }

  const pushSessionNotification = (threadId: string, message: string): void => {
    if (!message.trim()) {
      return
    }
    const notifications = sessionNotificationsByThreadId[threadId] ?? []
    const notification: SessionNotification = {
      id: `${Date.now()}-${++sessionNotificationSequence}`,
      message
    }
    sessionNotificationsByThreadId[threadId] = [...notifications, notification].slice(
      -MAX_SESSION_NOTIFICATIONS
    )
  }

  const dismissSessionNotification = (
    notificationId: string,
    threadId = activeSessionId.value
  ): void => {
    if (!threadId) {
      return
    }
    const notifications = sessionNotificationsByThreadId[threadId]
    if (!notifications?.length) {
      return
    }
    const nextNotifications = notifications.filter(
      (notification) => notification.id !== notificationId
    )
    if (nextNotifications.length) {
      sessionNotificationsByThreadId[threadId] = nextNotifications
    } else {
      delete sessionNotificationsByThreadId[threadId]
    }
  }

  /** 新会话草稿模型。 */
  const orphanModel = computed(() => mainContext.value.orphanModel)

  /** 新会话草稿 thinking level。 */
  const orphanThinkingLevel = computed(() => mainContext.value.orphanThinkingLevel)

  /** 当前 panel tabs 使用的 thread 或新会话草稿 key。 */
  const activeSessionPanelTabsKey = computed(
    () => activeSessionId.value ?? mainContext.value.orphanSessionPanelTabsKey
  )

  /** 当前活跃会话的 Composer 草稿，按 session 隔离。 */
  const draftMessage = computed({
    get: () => {
      const threadId = activeSessionId.value
      const context = mainContext.value
      return threadId
        ? (context.composerDrafts[threadId] ?? emptyComposerDraft)
        : context.orphanDraftMessage
    },
    set: (value: JSONContent) => {
      const threadId = activeSessionId.value
      const context = mainContext.value
      if (!threadId) {
        context.orphanDraftMessage = value
        return
      }
      context.composerDrafts[threadId] = value
    }
  })

  /** 当前活跃会话的 Composer 图片附件，按 session 隔离。 */
  const draftImages = computed(() => {
    const threadId = activeSessionId.value
    const context = mainContext.value
    return threadId
      ? (context.composerImageAttachments[threadId] ?? emptyComposerImages)
      : context.orphanImageAttachments
  })

  /** 当前活跃会话的 Composer 文件路径附件，按 session 隔离。 */
  const draftFiles = computed(() => {
    const threadId = activeSessionId.value
    const context = mainContext.value
    return threadId
      ? (context.composerFileAttachments[threadId] ?? emptyComposerFiles)
      : context.orphanFileAttachments
  })

  /** 当前活跃会话的 Composer 文本引用，按 session 隔离。 */
  const draftQuotes = computed(() => {
    const threadId = activeSessionId.value
    const context = mainContext.value
    return threadId
      ? (context.composerQuoteAttachments[threadId] ?? emptyComposerQuotes)
      : context.orphanQuoteAttachments
  })

  /** 当前活跃会话运行中消息交付方式，按 session 隔离。 */
  const runningDelivery = computed({
    get: (): RunningMessageDelivery => {
      const threadId = activeSessionId.value
      const context = mainContext.value
      return threadId
        ? (context.runningDeliveries[threadId] ?? 'steer')
        : context.orphanRunningDelivery
    },
    set: (value: RunningMessageDelivery) => {
      const threadId = activeSessionId.value
      const context = mainContext.value
      if (!threadId) {
        context.orphanRunningDelivery = value
        return
      }
      context.runningDeliveries[threadId] = value
    }
  })

  /** 当前活跃会话是否有可发送草稿。 */
  const hasDraftMessage = computed(
    () =>
      Boolean(getComposerText(draftMessage.value).trim()) ||
      draftImages.value.length > 0 ||
      draftFiles.value.length > 0 ||
      draftQuotes.value.length > 0
  )

  /** 默认上下文 Composer 是否正在提交。 */
  const isSendingPrompt = computed(() => Boolean(sendingPromptByContextId[defaultSessionContextId]))

  /** 会话列表，最近更新排在最上面。 */
  const sessionList = computed(() => sortSessionsByUpdatedAt(Object.values(sessions)))

  /** 按 Project ID 分组的会话列表。 */
  const sessionsByProject = computed(() =>
    sessionList.value.reduce<Record<string, WorkspaceSession[]>>((groups, session) => {
      groups[session.projectId] ??= []
      groups[session.projectId].push(session)
      return groups
    }, {})
  )

  /** 错误提示信息，优先显示当前 active thread 错误。 */
  const errorMessage = computed(() => activeRuntime.value?.errorMessage ?? globalErrorMessage.value)

  /** 是否正在加载，包含 thread 列表与当前 active snapshot。 */
  const loading = computed(
    () => loadingThreads.value || Boolean(activeRuntime.value?.loadingSnapshot)
  )

  /**
   * 加载所有 thread 列表。
   * 仅刷新仍然有效的活跃 thread；没有活跃 thread 时默认保持新会话空态。
   */
  const loadThreads = async (
    contextId = defaultSessionContextId,
    options: {
      deferActiveSnapshot?: boolean
      selectLatestActiveProjectThread?: boolean
      restoreActiveThread?: boolean
    } = {}
  ): Promise<void> => {
    loadingThreads.value = true
    globalErrorMessage.value = undefined
    try {
      const loadedThreads = await window.api.codingAgent.listThreads()
      const threads = loadedThreads.filter((thread) => !thread.archivedAt)
      for (const thread of threads) {
        mergeSession(sessions, thread)
        ensureRuntime(thread.threadId)
      }
      pruneThreadScopedState(new Set(threads.map((thread) => thread.threadId)))
      const context = ensureSessionContext(contextId)
      const storedActiveThreadId = readSessionActiveThreadId(contextId)
      if (
        options.restoreActiveThread !== false &&
        !context.activeThreadId &&
        storedActiveThreadId &&
        threads.some((thread) => thread.threadId === storedActiveThreadId)
      ) {
        setContextActiveThreadId(storedActiveThreadId, contextId)
      }
      const activeExists =
        context.activeThreadId &&
        threads.some((thread) => thread.threadId === context.activeThreadId)
      if (!activeExists) {
        setContextActiveThreadId(undefined, contextId)
      }
      if (
        !context.activeThreadId &&
        options.selectLatestActiveProjectThread &&
        workspaceProject.activeProjectId
      ) {
        const projectThreads = sortSessionsByUpdatedAt(
          threads.filter((thread) => thread.projectId === workspaceProject.activeProjectId)
        )
        context.selectedProjectId = workspaceProject.activeProjectId
        setContextActiveThreadId(projectThreads[0]?.threadId, contextId)
      } else if (!context.activeThreadId && workspaceProject.activeProjectId) {
        context.selectedProjectId = workspaceProject.activeProjectId
      }
      if (context.activeThreadId) {
        if (options.deferActiveSnapshot) {
          scheduleDeferredSnapshotRefresh(context.activeThreadId, contextId)
        } else {
          await refreshSnapshot(context.activeThreadId)
        }
      }
    } catch (error) {
      globalErrorMessage.value = error instanceof Error ? error.message : String(error)
    } finally {
      loadingThreads.value = false
    }
  }

  /**
   * 在指定 Project 下创建新 thread。
   * @param projectId - Project ID。
   */
  const createThread = async (
    projectId: string,
    contextId = defaultSessionContextId,
    options: Pick<
      CreateThreadInput,
      'sessionFile' | 'title' | 'cwdOverride' | 'initialModel' | 'thinkingLevel'
    > = {}
  ): Promise<ThreadSnapshot | undefined> => {
    if (!projectId) {
      globalErrorMessage.value = '请先打开 Project'
      return undefined
    }
    loadingThreads.value = true
    globalErrorMessage.value = undefined
    try {
      const snapshot = await window.api.codingAgent.createThread({ projectId, ...options })
      mergeSnapshot(sessions, snapshot)
      syncToolCallsByIdFromSnapshot(snapshot)
      ensureRuntime(snapshot.threadId)
      syncRenderStateFromSnapshot(snapshot)
      setContextActiveThreadId(snapshot.threadId, contextId)
      workspaceProject.setActiveProjectId(snapshot.projectId)
      return snapshot
    } catch (error) {
      globalErrorMessage.value = error instanceof Error ? error.message : String(error)
      return undefined
    } finally {
      loadingThreads.value = false
    }
  }

  /**
   * 刷新指定 thread 的快照。
   * @param threadId - 目标 thread ID，默认当前活跃会话。
   */
  const refreshSnapshot = async (threadId = activeSessionId.value): Promise<void> => {
    if (!threadId) {
      return
    }
    const runtime = ensureRuntime(threadId)
    runtime.loadingSnapshot = true
    runtime.errorMessage = undefined
    try {
      const incomingSnapshot = await window.api.codingAgent.getSnapshot(threadId)
      const existing = sessions[threadId]
      const streamingMessageIds = getStreamingMessageIds(runtime)
      const snapshot = preserveStreamingMessages(
        existing?.snapshot,
        incomingSnapshot,
        streamingMessageIds
      )
      const summary = snapshotToSummary(snapshot)
      mergeSession(sessions, {
        ...(existing ?? snapshotToSession(snapshot)),
        ...summary,
        createdAt: existing?.createdAt ?? summary.createdAt,
        updatedAt: existing?.updatedAt ?? summary.updatedAt,
        snapshot
      })
      syncToolCallsByIdFromSnapshot(snapshot)
      syncPendingInteractionsFromSnapshot(snapshot)
      syncRenderStateFromSnapshot(snapshot, streamingMessageIds)
    } catch (error) {
      runtime.errorMessage = error instanceof Error ? error.message : String(error)
    } finally {
      runtime.loadingSnapshot = false
    }
  }

  /**
   * 首屏启动路径延后后台 snapshot 刷新，避免在完整 IPC 注册前触发 preload 重试。
   * 用户显式切换会话仍走即时 refreshSnapshot。
   */
  function scheduleDeferredSnapshotRefresh(threadId: string, contextId: string): void {
    if (deferredSnapshotRefreshTimer) {
      clearTimeout(deferredSnapshotRefreshTimer)
    }

    deferredSnapshotRefreshTimer = setTimeout(() => {
      deferredSnapshotRefreshTimer = undefined
      const context = contexts[contextId] ?? mainContextState
      if (context.activeThreadId !== threadId || sessions[threadId]?.snapshot) {
        return
      }
      void refreshSnapshot(threadId)
    }, DEFERRED_SNAPSHOT_REFRESH_DELAY_MS)
  }

  /**
   * 加载指定会话可用模型列表。
   * @param threadId - 目标 thread ID，默认当前活跃会话。
   */
  const loadModelOptions = async (threadId = activeSessionId.value): Promise<void> => {
    if (!threadId) {
      return
    }
    modelOptionsLoadingByThreadId[threadId] = true
    ensureRuntime(threadId).errorMessage = undefined
    try {
      modelOptionsByThreadId[threadId] = await window.api.codingAgent.listModels(threadId)
    } catch (error) {
      ensureRuntime(threadId).errorMessage = error instanceof Error ? error.message : String(error)
    } finally {
      modelOptionsLoadingByThreadId[threadId] = false
    }
  }

  /**
   * 在新会话草稿态按 Project 发现可展示的 extension commands。
   * 该路径只读取 resource snapshot，不创建 thread / session。
   */
  const loadOrphanCommands = async (
    contextId = defaultSessionContextId,
    generation = orphanCommandsRequestGenerationByContextId[contextId]
  ): Promise<void> => {
    const context = ensureSessionContext(contextId)
    const projectId = context.selectedProjectId
    const project = projectId ? workspaceProject.projects[projectId] : undefined
    if (!project) {
      globalErrorMessage.value = '请先选择 Project'
      return
    }
    context.orphanCommandsLoading = true
    globalErrorMessage.value = undefined
    try {
      const snapshot = await window.api.codingAgent.getResourceSnapshot({
        cwd: project.path,
        projectTrusted: project.trust?.state === 'trusted' || project.trust?.state === 'notRequired'
      })
      const extensionCommands = snapshot.extensions.flatMap((extension) =>
        extension.commands.map((command) => ({
          name: command.name,
          description: command.description,
          source: 'extension' as const,
          sourceInfo: extension.sourceInfo
        }))
      )
      const skillCommands =
        snapshot.skillCommands ??
        snapshot.resources.skills
          .filter((skill) => skill.enabled)
          .map((skill) => ({
            name: `skill:${getSkillNameFromPath(skill.path)}`,
            source: 'skill' as const,
            sourceInfo: skill.sourceInfo
          }))
      if (
        context.activeThreadId ||
        context.selectedProjectId !== projectId ||
        orphanCommandsRequestGenerationByContextId[contextId] !== generation
      ) {
        return
      }
      context.orphanCommands = mergeCommandInfos(
        getBuiltinCommandInfos(),
        extensionCommands,
        skillCommands
      )
      context.orphanCommandsLoaded = true
    } catch (error) {
      if (
        !context.activeThreadId &&
        context.selectedProjectId === projectId &&
        orphanCommandsRequestGenerationByContextId[contextId] === generation
      ) {
        globalErrorMessage.value = error instanceof Error ? error.message : String(error)
      }
    } finally {
      if (orphanCommandsRequestGenerationByContextId[contextId] === generation) {
        context.orphanCommandsLoading = false
      }
    }
  }

  /**
   * 设置当前活跃会话模型。
   * @param provider - provider。
   * @param modelId - 模型 ID。
   */
  const setActiveModel = async (
    provider: string,
    modelId: string,
    threadId = activeSessionId.value
  ): Promise<void> => {
    if (!threadId) {
      mainContext.value.orphanModel = { provider, modelId }
      return
    }
    ensureRuntime(threadId).errorMessage = undefined
    try {
      await window.api.codingAgent.setModel({ threadId, provider, modelId })
      await refreshSnapshot(threadId)
    } catch (error) {
      ensureRuntime(threadId).errorMessage = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * 循环切换当前活跃会话模型。
   */
  const cycleActiveModel = async (threadId = activeSessionId.value): Promise<void> => {
    if (!threadId) {
      return
    }
    const runtime = ensureRuntime(threadId)
    runtime.errorMessage = undefined
    try {
      const result = await window.api.codingAgent.cycleModel(threadId)
      if (result) {
        pushSessionNotification(threadId, `已切换模型到 ${getModelLabel(result.model)}`)
      } else {
        pushSessionNotification(threadId, '没有可切换的模型')
      }
      await refreshSnapshot(threadId)
    } catch (error) {
      runtime.errorMessage = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * 设置当前活跃会话 thinking level。
   * @param level - thinking level。
   * @param threadId - 目标 thread ID。
   */
  const setActiveThinkingLevel = async (
    level: ThinkingLevel,
    threadId = activeSessionId.value
  ): Promise<void> => {
    if (!threadId) {
      mainContext.value.orphanThinkingLevel = level
      return
    }
    const runtime = ensureRuntime(threadId)
    runtime.errorMessage = undefined
    try {
      await window.api.codingAgent.setThinkingLevel({ threadId, level })
      await refreshSnapshot(threadId)
    } catch (error) {
      runtime.errorMessage = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * 循环切换当前活跃会话 thinking level。
   */
  const cycleActiveThinkingLevel = async (threadId = activeSessionId.value): Promise<void> => {
    if (!threadId) {
      return
    }
    const runtime = ensureRuntime(threadId)
    runtime.errorMessage = undefined
    try {
      const result = await window.api.codingAgent.cycleThinkingLevel(threadId)
      pushSessionNotification(
        threadId,
        result ? `Thinking 已切换到 ${result.level}` : '当前模型不支持切换 thinking'
      )
      await refreshSnapshot(threadId)
    } catch (error) {
      runtime.errorMessage = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * 确保指定上下文存在可运行命令或消息的 thread。
   * 新会话草稿态会按当前 Project、模型和 thinking 设置创建 thread，并迁移草稿。
   */
  const ensureThreadForContext = async (
    contextId = defaultSessionContextId
  ): Promise<{ threadId?: string; runtime?: WorkspaceSessionRuntime }> => {
    const context = ensureSessionContext(contextId)
    if (context.activeThreadId) {
      const runtime = ensureRuntime(context.activeThreadId)
      runtime.errorMessage = undefined
      return { threadId: context.activeThreadId, runtime }
    }
    if (!context.selectedProjectId) {
      globalErrorMessage.value = '请先选择 Project'
      return {}
    }
    loadingThreads.value = true
    const orphanDraft = context.orphanDraftMessage
    const orphanImages = [...context.orphanImageAttachments]
    const orphanFiles = [...context.orphanFileAttachments]
    const orphanQuotes = [...context.orphanQuoteAttachments]
    const orphanModel = context.orphanModel
    const orphanThinkingLevel = context.orphanThinkingLevel
    const orphanRunningDelivery = context.orphanRunningDelivery
    const orphanPanel = cloneUiState(context.panel)
    const orphanPanelTabsKey = context.orphanSessionPanelTabsKey
    const snapshot = await window.api.codingAgent.createThread({
      projectId: context.selectedProjectId,
      ...(orphanModel
        ? { initialModel: { provider: orphanModel.provider, modelId: orphanModel.modelId } }
        : {}),
      ...(orphanThinkingLevel ? { thinkingLevel: orphanThinkingLevel } : {})
    })
    mergeSnapshot(sessions, snapshot)
    syncToolCallsByIdFromSnapshot(snapshot)
    syncRenderStateFromSnapshot(snapshot)
    const threadId = snapshot.threadId
    context.sessionPanels[threadId] = orphanPanel
    context.composerDrafts[threadId] = orphanDraft
    context.composerImageAttachments[threadId] = orphanImages
    context.composerFileAttachments[threadId] = orphanFiles
    context.composerQuoteAttachments[threadId] = orphanQuotes
    context.runningDeliveries[threadId] = orphanRunningDelivery
    writeStoredSessionPanelState(contextId, orphanPanel, threadId)
    transferStoredSessionPanelTabsState(orphanPanelTabsKey, threadId)
    setContextActiveThreadId(threadId, contextId)

    context.orphanDraftMessage = createEmptyComposerContent()
    context.orphanImageAttachments = []
    context.orphanFileAttachments = []
    context.orphanQuoteAttachments = []
    context.orphanModel = undefined
    context.orphanThinkingLevel = undefined
    context.orphanRunningDelivery = 'steer'
    context.panel = createUiState()
    context.orphanSessionPanelTabsKey = createFreshOrphanSessionPanelTabsKey(contextId)
    context.orphanCommands = []
    context.orphanCommandsLoading = false
    context.orphanCommandsLoaded = false
    orphanCommandsRequestGenerationByContextId[contextId] =
      (orphanCommandsRequestGenerationByContextId[contextId] ?? 0) + 1
    writeStoredSessionPanelStateByKey(contextId, undefined, context.panel)

    context.selectedProjectId = snapshot.projectId
    workspaceProject.setActiveProjectId(snapshot.projectId)
    const runtime = ensureRuntime(threadId)
    runtime.errorMessage = undefined
    return { threadId, runtime }
  }

  /**
   * 向当前活跃会话发送 prompt。
   */
  const sendPrompt = async (
    contextId = defaultSessionContextId,
    runningDelivery: RunningMessageDelivery = 'steer'
  ): Promise<void> => {
    if (sendingPromptByContextId[contextId]) {
      return
    }
    const context = ensureSessionContext(contextId)
    let threadId = context.activeThreadId
    const draft = getComposerDraft(threadId, contextId)
    const text = getComposerText(draft).trim()
    const skillReferences = getComposerSkillReferences(draft)
    const images = getComposerImages(threadId, contextId)
    const files = getComposerFiles(threadId, contextId)
    const quotes = getComposerQuotes(threadId, contextId)
    const quoteContexts = quotes
    const fileArgs = dedupeStrings([
      ...getComposerFileArgs(draft),
      ...files.map((file) => file.path)
    ])
    const baseMessage =
      text ||
      (images.length > 0 ? '请分析这些图片' : '') ||
      (files.length > 0 ? '请处理这些文件' : '') ||
      (quoteContexts.length > 0 ? '请基于引用内容回答' : '')
    const message = baseMessage
    if (!message) {
      return
    }
    let runtime: WorkspaceSessionRuntime | undefined
    globalErrorMessage.value = undefined
    sendingPromptByContextId[contextId] = true
    try {
      const ensured = await ensureThreadForContext(contextId)
      threadId = ensured.threadId
      runtime = ensured.runtime
      if (!threadId) {
        return
      }
      const targetThreadId = threadId
      const session = sessions[targetThreadId]
      const isQueuedWhileRunning = isThreadRunning(session)
      const initialTitle = isQueuedWhileRunning
        ? undefined
        : getInitialPromptTitle(session, message)
      if (initialTitle) {
        const updatedThread = await window.api.codingAgent.setThreadTitle({
          threadId: targetThreadId,
          title: initialTitle
        })
        mergeSession(sessions, updatedThread)
        const snapshot = sessions[targetThreadId]?.snapshot
        if (snapshot) {
          snapshot.title = updatedThread.title
        }
      }
      const input = {
        threadId: targetThreadId,
        message,
        ...(fileArgs.length > 0 ? { fileArgs } : {}),
        ...(skillReferences.length > 0 ? { skillReferences } : {}),
        ...(quoteContexts.length > 0
          ? {
              quoteContexts: quoteContexts.map(({ messageId, sessionEntryId, text }) => ({
                messageId,
                ...(sessionEntryId ? { sessionEntryId } : {}),
                text
              }))
            }
          : {}),
        ...getPromptImagePayload(images)
      }
      if (isQueuedWhileRunning) {
        if (runningDelivery === 'followUp') {
          await window.api.codingAgent.followUp(input)
        } else {
          await window.api.codingAgent.steer(input)
        }
      } else {
        await window.api.codingAgent.prompt(input)
      }
      clearComposerDraft(targetThreadId, contextId)
      clearComposerImages(targetThreadId, contextId)
      clearComposerFiles(targetThreadId, contextId)
      clearComposerQuotes(targetThreadId, contextId)
      // sessions 是 shallowReactive，状态变化要替换根对象，避免 ChatView running computed 卡住。
      if (sessions[targetThreadId]) {
        sessions[targetThreadId] = applySessionStatus(sessions[targetThreadId], 'running')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (runtime) {
        runtime.errorMessage = message
      } else {
        globalErrorMessage.value = message
      }
    } finally {
      sendingPromptByContextId[contextId] = false
      loadingThreads.value = false
    }
  }

  /**
   * 中止当前活跃会话的执行。
   */
  const abortActive = async (contextId = defaultSessionContextId): Promise<void> => {
    const threadId = getContextActiveThreadId(contextId)
    if (!threadId) {
      return
    }
    await window.api.codingAgent.abort(threadId)
    await refreshSnapshot(threadId)
  }

  /**
   * 响应审批请求。
   * @param approval - 审批请求对象。
   * @param input - 用户响应内容（允许/拒绝、选择项、原因）。
   */
  const respondApproval = async (
    approval: ApprovalRequest,
    input: Pick<ApprovalResponse, 'allow' | 'choice' | 'reason'> & {
      scope?: ApprovalResponse['scope']
    }
  ): Promise<void> => {
    await window.api.codingAgent.respondApproval({
      threadId: approval.threadId,
      response: {
        approvalId: approval.approvalId,
        allow: input.allow,
        scope: input.scope ?? approval.scope,
        choice: input.choice,
        reason: input.reason
      }
    })
    delete ensureRuntime(approval.threadId).approvals[approval.approvalId]
  }

  /** 向 desktop transport 提交响应，并在成功后移除对应对话框。 */
  const respondExtensionUi = async (
    threadId: string,
    response: ExtensionUiResponseInput['response']
  ): Promise<boolean> => {
    const runtime = ensureRuntime(threadId)
    if (runtime.extensionDialogResponding[response.id]) {
      return false
    }
    runtime.extensionDialogResponding[response.id] = true
    delete runtime.extensionDialogErrors[response.id]
    try {
      await window.api.codingAgent.respondUi({ threadId, response })
      runtime.extensionDialogQueue = removeExtensionDialog(
        runtime.extensionDialogQueue,
        response.id
      )
      clearExtensionDialogState(runtime, response.id)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      runtime.extensionDialogErrors[response.id] = `提交扩展请求失败：${message}`
      return false
    } finally {
      delete runtime.extensionDialogResponding[response.id]
    }
  }

  /** 响应当前 thread 的 extension 对话框。 */
  const respondExtensionDialog = async (
    request: ExtensionDialogRequest,
    value?: string | boolean
  ): Promise<boolean> => {
    const threadId = getActiveExtensionDialogThreadId(request.id)
    const response = createExtensionDialogResponse(request, value)
    if (!threadId || !response) {
      return false
    }
    return await respondExtensionUi(threadId, response)
  }

  /** 取消当前 thread 的 extension 对话框。 */
  const cancelExtensionDialog = async (request: ExtensionDialogRequest): Promise<boolean> => {
    const threadId = getActiveExtensionDialogThreadId(request.id)
    if (!threadId) {
      return false
    }
    return await respondExtensionUi(threadId, createExtensionDialogCancellation(request))
  }

  const setExtensionDialogDraft = (request: ExtensionDialogRequest, value: string): void => {
    const threadId = getActiveExtensionDialogThreadId(request.id)
    if (!threadId) {
      return
    }
    const runtime = ensureRuntime(threadId)
    runtime.extensionDialogDrafts[request.id] = value
    delete runtime.extensionDialogErrors[request.id]
  }

  /** 仅允许响应当前 active request，保持 Pi 的串行 dialog 语义。 */
  function getActiveExtensionDialogThreadId(requestId: string): string | undefined {
    const threadId = activeSessionId.value
    const runtime = getRuntime(threadId)
    return runtime?.extensionDialogQueue[0]?.id === requestId ? threadId : undefined
  }

  /**
   * 清理 renderer 侧 extension notify 投影。
   * @param threadId - 所属 thread ID，默认当前活跃会话。
   */
  const clearExtensionNotifications = (threadId = activeSessionId.value): void => {
    if (!threadId) {
      return
    }
    ensureRuntime(threadId).extensionNotifications = []
  }

  /**
   * 加载当前活跃会话可运行的 slash/custom commands。
   */
  const loadCommands = async (threadId = activeSessionId.value): Promise<void> => {
    if (!threadId) {
      await loadOrphanCommands()
      return
    }
    const builtinCommands = getBuiltinCommandInfos()
    commandsByThreadId[threadId] = builtinCommands
    commandsLoadingByThreadId[threadId] = true
    try {
      commandsByThreadId[threadId] = mergeCommandInfos(
        builtinCommands,
        await window.api.codingAgent.getCommands(threadId)
      )
      commandsLoadedByThreadId[threadId] = true
    } catch (error) {
      ensureRuntime(threadId).errorMessage = error instanceof Error ? error.message : String(error)
      commandsLoadedByThreadId[threadId] = true
    } finally {
      commandsLoadingByThreadId[threadId] = false
    }
  }

  /**
   * 按需加载当前 thread 的 slash/custom commands。
   * 已加载或加载中的 thread 会复用现有状态，避免 tab 重复打开时反复请求。
   */
  const ensureCommandsLoaded = async (threadId = activeSessionId.value): Promise<void> => {
    if (!threadId) {
      if (mainContext.value.orphanCommandsLoaded || mainContext.value.orphanCommandsLoading) {
        return
      }
      await loadOrphanCommands()
      return
    }
    if (commandsLoadedByThreadId[threadId] || commandsLoadingByThreadId[threadId]) {
      return
    }
    await loadCommands(threadId)
  }

  /**
   * 加载 main 派生的扁平 tree 视图。
   * @param options - 查询和过滤条件。
   * @param threadId - 目标 thread ID。
   */
  const loadActiveSessionTreeBranches = async (
    options: Pick<LoadSessionTreeBranchesInput, 'query' | 'filter'> = {},
    threadId = activeSessionId.value
  ): Promise<void> => {
    if (!threadId) {
      return
    }
    const state = ensureSessionTreeBranchesState(threadId)
    const requestKey = JSON.stringify({
      threadId,
      revision: state.revision,
      query: options.query?.trim() ?? '',
      filter: options.filter ?? 'default'
    })
    state.loading = true
    state.errorMessage = undefined
    state.requestKey = requestKey
    try {
      const result = await window.api.codingAgent.loadSessionTreeBranches({
        threadId,
        query: options.query,
        filter: options.filter
      })
      if (state.requestKey === requestKey) {
        state.result = reconcileSessionTreeBranchesResult(state.result, result)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (state.requestKey === requestKey) {
        state.errorMessage = message
        state.result = undefined
      }
      ensureRuntime(threadId).errorMessage = message
    } finally {
      if (state.requestKey === requestKey) {
        state.loading = false
      }
    }
  }

  /**
   * 运行当前 thread 的 slash/custom command。
   * @param command - command 名称。
   */
  const runCommand = async (
    command: string,
    args?: string,
    threadId = activeSessionId.value
  ): Promise<void> => {
    if (isSkillCommandName(command)) {
      toast.info('请在输入框使用 $ 引用技能', normalizeSkillCommandLabel(command))
      return
    }
    const desktopCommandResult = await runDesktopBuiltinCommand(command, args)
    if (desktopCommandResult.handled) {
      if (desktopCommandResult.message) {
        const targetThreadId = threadId ?? activeSessionId.value
        if (targetThreadId) {
          pushSessionNotification(targetThreadId, desktopCommandResult.message)
          delete sessionActionDetailsByThreadId[targetThreadId]
        }
        toast.info('命令已完成', desktopCommandResult.message)
      }
      return
    }
    let targetThreadId = threadId
    try {
      if (!targetThreadId) {
        const ensured = await ensureThreadForContext()
        targetThreadId = ensured.threadId
      } else {
        ensureRuntime(targetThreadId)
      }
      if (!targetThreadId) {
        return
      }
      const result = await window.api.codingAgent.runCommand({
        threadId: targetThreadId,
        command,
        ...(args ? { args } : {})
      })
      if (result?.refreshSnapshot) {
        await refreshSnapshot(targetThreadId)
      }
      pushSessionNotification(
        targetThreadId,
        result?.message ?? `已运行 ${args ? `${command} ${args}` : command}`
      )
      if (result?.details) {
        sessionActionDetailsByThreadId[targetThreadId] = result.details
      } else {
        delete sessionActionDetailsByThreadId[targetThreadId]
      }
      toast.success(
        '命令已完成',
        result?.message ?? `已运行 ${args ? `${command} ${args}` : command}`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error('命令执行失败', message)
    } finally {
      loadingThreads.value = false
    }
  }

  /**
   * 处理不需要进入 Pi worker 的 desktop UI 类 built-in slash command。
   * @param command - command 名称。
   * @param args - command 参数。
   * @param threadId - 当前 thread ID。
   * @returns 是否已处理及用户可见消息。
   */
  const runDesktopBuiltinCommand = async (
    command: string,
    args?: string
  ): Promise<{ handled: boolean; message?: string }> => {
    const commandName = normalizeCommandName(command)
    const trimmedArgs = args?.trim()
    switch (commandName) {
      case 'settings':
        await router.push('/settings/agent')
        return { handled: true, message: '已打开 Agent 设置' }
      case 'model':
        if (trimmedArgs) {
          return { handled: false }
        }
        await router.push('/settings/models/default')
        return { handled: true, message: '已打开模型设置' }
      case 'scoped-models':
        await router.push('/settings/models/tasks')
        return { handled: true, message: '已打开任务模型设置' }
      case 'trust':
        await router.push('/settings/agent/safety')
        return { handled: true, message: '已打开安全与信任设置' }
      case 'login':
      case 'logout':
        await router.push('/settings/models/registry?tab=credentials')
        return { handled: true, message: '已打开模型认证设置' }
      case 'tree': {
        if (trimmedArgs) {
          return { handled: false }
        }
        setActiveSessionPanelOpen(true)
        const currentEntryId = activeSnapshot.value?.currentEntryId
        if (currentEntryId) {
          focusActiveSessionTreeEntry(currentEntryId)
        }
        return { handled: true, message: '已打开 Session Tree' }
      }
      case 'fork': {
        if (trimmedArgs) {
          return { handled: false }
        }
        setActiveSessionPanelOpen(true)
        const currentEntryId = activeSnapshot.value?.currentEntryId
        if (currentEntryId) {
          focusActiveSessionTreeEntry(currentEntryId)
        }
        return { handled: true, message: '请在 Session Tree 中选择分叉位置' }
      }
      case 'resume':
        if (trimmedArgs) {
          return { handled: false }
        }
        await router.push('/settings/archive')
        return { handled: true, message: '已打开会话归档' }
      case 'quit':
        await window.api.windowControl.close()
        return { handled: true }
      default:
        return { handled: false }
    }
  }

  /**
   * 同步当前编辑器纯文本，供 Pi extension ctx.ui.getEditorText() 同步读取。
   * @param text - 当前编辑器纯文本。
   * @param threadId - thread ID。
   */
  const syncActiveEditorText = async (
    text: string,
    threadId = activeSessionId.value
  ): Promise<void> => {
    if (!threadId) {
      return
    }
    try {
      await window.api.codingAgent.syncExtensionEditorText({ threadId, text })
    } catch {
      // 编辑器同步是扩展运行时的辅助缓存，不应打断用户输入。
    }
  }

  /**
   * 触发当前 thread 的 Pi extension 快捷键。
   * @param shortcut - Pi KeyId。
   * @param threadId - thread ID。
   * @returns 是否发送了快捷键。
   */
  const dispatchExtensionShortcut = async (
    shortcut: string,
    threadId = activeSessionId.value
  ): Promise<boolean> => {
    if (!threadId) {
      return false
    }
    try {
      return await window.api.codingAgent.dispatchExtensionShortcut({ threadId, shortcut })
    } catch (error) {
      ensureRuntime(threadId).errorMessage = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  /**
   * 重载当前 thread 的 settings/resources/extensions，并刷新命令列表。
   * @param threadId - thread ID。
   */
  const reloadSessionResources = async (threadId = activeSessionId.value): Promise<void> => {
    if (!threadId) {
      return
    }
    try {
      await window.api.codingAgent.runCommand({ threadId, command: 'reload' })
      commandsLoadedByThreadId[threadId] = false
      commandsByThreadId[threadId] = []
      await loadCommands(threadId)
      pushSessionNotification(threadId, '已重载扩展与资源')
      toast.success('扩展与资源已应用到当前会话')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ensureRuntime(threadId).errorMessage = message
      toast.error('扩展与资源重载失败', message)
    }
  }

  /**
   * 手动压缩当前 thread 上下文。
   */
  const compactActive = async (customInstructions?: string): Promise<void> => {
    const threadId = activeSessionId.value
    if (!threadId) {
      return
    }
    const runtime = ensureRuntime(threadId)
    runtime.compaction = {
      reason: 'manual',
      running: true,
      startedAt: new Date().toISOString()
    }
    // fix: 手动压缩期间也属于 Pi 的 busy/running 状态，Composer 输入必须走 steer/follow-up 队列。
    if (sessions[threadId]) {
      sessions[threadId] = applySessionStatus(sessions[threadId], 'running')
    }
    try {
      const result = await window.api.codingAgent.compact({ threadId, customInstructions })
      runtime.compaction = {
        ...runtime.compaction,
        reason: runtime.compaction?.reason ?? 'manual',
        running: false,
        startedAt: runtime.compaction?.startedAt ?? new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        aborted: Boolean(result.cancelled)
      }
      // fix: 压缩结束后才退出 running，避免压缩中排队消息被误判为 idle prompt。
      if (sessions[threadId]) {
        sessions[threadId] = applySessionStatus(sessions[threadId], 'idle')
      }
      pushSessionNotification(threadId, result.cancelled ? '压缩已取消' : '上下文已压缩')
      await refreshSnapshot(threadId)
    } catch (error) {
      runtime.compaction = {
        ...runtime.compaction,
        reason: runtime.compaction?.reason ?? 'manual',
        running: false,
        startedAt: runtime.compaction?.startedAt ?? new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      }
      // fix: 压缩失败/取消后同步回 idle，避免 UI 残留运行态。
      if (sessions[threadId]) {
        sessions[threadId] = applySessionStatus(sessions[threadId], 'idle')
      }
      ensureRuntime(threadId).errorMessage = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * 设置当前 thread 自动压缩开关。
   */
  const setActiveAutoCompaction = async (
    enabled: boolean,
    threadId = activeSessionId.value
  ): Promise<void> => {
    if (!threadId) {
      return
    }
    try {
      await window.api.codingAgent.setAutoCompaction({ threadId, enabled })
      pushSessionNotification(threadId, enabled ? '自动压缩已启用' : '自动压缩已关闭')
      await refreshSnapshot(threadId)
    } catch (error) {
      ensureRuntime(threadId).errorMessage = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * 设置当前 thread 自动重试开关。
   */
  const setActiveAutoRetry = async (
    enabled: boolean,
    threadId = activeSessionId.value
  ): Promise<void> => {
    if (!threadId) {
      return
    }
    try {
      await window.api.codingAgent.setAutoRetry({ threadId, enabled })
      pushSessionNotification(threadId, enabled ? '自动重试已启用' : '自动重试已关闭')
      await refreshSnapshot(threadId)
    } catch (error) {
      ensureRuntime(threadId).errorMessage = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * 中止当前 thread 正在等待的自动重试。
   */
  const abortActiveRetry = async (threadId = activeSessionId.value): Promise<void> => {
    if (!threadId) {
      return
    }
    try {
      await window.api.codingAgent.abortRetry(threadId)
      ensureRuntime(threadId).retry = undefined
      pushSessionNotification(threadId, '已中止自动重试')
      await refreshSnapshot(threadId)
    } catch (error) {
      ensureRuntime(threadId).errorMessage = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * 导出当前 session。
   */
  const exportActiveSession = async (): Promise<void> => {
    const threadId = activeSessionId.value
    if (!threadId) {
      return
    }
    try {
      const result = await window.api.codingAgent.exportSession({ threadId })
      ensureRuntime(threadId).lastExport = result
      pushSessionNotification(threadId, 'Session 已导出')
    } catch (error) {
      ensureRuntime(threadId).errorMessage = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * 打开最近一次导出的 session 文件。
   */
  const openActiveExport = async (): Promise<void> => {
    const path = activeRuntime.value?.lastExport?.path
    if (!path) {
      return
    }
    await window.api.codingAgent.revealResourcePath({ path, mode: 'open' })
  }

  /**
   * 在系统资源管理器中显示最近一次导出的 session 文件。
   */
  const revealActiveExport = async (): Promise<void> => {
    const path = activeRuntime.value?.lastExport?.path
    if (!path) {
      return
    }
    await window.api.codingAgent.revealResourcePath({ path, mode: 'reveal' })
  }

  /**
   * 在当前 thread 内创建新的 Pi session。
   */
  const newActiveSession = async (parentSession?: string): Promise<void> => {
    const threadId = activeSessionId.value
    if (!threadId) {
      return
    }
    const previousPath = activeSnapshot.value?.sessionFile
    try {
      const snapshot = await window.api.codingAgent.newSession({ threadId, parentSession })
      mergeSnapshot(sessions, snapshot)
      syncToolCallsByIdFromSnapshot(snapshot)
      syncRenderStateFromSnapshot(snapshot)
      setContextActiveThreadId(snapshot.threadId)
      if (previousPath && previousPath !== snapshot.sessionFile) {
        ensureRuntime(threadId).previousSessionFile = previousPath
      }
      pushSessionNotification(threadId, '已创建新 session')
    } catch (error) {
      ensureRuntime(threadId).errorMessage = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * 通过系统文件选择器导入 Pi-compatible session。
   */
  const importActiveSessionFromPicker = async (): Promise<void> => {
    const threadId = activeSessionId.value
    if (!threadId) {
      return
    }
    try {
      const inputPath = await window.api.codingAgent.selectSessionFile({
        title: '导入 Pi Session'
      })
      if (!inputPath) {
        return
      }
      const snapshot = await window.api.codingAgent.importSession({ threadId, inputPath })
      mergeSnapshot(sessions, snapshot)
      syncToolCallsByIdFromSnapshot(snapshot)
      syncRenderStateFromSnapshot(snapshot)
      setContextActiveThreadId(snapshot.threadId)
      pushSessionNotification(threadId, `已导入 ${inputPath}`)
    } catch (error) {
      ensureRuntime(threadId).errorMessage = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * 切换当前 thread 到指定 session 文件。
   * @param sessionPath - Pi-compatible session 文件路径。
   */
  const switchActiveSessionPath = async (sessionPath: string): Promise<void> => {
    const threadId = activeSessionId.value
    const nextPath = sessionPath.trim()
    if (!threadId || !nextPath) {
      return
    }
    const previousPath = activeSnapshot.value?.sessionFile
    try {
      const snapshot = await window.api.codingAgent.switchSession({
        threadId,
        sessionPath: nextPath
      })
      mergeSnapshot(sessions, snapshot)
      syncToolCallsByIdFromSnapshot(snapshot)
      syncRenderStateFromSnapshot(snapshot)
      setContextActiveThreadId(snapshot.threadId)
      if (previousPath && previousPath !== snapshot.sessionFile) {
        ensureRuntime(threadId).previousSessionFile = previousPath
      }
      pushSessionNotification(threadId, `已切换到 ${nextPath}`)
    } catch (error) {
      ensureRuntime(threadId).errorMessage = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * 切回当前 thread 记录的上一个 session 文件。
   */
  const switchActivePreviousSession = async (): Promise<void> => {
    const previousPath = activePreviousSessionFile.value
    if (!previousPath) {
      return
    }
    await switchActiveSessionPath(previousPath)
  }

  /**
   * 打开当前或指定 thread 的 fork 来源对话。
   * @param threadId - 当前 forked thread ID。
   * @param contextId - 会话上下文 ID。
   */
  const openParentSession = async (
    threadId = activeSessionId.value,
    contextId = defaultSessionContextId
  ): Promise<void> => {
    if (!threadId) {
      return
    }
    const session = sessions[threadId]
    const lineage = session?.snapshot?.lineage ?? session?.lineage
    if (!session || !lineage) {
      return
    }
    if (lineage.parentThreadId && sessions[lineage.parentThreadId]) {
      setContextActiveThreadId(lineage.parentThreadId, contextId)
      pushSessionNotification(lineage.parentThreadId, '已打开来源对话')
      return
    }
    if (lineage.parentThreadId && lineage.parentThreadArchivedAt) {
      await window.api.codingAgent.restoreThread(lineage.parentThreadId)
      await loadThreads(contextId)
      setContextActiveThreadId(lineage.parentThreadId, contextId)
      pushSessionNotification(lineage.parentThreadId, '已恢复并打开来源对话')
      return
    }
    if (lineage.parentSessionFile && !lineage.parentSessionMissing && !lineage.unavailable) {
      const snapshot = await createThread(session.projectId, contextId, {
        sessionFile: lineage.parentSessionFile
      })
      if (snapshot?.threadId) {
        pushSessionNotification(snapshot.threadId, '已恢复来源对话')
        return
      }
    }
    ensureRuntime(threadId).errorMessage = '来源对话不可用'
  }

  /**
   * 请求 SessionPanel Tree 定位指定 entry。
   * @param entryId - session entry ID。
   */
  const focusActiveSessionTreeEntry = (entryId: string): void => {
    if (!entryId) {
      return
    }
    treeFocusRequest.value = {
      entryId,
      requestId: (treeFocusRequest.value?.requestId ?? 0) + 1
    }
  }

  /**
   * 克隆当前 session 并刷新 snapshot。
   */
  const cloneActiveSession = async (): Promise<void> => {
    const threadId = activeSessionId.value
    if (!threadId) {
      return
    }
    try {
      const snapshot = await window.api.codingAgent.clone(threadId)
      mergeSnapshot(sessions, snapshot)
      syncToolCallsByIdFromSnapshot(snapshot)
      syncRenderStateFromSnapshot(snapshot)
      pushSessionNotification(threadId, '当前 session 已克隆')
    } catch (error) {
      ensureRuntime(threadId).errorMessage = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * 从指定消息 entry 分叉当前 session。
   * @param entryId - Pi session entry/message ID。
   */
  const forkActiveSession = async (entryId: string): Promise<void> => {
    const threadId = activeSessionId.value
    if (!threadId || !entryId) {
      return
    }
    try {
      const result = await window.api.codingAgent.forkThread({ threadId, entryId, position: 'at' })
      if (result.cancelled || !result.snapshot) {
        pushSessionNotification(threadId, '分支会话创建已取消')
        return
      }
      const snapshot = result.snapshot
      mergeSnapshot(sessions, snapshot)
      syncToolCallsByIdFromSnapshot(snapshot)
      syncRenderStateFromSnapshot(snapshot)
      ensureRuntime(snapshot.threadId)
      setContextActiveThreadId(snapshot.threadId)
      workspaceProject.setActiveProjectId(snapshot.projectId)
      pushSessionNotification(snapshot.threadId, '已创建分支会话')
    } catch (error) {
      ensureRuntime(threadId).errorMessage = error instanceof Error ? error.message : String(error)
    }
  }

  function applyTreeNavigationEditorText(threadId: string, editorText: string | undefined): void {
    const context = ensureSessionContext(defaultSessionContextId)
    const images = ensureComposerImages(context.composerImageAttachments, threadId)
    const files = ensureComposerFiles(context.composerFileAttachments, threadId)
    const quotes = ensureComposerQuotes(context.composerQuoteAttachments, threadId)
    images.splice(0)
    files.splice(0)
    quotes.splice(0)
    if (editorText === undefined) {
      clearComposerDraft(threadId)
      return
    }
    const restored = restoreComposerPromptDraft(editorText, sessions[threadId]?.snapshot?.cwd ?? '')
    context.composerDrafts[threadId] = restored.content
    files.push(...restored.files)
    quotes.push(...restored.quotes)
  }

  /**
   * 在当前 session tree 内导航。
   * @param entryId - 目标 entry ID。
   */
  const navigateActiveSessionTree = async (entryId: string): Promise<void> => {
    const threadId = activeSessionId.value
    if (!threadId || !entryId) {
      return
    }
    const previousLeafEntryId = activeSnapshot.value?.currentEntryId
    if (previousLeafEntryId === entryId) {
      sessionActionMessageByThreadId[threadId] = '已经在选中消息位置'
      return
    }
    navigatingTreeEntryByThreadId[threadId] = entryId
    sessionActionMessageByThreadId[threadId] = '正在从这里继续'
    try {
      const result = await window.api.codingAgent.navigateTree({
        threadId,
        entryId,
        summarize: false
      })
      if (result.cancelled || result.aborted) {
        sessionActionMessageByThreadId[threadId] = result.aborted
          ? 'Tree 导航已中止'
          : 'Tree 导航已取消'
        return
      }
      discardPendingProjectionEvents(threadId)
      mergeSnapshot(sessions, result.snapshot)
      syncToolCallsByIdFromSnapshot(result.snapshot)
      syncRenderStateFromSnapshot(result.snapshot)
      const runtime = ensureRuntime(threadId)
      if (previousLeafEntryId && previousLeafEntryId !== result.snapshot.currentEntryId) {
        runtime.previousLeafEntryId = previousLeafEntryId
        runtime.nextLeafEntryId = undefined
      }
      applyTreeNavigationEditorText(threadId, result.editorText)
      sessionActionMessageByThreadId[threadId] = result.editorText
        ? '已回到选中消息，可编辑后重新发送'
        : '已移动到选中节点'
    } catch (error) {
      ensureRuntime(threadId).errorMessage = error instanceof Error ? error.message : String(error)
      sessionActionMessageByThreadId[threadId] = '从这里继续失败'
    } finally {
      delete navigatingTreeEntryByThreadId[threadId]
    }
  }

  /**
   * 返回 tree 导航前的上一个 leaf。
   */
  const navigateBackToPreviousLeaf = async (): Promise<void> => {
    const threadId = activeSessionId.value
    const previousLeafEntryId = activePreviousLeafEntryId.value
    if (!threadId || !previousLeafEntryId) {
      return
    }
    const currentLeafEntryId = activeSnapshot.value?.currentEntryId
    try {
      const result = await window.api.codingAgent.navigateTree({
        threadId,
        entryId: previousLeafEntryId,
        summarize: false
      })
      if (result.cancelled || result.aborted) {
        sessionActionMessageByThreadId[threadId] = result.aborted
          ? 'Tree 导航已中止'
          : 'Tree 导航已取消'
        return
      }
      discardPendingProjectionEvents(threadId)
      mergeSnapshot(sessions, result.snapshot)
      syncToolCallsByIdFromSnapshot(result.snapshot)
      syncRenderStateFromSnapshot(result.snapshot)
      const runtime = ensureRuntime(threadId)
      runtime.previousLeafEntryId = undefined
      runtime.nextLeafEntryId = currentLeafEntryId ?? undefined
      applyTreeNavigationEditorText(threadId, result.editorText)
      sessionActionMessageByThreadId[threadId] = '已返回之前位置'
    } catch (error) {
      ensureRuntime(threadId).errorMessage = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * 懒加载当前 session tree 的子节点。
   * @param parentId - 父 entry ID。
   */
  const loadActiveSessionTreeChildren = async (parentId: string, maxDepth = 2): Promise<void> => {
    const threadId = activeSessionId.value
    const snapshot = activeSnapshot.value
    if (!threadId || !snapshot || !parentId || loadingTreeChildrenByEntryId[parentId]) {
      return
    }
    loadingTreeChildrenByEntryId[parentId] = true
    try {
      const children = await window.api.codingAgent.loadSessionTreeChildren({
        threadId,
        parentId,
        maxDepth
      })
      mergeSessionTreeChildren(snapshot.sessionTree ?? [], parentId, children)
    } catch (error) {
      ensureRuntime(threadId).errorMessage = error instanceof Error ? error.message : String(error)
    } finally {
      loadingTreeChildrenByEntryId[parentId] = false
    }
  }

  /**
   * 获取当前 session tree 中 root 到目标 entry 的路径。
   * @param entryId - 目标 entry ID。
   * @returns entry ID 路径。
   */
  const loadActiveSessionTreePath = async (entryId?: string): Promise<string[]> => {
    const threadId = activeSessionId.value
    if (!threadId) {
      return []
    }
    try {
      return await window.api.codingAgent.loadSessionTreePath({ threadId, entryId })
    } catch (error) {
      ensureRuntime(threadId).errorMessage = error instanceof Error ? error.message : String(error)
      return []
    }
  }

  /**
   * 设置当前 session tree entry label。
   * @param entryId - 目标 entry ID。
   * @param label - 新 label；空字符串表示清除。
   */
  const setActiveSessionEntryLabel = async (entryId: string, label: string): Promise<void> => {
    const threadId = activeSessionId.value
    if (!threadId || !entryId) {
      return
    }
    try {
      const snapshot = await window.api.codingAgent.setSessionEntryLabel({
        threadId,
        entryId,
        label: label.trim() || undefined
      })
      mergeSnapshot(sessions, snapshot)
      syncToolCallsByIdFromSnapshot(snapshot)
      syncRenderStateFromSnapshot(snapshot)
      pushSessionNotification(threadId, label.trim() ? 'Label 已保存' : 'Label 已清除')
    } catch (error) {
      ensureRuntime(threadId).errorMessage = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * 设置当前活跃会话 ID 并刷新快照。
   * @param sessionId - 目标会话 ID。
   */
  const setActiveSessionId = async (
    sessionId: string,
    contextId = defaultSessionContextId
  ): Promise<void> => {
    const session = sessions[sessionId]
    if (session) {
      setContextActiveThreadId(sessionId, contextId)
      await refreshSnapshot(sessionId)
    }
  }

  /**
   * 激活指定 Project，并选中该 Project 最近更新的 thread；没有 thread 时进入新会话草稿态。
   * @param projectId - Project ID。
   * @param contextId - 上下文 ID。
   */
  const setActiveProjectId = async (
    projectId: string,
    contextId = defaultSessionContextId
  ): Promise<void> => {
    workspaceProject.setActiveProjectId(projectId)
    const context = ensureSessionContext(contextId)
    context.selectedProjectId = projectId
    const [latestThread] = sortSessionsByUpdatedAt(
      Object.values(sessions).filter((session) => session.projectId === projectId)
    )
    if (!latestThread) {
      setContextActiveThreadId(undefined, contextId)
      return
    }
    setContextActiveThreadId(latestThread.threadId, contextId)
    await refreshSnapshot(latestThread.threadId)
  }

  /**
   * 归档指定会话并刷新列表。
   * @param threadId - 目标 thread ID。
   * @param contextId - 上下文 ID。
   */
  const archiveThread = async (
    threadId: string,
    contextId = defaultSessionContextId
  ): Promise<void> => {
    globalErrorMessage.value = undefined
    try {
      await window.api.codingAgent.archiveThread(threadId)
      delete sessions[threadId]
      delete runtimeByThreadId[threadId]
      delete toolCallsByThreadId[threadId]
      delete toolCallStructuresByThreadId[threadId]
      delete modelOptionsByThreadId[threadId]
      delete modelOptionsLoadingByThreadId[threadId]
      delete commandsByThreadId[threadId]
      delete commandsLoadingByThreadId[threadId]
      delete commandsLoadedByThreadId[threadId]
      delete sessionTreeBranchesByThreadId[threadId]
      delete sessionActionMessageByThreadId[threadId]
      delete sessionNotificationsByThreadId[threadId]
      await loadThreads(contextId, { selectLatestActiveProjectThread: true })
    } catch (error) {
      globalErrorMessage.value = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * 设置当前活跃会话面板的展开状态。
   * @param open - 是否展开。
   */
  const setActiveSessionPanelOpen = (open: boolean, contextId = defaultSessionContextId): void => {
    const state = getSessionPanelState(contextId)
    state.panelOpen = open
    writeStoredSessionPanelState(contextId, state)
  }

  /**
   * 设置当前活跃会话面板的宽度，并限制在最小宽度范围内。
   * @param width - 目标宽度。
   */
  const setActiveSessionPanelWidth = (width: number, contextId = defaultSessionContextId): void => {
    const state = getSessionPanelState(contextId)
    state.panelWidth = Math.max(minSessionPanelWidth, width)
    writeStoredSessionPanelState(contextId, state)
  }

  /**
   * 获取指定会话的 Composer 草稿。
   * @param threadId - 目标 thread ID，默认当前活跃会话。
   * @returns Composer 草稿拷贝。
   */
  const getComposerDraft = (
    threadId = activeSessionId.value,
    contextId = defaultSessionContextId
  ): JSONContent => {
    const context = ensureSessionContext(contextId)
    if (!threadId) {
      return context.orphanDraftMessage
    }
    return ensureComposerDraft(context.composerDrafts, threadId)
  }

  /**
   * 设置当前活跃会话的 Composer 草稿。
   * @param draft - 草稿内容。
   */
  const setActiveComposerDraft = (draft: JSONContent): void => {
    draftMessage.value = draft
  }

  /**
   * 清空指定会话的 Composer 草稿。
   * @param threadId - 目标 thread ID，默认当前活跃会话。
   */
  const clearComposerDraft = (
    threadId = activeSessionId.value,
    contextId = defaultSessionContextId
  ): void => {
    const context = ensureSessionContext(contextId)
    if (!threadId) {
      context.orphanDraftMessage = createEmptyComposerContent()
      return
    }
    context.composerDrafts[threadId] = createEmptyComposerContent()
  }

  /**
   * 获取指定会话的图片附件草稿。
   * @param threadId - 目标 thread ID，默认当前活跃会话。
   * @returns 图片附件列表。
   */
  const getComposerImages = (
    threadId = activeSessionId.value,
    contextId = defaultSessionContextId
  ): ComposerImageAttachment[] => {
    const context = ensureSessionContext(contextId)
    if (!threadId) {
      return context.orphanImageAttachments
    }
    return ensureComposerImages(context.composerImageAttachments, threadId)
  }

  /**
   * 添加图片附件草稿。
   * @param images - 图片附件。
   */
  const addComposerImages = (
    images: ComposerImageAttachment[],
    contextId = defaultSessionContextId,
    threadId = getContextActiveThreadId(contextId)
  ): void => {
    if (images.length === 0) {
      return
    }
    getComposerImages(threadId, contextId).push(...images)
  }

  /**
   * 删除图片附件草稿。
   * @param imageId - 图片附件 ID。
   */
  const removeComposerImage = (imageId: string, contextId = defaultSessionContextId): void => {
    const images = getComposerImages(getContextActiveThreadId(contextId), contextId)
    const index = images.findIndex((image) => image.id === imageId)
    if (index >= 0) {
      images.splice(index, 1)
    }
  }

  /**
   * 清空图片附件草稿。
   * @param threadId - 目标 thread ID，默认当前活跃会话。
   */
  const clearComposerImages = (
    threadId = activeSessionId.value,
    contextId = defaultSessionContextId
  ): void => {
    getComposerImages(threadId, contextId).splice(0)
  }

  /**
   * 获取指定会话的文件路径附件草稿。
   * @param threadId - 目标 thread ID，默认当前活跃会话。
   * @returns 文件路径附件列表。
   */
  const getComposerFiles = (
    threadId = activeSessionId.value,
    contextId = defaultSessionContextId
  ): ComposerFileAttachment[] => {
    const context = ensureSessionContext(contextId)
    if (!threadId) {
      return context.orphanFileAttachments
    }
    return ensureComposerFiles(context.composerFileAttachments, threadId)
  }

  /**
   * 添加文件路径附件草稿。
   * @param files - 文件路径附件。
   */
  const addComposerFiles = (
    files: ComposerFileAttachment[],
    contextId = defaultSessionContextId,
    threadId = getContextActiveThreadId(contextId)
  ): void => {
    if (files.length === 0) {
      return
    }
    const target = getComposerFiles(threadId, contextId)
    const existingPaths = new Set(target.map((file) => file.path))
    for (const file of files) {
      if (existingPaths.has(file.path)) {
        continue
      }
      existingPaths.add(file.path)
      target.push(file)
    }
  }

  /**
   * 删除文件路径附件草稿。
   * @param fileId - 文件附件 ID。
   */
  const removeComposerFile = (fileId: string, contextId = defaultSessionContextId): void => {
    const files = getComposerFiles(getContextActiveThreadId(contextId), contextId)
    const index = files.findIndex((file) => file.id === fileId)
    if (index >= 0) {
      files.splice(index, 1)
    }
  }

  /**
   * 清空文件路径附件草稿。
   * @param threadId - 目标 thread ID，默认当前活跃会话。
   */
  const clearComposerFiles = (
    threadId = activeSessionId.value,
    contextId = defaultSessionContextId
  ): void => {
    getComposerFiles(threadId, contextId).splice(0)
  }

  /** 获取指定会话的 assistant 文本引用草稿。 */
  const getComposerQuotes = (
    threadId = activeSessionId.value,
    contextId = defaultSessionContextId
  ): ComposerQuoteAttachment[] => {
    const context = ensureSessionContext(contextId)
    if (!threadId) {
      return context.orphanQuoteAttachments
    }
    return ensureComposerQuotes(context.composerQuoteAttachments, threadId)
  }

  /** 添加 assistant 文本引用草稿。 */
  const addComposerQuote = (
    quote: ComposerQuoteAttachment,
    contextId = defaultSessionContextId,
    threadId = getContextActiveThreadId(contextId)
  ): void => {
    const text = quote.text.trim().slice(0, MAX_COMPOSER_QUOTE_CHARS)
    if (!text) return

    const target = getComposerQuotes(threadId, contextId)
    if (quote.kind === 'browser-element' && quote.browserRef) {
      const existingIndex = target.findIndex(
        (item) => item.kind === 'browser-element' && item.browserRef === quote.browserRef
      )
      if (existingIndex >= 0) {
        const remainingChars =
          MAX_COMPOSER_QUOTE_TOTAL_CHARS -
          target.reduce(
            (sum, item, index) => sum + (index === existingIndex ? 0 : item.text.length),
            0
          )
        if (remainingChars <= 0) return
        target[existingIndex] = {
          ...quote,
          id: target[existingIndex].id,
          text: text.slice(0, remainingChars)
        }
        return
      }
    }
    if (
      target.length >= MAX_COMPOSER_QUOTES ||
      target.some((item) => item.messageId === quote.messageId && item.text === text)
    ) {
      return
    }
    const remainingChars =
      MAX_COMPOSER_QUOTE_TOTAL_CHARS - target.reduce((sum, item) => sum + item.text.length, 0)
    if (remainingChars <= 0) return
    target.push({ ...quote, text: text.slice(0, remainingChars) })
  }

  /** 删除 assistant 文本引用草稿。 */
  const removeComposerQuote = (quoteId: string, contextId = defaultSessionContextId): void => {
    const quotes = getComposerQuotes(getContextActiveThreadId(contextId), contextId)
    const index = quotes.findIndex((quote) => quote.id === quoteId)
    if (index >= 0) quotes.splice(index, 1)
  }

  /** 清空 assistant 文本引用草稿。 */
  const clearComposerQuotes = (
    threadId = activeSessionId.value,
    contextId = defaultSessionContextId
  ): void => {
    getComposerQuotes(threadId, contextId).splice(0)
  }

  /**
   * 应用 extension UI 请求。
   * 交互类请求进入待响应队列；状态类请求直接投影到当前 thread runtime。
   * @param threadId - 所属 thread ID。
   * @param request - extension UI 请求。
   */
  function applyExtensionUiRequest(threadId: string, request: ExtensionUiRequest): void {
    const runtime = ensureRuntime(threadId)
    switch (request.type) {
      case 'select':
      case 'confirm':
      case 'input':
      case 'editor':
        initializeExtensionDialogState(runtime, request)
        runtime.extensionDialogQueue = enqueueExtensionDialog(runtime.extensionDialogQueue, request)
        return
      case 'notify':
        pushSessionNotification(threadId, getExtensionNotifySummary(request.message))
        if (shouldShowExtensionNotifyInPanel(request.message)) {
          runtime.extensionNotifications = [request.message]
        }
        showExtensionToast(request)
        return
      case 'setStatus':
        runtime.extensionStatuses[request.statusKey] = request.statusText
        return
      case 'setTitle':
        runtime.extensionTitle = request.title
        return
      case 'setWorkingMessage':
        runtime.extensionWorkingMessage = request.message
        return
      case 'setWorkingVisible':
        runtime.extensionWorkingVisible = request.visible
        return
      case 'setWorkingIndicator':
        runtime.extensionWorkingIndicator = request.options
        return
      case 'setHiddenThinkingLabel':
        runtime.extensionHiddenThinkingLabel = request.label
        return
      case 'setToolsExpanded':
        runtime.extensionToolsExpanded = request.expanded
        return
      case 'setEditorText': {
        const draft = createComposerContentFromText(request.text)
        if (activeSessionId.value === threadId) {
          draftMessage.value = draft
          return
        }
        ensureSessionContext(defaultSessionContextId).composerDrafts[threadId] = draft
        return
      }
    }

    /**
     * 将 extension notify 映射为桌面端 toast。
     * @param request - extension notify 请求。
     */
    function showExtensionToast(request: Extract<ExtensionUiRequest, { type: 'notify' }>): void {
      const message = shouldShowExtensionNotifyInPanel(request.message)
        ? '通知内容较长，已放入扩展面板'
        : request.message
      switch (request.notifyType) {
        case 'error':
          toast.error('扩展', message)
          return
        case 'warning':
          toast.warning('扩展', message)
          return
        case 'info':
        default:
          toast.info('扩展', message)
      }
    }
  }

  /**
   * 应用 desktop extension panel projection。
   * @param threadId - 所属 thread ID。
   * @param event - panel projection。
   */
  function applyExtensionPanelProjection(threadId: string, event: ExtensionPanelProjection): void {
    const runtime = ensureRuntime(threadId)
    switch (event.type) {
      case 'extensionPanel.registered':
        runtime.extensionPanels[event.panel.id] = event.panel
        return
      case 'extensionPanel.updated': {
        const current = runtime.extensionPanels[event.panelId]
        if (!current) {
          return
        }
        runtime.extensionPanels[event.panelId] = { ...current, ...event.patch }
        return
      }
      case 'extensionPanel.message': {
        const current = runtime.extensionPanelMessages[event.panelId]
        const sequence = (current?.sequence ?? 0) + 1
        const messages = [...(current?.messages ?? []), { sequence, message: event.message }]
        runtime.extensionPanelMessages[event.panelId] = {
          sequence,
          message: event.message,
          messages: messages.slice(-1000)
        }
        return
      }
      case 'extensionPanel.removed':
        delete runtime.extensionPanelMessages[event.panelId]
        delete runtime.extensionPanelStates[event.panelId]
        delete runtime.extensionPanels[event.panelId]
        return
      case 'extensionPanel.stateUpdated':
        if (!runtime.extensionPanels[event.panelId]) {
          return
        }
        runtime.extensionPanelStates[event.panelId] = event.state
        return
    }
  }

  /** Browser 等原生 panel 将消息排入本地执行队列后，从 transport 日志中确认消费。 */
  function consumeExtensionPanelMessages(
    threadId: string,
    panelId: string,
    throughSequence: number
  ): void {
    const entry = getRuntime(threadId)?.extensionPanelMessages[panelId]
    if (!entry) return
    entry.messages = entry.messages.filter((message) => message.sequence > throughSequence)
  }

  /**
   * 保存 desktop webview panel 内容通过 piPanel.setState 提交的状态。
   * @param threadId - 所属 thread ID。
   * @param panelId - Panel ID。
   * @param state - JSON 可序列化状态；类型由扩展自定义。
   */
  function setExtensionPanelState(threadId: string, panelId: string, state: unknown): void {
    const runtime = ensureRuntime(threadId)
    if (!runtime.extensionPanels[panelId]) {
      return
    }
    runtime.extensionPanelStates[panelId] = state
    void window.api.codingAgent.saveExtensionPanelState({ threadId, panelId, state })
  }

  /**
   * 销毁 desktop extension panel，并清理 renderer 本地投影。
   * @param threadId - 所属 thread ID。
   * @param panelId - Panel ID。
   */
  function disposeExtensionPanel(threadId: string, panelId: string): void {
    const runtime = ensureRuntime(threadId)
    if (!runtime.extensionPanels[panelId]) {
      return
    }
    delete runtime.extensionPanelMessages[panelId]
    delete runtime.extensionPanelStates[panelId]
    delete runtime.extensionPanels[panelId]
    void window.api.codingAgent.disposeExtensionPanel({
      threadId,
      panelId,
      reason: 'userClosed'
    })
  }

  /**
   * 处理来自主进程的 coding agent 事件。
   * 更新会话快照、状态以及待处理审批请求。
   * @param event - IPC 事件。
   */
  const handleEvent = (event: CodingAgentIpcEvent): void => {
    const threadId = getEventThreadId(event)
    if (threadId) {
      const runtime = ensureRuntime(threadId)
      runtime.events.unshift(event)
      runtime.events = runtime.events.slice(0, 80)
      if (event.type === 'auto_retry_start') {
        runtime.retry = {
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          errorMessage: event.errorMessage
        }
        // 自动重试等待 delay 期间用户仍在等 agent，必须保持 running，避免 UI 提前退出工作态。
        if (sessions[threadId]) {
          sessions[threadId] = applySessionStatus(sessions[threadId], 'running')
        }
      } else if (event.type === 'auto_retry_end') {
        runtime.retry = undefined
        // retry 成功或耗尽后才结束工作态；失败详情由 timeline/system message 展示。
        if (sessions[threadId]) {
          sessions[threadId] = applySessionStatus(sessions[threadId], 'idle')
        }
        pushSessionNotification(
          threadId,
          event.success
            ? '自动重试已恢复'
            : `自动重试结束${event.finalError ? `：${event.finalError}` : ''}`
        )
      } else if (event.type === 'compaction_start') {
        runtime.compaction = {
          reason: event.reason,
          running: true,
          startedAt: new Date().toISOString()
        }
        // fix: 压缩等待期间用户仍在与 agent 交互，状态必须保持 running 以复用 Pi 队列语义。
        if (sessions[threadId]) {
          sessions[threadId] = applySessionStatus(sessions[threadId], 'running')
        }
        pushSessionNotification(threadId, '正在压缩上下文')
      } else if (event.type === 'compaction_end') {
        runtime.compaction = {
          ...runtime.compaction,
          reason: event.reason,
          running: false,
          startedAt: runtime.compaction?.startedAt ?? new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          aborted: event.aborted,
          willRetry: event.willRetry,
          error: event.errorMessage
        }
        // overflow 压缩成功后可能立即重试；此时仍处于同一工作轮次，不能短暂切到 idle。
        if (sessions[threadId] && !event.willRetry) {
          sessions[threadId] = applySessionStatus(sessions[threadId], 'idle')
        }
        pushSessionNotification(
          threadId,
          event.aborted
            ? `压缩已中止${event.errorMessage ? `：${event.errorMessage}` : ''}`
            : '上下文已压缩'
        )
        void refreshSnapshot(threadId)
      }
    }
    switch (event.type) {
      case 'threadSnapshot': {
        mergeSnapshot(sessions, event.snapshot)
        syncToolCallsByIdFromSnapshot(event.snapshot)
        ensureRuntime(event.threadId)
        syncPendingInteractionsFromSnapshot(event.snapshot)
        syncRenderStateFromSnapshot(event.snapshot)
        if (!activeSessionId.value || !sessions[activeSessionId.value]) {
          setContextActiveThreadId(event.threadId)
        }
        return
      }
      case 'message_start':
      case 'message_update':
      case 'message_end':
        scheduleMessageEvent(event)
        return
      case 'tool_execution_update':
        scheduleToolUpdateEvent(event)
        return
      case 'tool_execution_end':
        flushPendingToolUpdateEvents()
        break
      case 'project':
        workspaceProject.projects[event.event.project.projectId] = event.event.project
        break
      case 'threadWorker':
        applyThreadWorkerEventToRuntime(sessions, runtimeByThreadId, event)
        break
      case 'projection':
        if (event.event.type === 'thread.stateChanged' && sessions[event.threadId]) {
          sessions[event.threadId] = applySessionStatus(
            sessions[event.threadId],
            event.event.status
          )
        }
        if (event.event.type === 'approval.requested') {
          ensureRuntime(event.threadId).approvals[event.event.approval.approvalId] =
            event.event.approval
        }
        if (event.event.type === 'approval.dismissed') {
          delete ensureRuntime(event.threadId).approvals[event.event.approvalId]
        }
        if (event.event.type === 'extensionUi.requested') {
          applyExtensionUiRequest(event.threadId, event.event.request)
        }
        if (event.event.type === 'extensionUi.dismissed') {
          const runtime = ensureRuntime(event.threadId)
          runtime.extensionDialogQueue = removeExtensionDialog(
            runtime.extensionDialogQueue,
            event.event.requestId
          )
          clearExtensionDialogState(runtime, event.event.requestId)
        }
        if (
          event.event.type === 'extensionPanel.registered' ||
          event.event.type === 'extensionPanel.updated' ||
          event.event.type === 'extensionPanel.message' ||
          event.event.type === 'extensionPanel.removed' ||
          event.event.type === 'extensionPanel.stateUpdated'
        ) {
          applyExtensionPanelProjection(event.threadId, event.event)
        }
        break
    }
    applyEventToSessions(sessions, event, (messageId, renderState) => {
      if (threadId) {
        bumpMessageRevision(threadId, messageId, renderState)
      }
    })
    if (
      threadId &&
      (event.type === 'tool_execution_start' || event.type === 'tool_execution_end')
    ) {
      syncToolCallByIdFromSession(threadId, event.toolCallId)
    }
  }

  /**
   * 获取指定上下文的活跃 thread 存储 key。
   * @param contextId - 上下文 ID。
   * @returns sessionStorage key。
   */
  function getActiveThreadStorageKey(contextId: string): string {
    return `${activeThreadSessionStoragePrefix}${contextId}`
  }

  /** 订阅 IPC 事件并保存取消订阅函数。 */
  const unsubscribe = window.api.codingAgent.onEvent(handleEvent)

  return {
    abortActive,
    abortActiveRetry,
    addComposerImages,
    addComposerQuote,
    archiveThread,
    activeCommands,
    activeCommandsLoaded,
    activeCommandsLoading,
    activeCompactionState,
    activeEvents,
    activeExportResult,
    activeExtensionDialog,
    activeExtensionDialogDrafts,
    activeExtensionDialogErrors,
    activeExtensionDialogResponding,
    activeExtensionDialogs,
    activeExtensionStatuses,
    activeExtensionHiddenThinkingLabel,
    activeExtensionNotifications,
    activeExtensionPanelMessages,
    activeExtensionPanels,
    activeExtensionPanelStates,
    activeExtensionTitle,
    activeExtensionToolsExpanded,
    activeExtensionWorkingIndicator,
    activeExtensionWorkingMessage,
    activeExtensionWorkingVisible,
    activeModelOptions,
    activeModelOptionsLoading,
    activeNavigatingTreeEntryId,
    activePendingApprovals,
    activePreviousLeafEntryId,
    activePreviousSessionFile,
    activeProjectId,
    activeRetryState,
    activeRuntime,
    activeRuntimeTimelineEvents,
    activeSession,
    activeSessionActionMessage,
    activeSessionActionDetails,
    activeSessionNotifications,
    activeSessionId,
    activeSessionPanel,
    activeSessionPanelTabsKey,
    activeSnapshot,
    activeSessionTreeBranches,
    activeSessionTreeBranchesError,
    activeSessionTreeBranchesLoading,
    activeSessionTreeBranchesState,
    activeToolCallsById,
    activeToolCallStructures,
    addComposerFiles,
    clearExtensionNotifications,
    contexts,
    createThread,
    clearComposerFiles,
    clearComposerDraft,
    clearComposerImages,
    clearComposerQuotes,
    cloneActiveSession,
    clearActiveSessionAction,
    dismissSessionNotification,
    compactActive,
    defaultSessionContextId,
    draftFiles,
    draftImages,
    draftMessage,
    draftQuotes,
    runningDelivery,
    errorMessage,
    events: activeEvents,
    ensureCommandsLoaded,
    dispatchExtensionShortcut,
    getContextActiveThreadId,
    getContextComposerDrafts,
    getComposerDraft,
    getComposerFiles,
    getComposerImages,
    getComposerQuotes,
    getMessageRenderState,
    hasDraftMessage,
    isNewSessionActive,
    isSendingPrompt,
    loadThreads,
    loadCommands,
    loadActiveSessionTreeBranches,
    loadModelOptions,
    loading,
    loadingThreads,
    loadingTreeChildrenByEntryId,
    maxSessionPanelWidth,
    removeComposerFile,
    focusActiveSessionTreeEntry,
    loadActiveSessionTreeChildren,
    loadActiveSessionTreePath,
    minSessionPanelWidth,
    orphanModel,
    orphanThinkingLevel,
    openActiveExport,
    openParentSession,
    pendingApprovals: activePendingApprovals,
    refreshSnapshot,
    removeComposerImage,
    removeComposerQuote,
    revealActiveExport,
    respondApproval,
    respondExtensionDialog,
    cancelExtensionDialog,
    disposeExtensionPanel,
    reloadSessionResources,
    runtimeByThreadId,
    runCommand,
    sendPrompt,
    sessionList,
    sessionsByProject,
    sessions,
    setActiveComposerDraft,
    setExtensionDialogDraft,
    syncActiveEditorText,
    exportActiveSession,
    importActiveSessionFromPicker,
    forkActiveSession,
    navigateBackToPreviousLeaf,
    navigateActiveSessionTree,
    cycleActiveModel,
    cycleActiveThinkingLevel,
    newActiveSession,
    setActiveModel,
    setActiveSessionEntryLabel,
    setActiveAutoCompaction,
    setActiveAutoRetry,
    setActiveThinkingLevel,
    setContextActiveThreadId,
    setActiveProjectId,
    setActiveSessionId,
    setActiveSessionPanelOpen,
    setActiveSessionPanelWidth,
    consumeExtensionPanelMessages,
    setExtensionPanelState,
    switchActivePreviousSession,
    switchActiveSessionPath,
    startNewSession,
    treeFocusRequest,
    unsubscribe
  }
})

/**
 * 将 ThreadSnapshot 转换为 WorkspaceSession。
 * @param snapshot - Thread 快照。
 * @returns 工作区会话对象。
 */
function snapshotToSession(snapshot: ThreadSnapshot): WorkspaceSession {
  return {
    ...snapshotToSummary(snapshot),
    snapshot
  }
}

function mergeSessionTreeChildren(
  roots: NonNullable<ThreadSnapshot['sessionTree']>,
  parentId: string,
  children: NonNullable<ThreadSnapshot['sessionTree']>
): boolean {
  const stack = [...roots]
  while (stack.length > 0) {
    const node = stack.shift()!
    if (node.id === parentId) {
      node.children = children
      node.hasMoreChildren = false
      return true
    }
    stack.unshift(...node.children)
  }
  return false
}

/**
 * 提取 timeline 所需的工具调用结构字段。
 * @param toolCall - 完整工具调用。
 * @returns 轻量结构。
 */
function toToolCallStructure(
  toolCall: ThreadSnapshot['toolCalls'][number]
): WorkspaceToolCallStructure {
  return {
    threadId: toolCall.threadId,
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    args: toolCall.args,
    startedAt: toolCall.startedAt,
    finishedAt: toolCall.finishedAt
  }
}

/**
 * 判断工具调用结构是否相同。
 * @param left - 左侧结构。
 * @param right - 右侧结构。
 * @returns 是否相同。
 */
function isSameToolCallStructure(
  left: WorkspaceToolCallStructure,
  right: WorkspaceToolCallStructure
): boolean {
  return (
    left.threadId === right.threadId &&
    left.toolCallId === right.toolCallId &&
    left.toolName === right.toolName &&
    left.args === right.args &&
    left.startedAt === right.startedAt &&
    left.finishedAt === right.finishedAt
  )
}

/**
 * 从首条 prompt 构造初始标题。
 * @param session - 当前 thread session。
 * @param message - 即将发送的 prompt 文本。
 * @returns 需要设置的标题；已有标题时返回 undefined。
 */
function getInitialPromptTitle(
  session: WorkspaceSession | undefined,
  message: string
): string | undefined {
  if (session?.title) {
    return undefined
  }
  const title = [...message.trim()].slice(0, PROMPT_TITLE_MAX_CHARS).join('')
  return title || undefined
}

/**
 * 判断 thread 是否处于可排队的运行态。
 * @param session - 当前 thread session。
 * @returns 是否正在运行。
 */
function isThreadRunning(session: WorkspaceSession | undefined): boolean {
  return ['queued', 'starting', 'running', 'stopping'].includes(session?.status ?? '')
}

function isSkillCommandName(command: string): boolean {
  return normalizeSkillCommandLabel(command).startsWith('skill:')
}

function normalizeSkillCommandLabel(command: string): string {
  return command.trim().replace(/^\/+/, '')
}

function getSkillNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/').filter(Boolean)
  const fileName = parts.at(-1) ?? ''
  if (fileName.toLowerCase() === 'skill.md' && parts.length >= 2) {
    return parts.at(-2) ?? fileName
  }
  return fileName.replace(/\.[^.]+$/, '')
}

/**
 * 从 Tiptap JSON 中提取纯文本，用于提交 prompt。
 * @param content - Tiptap JSON 内容。
 * @returns 纯文本。
 */
function getComposerText(content: JSONContent): string {
  const cached = composerTextCache.get(content)
  if (cached !== undefined) {
    return cached
  }
  const parts: string[] = []
  collectComposerText(content, parts)
  const text = parts.join('')
  composerTextCache.set(content, text)
  return text
}

/**
 * 从 Tiptap JSON 中提取 fileReference 节点携带的 Pi file args。
 * @param content - Tiptap JSON 内容。
 * @returns 文件参数列表。
 */
function getComposerFileArgs(content: JSONContent): string[] {
  const fileArgs: string[] = []
  collectComposerFileArgs(content, fileArgs)
  return dedupeStrings(fileArgs)
}

/**
 * 从 Tiptap JSON 中提取 skillReference 节点携带的真实 skill 引用。
 * @param content - Tiptap JSON 内容。
 * @returns skill 引用列表。
 */
function getComposerSkillReferences(content: JSONContent): Array<{
  name: string
  path?: string
  baseDir?: string
}> {
  const references: Array<{ name: string; path?: string; baseDir?: string }> = []
  collectComposerSkillReferences(content, references)
  const seen = new Set<string>()
  return references.filter((reference) => {
    const key = `${reference.name}\0${reference.path ?? ''}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

/**
 * 递归收集 fileReference 节点。
 * @param node - Tiptap JSON 节点。
 * @param fileArgs - 文件参数列表。
 */
function collectComposerFileArgs(node: JSONContent, fileArgs: string[]): void {
  if (node.type === 'fileReference') {
    const fileArg = typeof node.attrs?.fileArg === 'string' ? node.attrs.fileArg : ''
    if (fileArg) {
      fileArgs.push(fileArg)
    }
    return
  }
  for (const child of node.content ?? []) {
    collectComposerFileArgs(child, fileArgs)
  }
}

/**
 * 递归收集 skillReference 节点。
 * @param node - Tiptap JSON 节点。
 * @param references - skill 引用列表。
 */
function collectComposerSkillReferences(
  node: JSONContent,
  references: Array<{ name: string; path?: string; baseDir?: string }>
): void {
  if (node.type === 'skillReference') {
    const name = typeof node.attrs?.name === 'string' ? node.attrs.name : ''
    if (name) {
      const path = typeof node.attrs?.path === 'string' ? node.attrs.path : undefined
      const baseDir = typeof node.attrs?.baseDir === 'string' ? node.attrs.baseDir : undefined
      references.push({
        name,
        ...(path ? { path } : {}),
        ...(baseDir ? { baseDir } : {})
      })
    }
    return
  }
  for (const child of node.content ?? []) {
    collectComposerSkillReferences(child, references)
  }
}

/**
 * 按首次出现顺序去重字符串。
 * @param values - 字符串列表。
 * @returns 去重结果。
 */
function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (seen.has(value)) {
      continue
    }
    seen.add(value)
    result.push(value)
  }
  return result
}

/**
 * 递归收集 Tiptap 文本节点。
 * @param node - Tiptap JSON 节点。
 * @param parts - 文本片段。
 */
function collectComposerText(node: JSONContent, parts: string[]): void {
  if (node.type === 'hardBreak') {
    parts.push('\n')
    return
  }
  if (node.type === 'fileReference') {
    const fileArg = typeof node.attrs?.fileArg === 'string' ? node.attrs.fileArg : ''
    if (fileArg) {
      parts.push(formatFileArgForInsertion(fileArg))
    }
    return
  }
  if (node.type === 'skillReference') {
    const name = typeof node.attrs?.name === 'string' ? node.attrs.name : ''
    if (name) {
      parts.push(`$${name}`)
    }
    return
  }
  if (typeof node.text === 'string') {
    parts.push(node.text)
  }
  for (const child of node.content ?? []) {
    collectComposerText(child, parts)
  }
}

/**
 * 合并 session，确保响应式列表更新稳定。
 * @param sessions - session 映射。
 * @param session - 新 session。
 */
function mergeSession(
  sessions: Record<string, WorkspaceSession>,
  session: WorkspaceSession
): WorkspaceSession {
  const existing = sessions[session.threadId]
  const merged: WorkspaceSession = {
    ...session,
    snapshot: mergeThreadSnapshot(existing?.snapshot, session.snapshot)
  }
  // fix: sessions 是 shallowReactive，snapshot/messages 合并必须替换根对象，避免 live 压缩后 timeline 不重算分割线。
  sessions[session.threadId] = reactive(merged) as WorkspaceSession
  return sessions[session.threadId]
}

/**
 * 从 snapshot 合并 session。
 * @param sessions - session 映射。
 * @param snapshot - 新 snapshot。
 */
function mergeSnapshot(
  sessions: Record<string, WorkspaceSession>,
  snapshot: ThreadSnapshot
): WorkspaceSession {
  return mergeSession(sessions, snapshotToSession(snapshot))
}

function sortSessionsByUpdatedAt(sessions: WorkspaceSession[]): WorkspaceSession[] {
  return [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

/**
 * 从 agent event 中提取会话活跃时间。
 * @param event - agent session IPC event。
 * @returns 活跃时间；非会话内容事件返回 undefined。
 */
function getActivityUpdatedAt(event: AgentSessionIpcEvent): string | undefined {
  if (event.type !== 'message_end') {
    return undefined
  }
  const message = event.message
  if (!isConversationMessage(message)) {
    return undefined
  }
  return new Date().toISOString()
}

/**
 * 判断消息是否是用户或 assistant 的会话消息。
 * @param message - 原始 agent message。
 * @returns 是否是会话活跃消息。
 */
function isConversationMessage(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    'role' in message &&
    (message.role === 'user' || message.role === 'assistant')
  )
}

function getModelLabel(model: { provider?: string; id?: string; displayName?: string }): string {
  if (model.displayName) return model.displayName
  if (model.provider && model.id) return `${model.provider}/${model.id}`
  return model.id ?? '未知模型'
}

function getStreamingMessageIds(runtime: WorkspaceSessionRuntime): Set<string> {
  return new Set(
    Object.entries(runtime.renderState)
      .filter(([, state]) => state.renderState === 'streaming')
      .map(([messageId]) => messageId)
  )
}

/**
 * Worker 的 get_messages 不包含尚未完成的 assistant。刷新 live session 时保留 renderer
 * 已通过 canonical events 收到的 streaming 消息，避免切换会话后短暂丢失当前输出。
 */
function preserveStreamingMessages(
  existing: ThreadSnapshot | undefined,
  incoming: ThreadSnapshot,
  streamingMessageIds: ReadonlySet<string>
): ThreadSnapshot {
  if (!existing || streamingMessageIds.size === 0) {
    return incoming
  }
  const incomingTailTime = getLatestMessageTime(incoming.messages)
  const preserved = existing.messages.filter(
    (message) =>
      streamingMessageIds.has(message.id) &&
      isAtOrAfterMessageTime(message, incomingTailTime) &&
      !incoming.messages.some((candidate) => isSameMessageSource(candidate, message))
  )
  return preserved.length > 0
    ? { ...incoming, messages: [...incoming.messages, ...preserved] }
    : incoming
}

function getLatestMessageTime(messages: ThreadSnapshot['messages']): number | undefined {
  let latest: number | undefined
  for (const message of messages) {
    if (!message.createdAt) continue
    const time = Date.parse(message.createdAt)
    if (!Number.isNaN(time) && (latest === undefined || time > latest)) {
      latest = time
    }
  }
  return latest
}

function isAtOrAfterMessageTime(
  message: ThreadSnapshot['messages'][number],
  baseline: number | undefined
): boolean {
  if (baseline === undefined || !message.createdAt) {
    return true
  }
  const time = Date.parse(message.createdAt)
  return Number.isNaN(time) || time >= baseline
}

function isSameMessageSource(
  left: ThreadSnapshot['messages'][number],
  right: ThreadSnapshot['messages'][number]
): boolean {
  return (
    left.id === right.id ||
    (Boolean(left.sessionEntryId) && left.sessionEntryId === right.sessionEntryId) ||
    (Boolean(left.createdAt) && left.role === right.role && left.createdAt === right.createdAt)
  )
}

/**
 * 合并 snapshot。返回新 snapshot 触发 Vue3 依赖，同时复用未变化 message 对象让 keyed DOM 原子化更新。
 * @param existing - 已存在的 snapshot。
 * @param incoming - 新 snapshot。
 * @returns 合并后的 snapshot。
 */
function mergeThreadSnapshot(
  existing: ThreadSnapshot | undefined,
  incoming: ThreadSnapshot | undefined
): ThreadSnapshot | undefined {
  if (!incoming) {
    return existing
  }
  if (!existing) {
    return incoming
  }
  return {
    ...existing,
    ...incoming,
    // mock/轻量 snapshot 可能省略这些可选字段；不能用 undefined 覆盖已有 tree 定位状态。
    sessionFile: incoming.sessionFile ?? existing.sessionFile,
    title: incoming.title ?? existing.title,
    model: incoming.model ?? existing.model,
    sessionTree: incoming.sessionTree ?? existing.sessionTree,
    currentEntryId: incoming.currentEntryId ?? existing.currentEntryId,
    context: 'context' in incoming ? incoming.context : existing.context,
    cost: incoming.cost ?? existing.cost,
    // fix: live 压缩会追加 compaction message；snapshot 必须换引用，但旧消息对象要尽量复用，避免整条 timeline DOM 重建。
    messages: mergeSnapshotMessages(existing.messages, incoming.messages)
  }
}

function mergeSnapshotMessages(
  existingMessages: ThreadSnapshot['messages'],
  incomingMessages: ThreadSnapshot['messages']
): ThreadSnapshot['messages'] {
  const existingById = new Map(existingMessages.map((message) => [message.id, message]))
  return incomingMessages.map((incoming) => {
    const existing = existingById.get(incoming.id)
    return existing && isSameSnapshotMessage(existing, incoming) ? existing : incoming
  })
}

function isSameSnapshotMessage(
  left: ThreadSnapshot['messages'][number],
  right: ThreadSnapshot['messages'][number]
): boolean {
  return (
    left === right ||
    (left.id === right.id &&
      left.sessionEntryId === right.sessionEntryId &&
      left.role === right.role &&
      left.text === right.text &&
      left.createdAt === right.createdAt &&
      isSameStringArray(left.toolCallIds, right.toolCallIds) &&
      isSameSystemEvent(left.systemEvent, right.systemEvent))
  )
}

function isSameSystemEvent(
  left: ThreadSnapshot['messages'][number]['systemEvent'],
  right: ThreadSnapshot['messages'][number]['systemEvent']
): boolean {
  return (
    left === right ||
    (left?.kind === right?.kind &&
      left?.title === right?.title &&
      left?.description === right?.description &&
      isSameStringArray(left?.meta, right?.meta))
  )
}

function isSameStringArray(left: string[] | undefined, right: string[] | undefined): boolean {
  if (left === right) {
    return true
  }
  if (!left || !right || left.length !== right.length) {
    return false
  }
  return left.every((value, index) => value === right[index])
}

/**
 * 获取事件关联的 threadId。
 * @param event - IPC event。
 * @returns threadId 或空字符串。
 */
export function getEventThreadId(event: CodingAgentIpcEvent): string {
  return 'threadId' in event && event.threadId ? event.threadId : ''
}

/**
 * 将 IPC event 投影到 session snapshot。
 * @param sessions - session 映射。
 * @param event - IPC event。
 * @param onMessageRevision - 消息更新时触发的回调。
 */
export function applyEventToSessions(
  sessions: Record<string, WorkspaceSession>,
  event: CodingAgentIpcEvent,
  onMessageRevision?: (messageId: string, renderState: 'streaming' | 'complete') => void
): void {
  if (event.type === 'threadSnapshot') {
    mergeSnapshot(sessions, event.snapshot)
    return
  }
  if (event.type === 'projection') {
    const session = sessions[event.threadId]
    if (!session) {
      return
    }
    if (event.event.type === 'thread.stateChanged') {
      sessions[event.threadId] = applySessionStatus(session, event.event.status)
    }
    if (!sessions[event.threadId].snapshot) {
      return
    }
    const nextSession = sessions[event.threadId]
    if (!nextSession.snapshot) {
      return
    }
    applyProjectionEvent(nextSession.snapshot, event.event)
    sessions[event.threadId] = applySessionStatus(nextSession, nextSession.snapshot.status)
    return
  }
  if (event.type === 'threadWorker') {
    const threadId = event.threadId
    const session = threadId ? sessions[threadId] : undefined
    if (!threadId || !session) {
      return
    }
    sessions[threadId] = applyThreadWorkerEventToSession(session, event.event)
    return
  }
  if (isAgentSessionEventType(event)) {
    const session = sessions[event.threadId]
    if (!session) {
      return
    }
    const status = getStatusFromAgentSessionEvent(event as AgentSessionIpcEvent)
    let nextSession = session
    if (status) {
      // sessions 是 shallowReactive，不能只改嵌套 status，否则 running/idle UI 可能不刷新。
      nextSession = applySessionStatus(nextSession, status)
      sessions[event.threadId] = nextSession
    }
    if (!nextSession.snapshot) {
      return
    }
    const messageId = applyAgentSessionEvent(nextSession.snapshot, event as AgentSessionIpcEvent)
    nextSession = applySessionStatus(nextSession, nextSession.snapshot.status)
    sessions[event.threadId] = nextSession
    const updatedAt = getActivityUpdatedAt(event as AgentSessionIpcEvent)
    if (updatedAt) {
      sessions[event.threadId] = {
        ...sessions[event.threadId],
        updatedAt
      }
    }
    if (messageId && onMessageRevision) {
      onMessageRevision(messageId, event.type === 'message_end' ? 'complete' : 'streaming')
    }
  }
}

function getStatusFromAgentSessionEvent(
  event: AgentSessionIpcEvent
): WorkspaceSession['status'] | undefined {
  switch (event.type) {
    case 'agent_start':
    case 'turn_start':
      return 'running'
    case 'turn_end':
      return 'idle'
    case 'agent_end':
      return event.willRetry ? undefined : 'idle'
    default:
      return undefined
  }
}

type ProjectionIpcEvent = Extract<CodingAgentIpcEvent, { type: 'projection' }>['event']
type ThreadWorkerEvent = Extract<CodingAgentIpcEvent, { type: 'threadWorker' }>['event']
type AgentMessageIpcEvent = Extract<
  AgentSessionIpcEvent,
  { type: 'message_start' | 'message_end' | 'message_update' }
>
type ToolUpdateIpcEvent = Extract<AgentSessionIpcEvent, { type: 'tool_execution_update' }>

/**
 * 获取工具更新节流 key。
 * @param event - 工具更新事件。
 * @returns key。
 */
function getToolUpdateEventKey(event: ToolUpdateIpcEvent): string {
  return `${event.threadId}:${event.toolCallId}`
}

function applyThreadWorkerEventToRuntime(
  sessions: Record<string, WorkspaceSession>,
  runtimes: Record<string, WorkspaceSessionRuntime>,
  event: Extract<CodingAgentIpcEvent, { type: 'threadWorker' }>
): void {
  if (!event.threadId) {
    return
  }
  const session = sessions[event.threadId]
  if (session) {
    sessions[event.threadId] = applyThreadWorkerEventToSession(session, event.event)
  }
  if (event.event.type === 'worker.run.failed') {
    const runtime = runtimes[event.threadId]
    if (!runtime) {
      return
    }
    clearPendingRuntimeInteractions(runtime)
    const createdAt = new Date(event.event.createdAt).toISOString()
    upsertRuntimeTimelineEvent(runtime, {
      id: `worker-failed:${event.event.createdAt}`,
      type: 'worker-error',
      title: 'Worker 启动失败',
      message: event.event.message,
      createdAt,
      meta: ['worker', 'failed']
    })
    runtime.errorMessage = event.event.message
    return
  }
  if (event.event.type !== 'worker.run.finished') {
    return
  }
  const runtime = runtimes[event.threadId]
  if (!runtime) {
    return
  }
  clearPendingRuntimeInteractions(runtime)
  if (event.event.reason !== 'crash') {
    return
  }
  for (const key of Object.keys(runtime.renderState)) {
    if (runtime.renderState[key]?.renderState === 'streaming') {
      runtime.renderState[key] = {
        revision: runtime.renderState[key].revision + 1,
        renderState: 'complete'
      }
    }
  }
  const message = event.event.message ?? 'worker crashed'
  upsertRuntimeTimelineEvent(runtime, {
    id: `worker-crash:${event.event.workerId}:${event.event.exitedAt}`,
    type: 'worker-error',
    title: 'Worker 已崩溃',
    message,
    createdAt: new Date(event.event.exitedAt).toISOString(),
    meta: ['worker', 'crash']
  })
  runtime.errorMessage = message
}

function clearPendingRuntimeInteractions(runtime: WorkspaceSessionRuntime): void {
  runtime.approvals = {}
  runtime.extensionDialogQueue = []
  runtime.extensionDialogDrafts = {}
  runtime.extensionDialogResponding = {}
  runtime.extensionDialogErrors = {}
}

function upsertRuntimeTimelineEvent(
  runtime: WorkspaceSessionRuntime,
  event: WorkspaceRuntimeTimelineEvent
): void {
  const index = runtime.timelineEvents.findIndex((item) => item.id === event.id)
  if (index >= 0) {
    runtime.timelineEvents[index] = event
    return
  }
  runtime.timelineEvents.push(event)
}

function applyThreadWorkerEventToSession(
  session: WorkspaceSession,
  event: ThreadWorkerEvent
): WorkspaceSession {
  if (event.type === 'worker.run.failed') {
    return applySessionStatus(session, 'error', { steering: [], followUp: [] })
  }
  if (event.type !== 'worker.run.finished') {
    return session
  }
  const status = getStatusFromWorkerFinishedReason(event.reason)
  if (event.reason !== 'crash' || !session.snapshot) {
    return applySessionStatus(session, status)
  }
  const snapshot = cloneSnapshotForRuntimeUpdate(session.snapshot)
  snapshot.status = status
  const finishedAt = new Date(event.exitedAt).toISOString()
  failPendingToolCalls(snapshot, event.message ?? 'worker crashed', finishedAt, {
    overwriteSummary: true
  })
  snapshot.queue = { steering: [], followUp: [] }
  return {
    ...session,
    status,
    snapshot
  }
}

function applySessionStatus(
  session: WorkspaceSession,
  status: WorkspaceSession['status'],
  queue?: ThreadSnapshot['queue']
): WorkspaceSession {
  return {
    ...session,
    status,
    snapshot: session.snapshot
      ? {
          ...session.snapshot,
          status,
          ...(queue ? { queue } : {})
        }
      : undefined
  }
}

function cloneSnapshotForRuntimeUpdate(snapshot: ThreadSnapshot): ThreadSnapshot {
  return {
    ...snapshot,
    toolCalls: snapshot.toolCalls.map((toolCall) => ({ ...toolCall })),
    queue: { ...snapshot.queue }
  }
}

function getStatusFromWorkerFinishedReason(
  reason: Extract<ThreadWorkerEvent, { type: 'worker.run.finished' }>['reason']
): WorkspaceSession['status'] {
  if (reason === 'crash') {
    return 'error'
  }
  if (reason === 'idle') {
    return 'idle'
  }
  return 'stopped'
}

/**
 * 解析消息渲染状态 key。
 * @param key - threadId:messageId。
 * @returns threadId 与 messageId。
 */
function parseMessageRenderStateKey(key: string): { threadId: string; messageId: string } {
  const separatorIndex = key.indexOf(':')
  if (separatorIndex < 0) {
    return { threadId: key, messageId: '' }
  }
  return {
    threadId: key.slice(0, separatorIndex),
    messageId: key.slice(separatorIndex + 1)
  }
}

/**
 * 判断 extension notify 是否应进入右侧栏，而不是完整展示在 toast 内。
 * @param message - notify 文案。
 * @returns 是否需要收纳到面板。
 */
function shouldShowExtensionNotifyInPanel(message: string): boolean {
  return message.length > EXTENSION_INLINE_NOTIFY_MAX_CHARS || message.includes('\n')
}

/**
 * 获取 extension notify 在状态区展示的短摘要。
 * @param message - notify 文案。
 * @returns 状态区摘要。
 */
function getExtensionNotifySummary(message: string): string {
  if (!shouldShowExtensionNotifyInPanel(message)) {
    return message
  }
  const firstLine = message.split(/\r?\n/, 1)[0]?.trim() ?? ''
  const summary = firstLine || message.trim()
  if (summary.length <= EXTENSION_INLINE_NOTIFY_MAX_CHARS) {
    return summary
  }
  return `${summary.slice(0, EXTENSION_INLINE_NOTIFY_MAX_CHARS - 1)}…`
}

/**
 * 应用 agent session event。
 * @param snapshot - snapshot。
 * @param event - agent session event。
 */
function applyAgentSessionEvent(
  snapshot: ThreadSnapshot,
  event: AgentSessionIpcEvent
): string | undefined {
  switch (event.type) {
    case 'agent_start':
    case 'turn_start':
      snapshot.status = 'running'
      return undefined
    case 'agent_end':
      if (!event.willRetry) {
        snapshot.status = 'idle'
      }
      return undefined
    case 'turn_end':
      snapshot.status = 'idle'
      // 从 turn_end 的 message 中提取 usage（与 coding-agent 逻辑一致）
      if (event.message && 'usage' in event.message) {
        const assistantMsg = event.message as {
          role: 'assistant'
          usage?: {
            totalTokens?: number
            input?: number
            output?: number
            cacheRead?: number
            cacheWrite?: number
          }
          stopReason?: string
        }
        const usage = assistantMsg.usage
        if (
          assistantMsg.stopReason !== 'aborted' &&
          assistantMsg.stopReason !== 'error' &&
          usage &&
          snapshot.context
        ) {
          const totalTokens =
            usage.totalTokens ||
            (usage.input || 0) +
              (usage.output || 0) +
              (usage.cacheRead || 0) +
              (usage.cacheWrite || 0)
          if (totalTokens > 0) {
            const contextWindow = snapshot.context.contextWindow
            const nextContext: NonNullable<ThreadSnapshot['context']> = { tokens: totalTokens }
            if (contextWindow !== undefined) {
              nextContext.contextWindow = contextWindow
              if (contextWindow > 0) {
                nextContext.percent = Math.round((totalTokens / contextWindow) * 100)
              }
            }
            snapshot.context = nextContext
          }
        }
      }
      return undefined
    case 'thinking_level_changed':
      snapshot.thinkingLevel = event.level
      return undefined
    case 'model_changed':
      snapshot.model = event.model
      return undefined
    case 'queue_update':
      snapshot.queue = {
        steering: [...event.steering],
        followUp: [...event.followUp]
      }
      return undefined
    case 'message_start':
    case 'message_end':
    case 'message_update':
      applyAssistantToolCallBlocks(snapshot, event.message)
      return upsertMessageEvent(snapshot, event)
    case 'tool_execution_start':
    case 'tool_execution_update':
    case 'tool_execution_end':
      upsertToolExecutionEvent(snapshot, event)
      return undefined
  }
  return undefined
}

/**
 * 应用 agent message event。
 * @param snapshot - snapshot。
 * @param event - agent message event。
 * @returns 被更新的消息 ID，若未更新则返回 undefined。
 */
function upsertMessageEvent(
  snapshot: ThreadSnapshot,
  event: AgentMessageIpcEvent
): string | undefined {
  const content = toDesktopMessageContent(event.message)
  if (!content) {
    return undefined
  }
  const id = getPiMessageId(snapshot.messages, content)
  upsertById(snapshot.messages, {
    id,
    ...content,
    ...(event.sessionEntryId ? { sessionEntryId: event.sessionEntryId } : {})
  })
  return id
}

/**
 * 从 assistant message 的 toolCall block 预先派生工具调用结构。
 * @param snapshot - snapshot。
 * @param message - agent message。
 */
function applyAssistantToolCallBlocks(
  snapshot: ThreadSnapshot,
  message: AgentMessageIpcEvent['message']
): void {
  if (isAssistantErrorMessage(message)) {
    return
  }
  if (message.role !== 'assistant' || !('content' in message) || !Array.isArray(message.content)) {
    return
  }
  for (const block of message.content) {
    if (
      !isRecord(block) ||
      block.type !== 'toolCall' ||
      typeof block.id !== 'string' ||
      !hasDisplayToolName(block.name)
    ) {
      continue
    }
    const existing = snapshot.toolCalls.find((item) => item.toolCallId === block.id)
    upsertUnknown(
      snapshot.toolCalls,
      {
        threadId: snapshot.threadId,
        toolCallId: block.id,
        toolName: block.name,
        status: existing?.status ?? 'queued',
        args: 'arguments' in block ? block.arguments : existing?.args,
        startedAt: existing?.startedAt,
        finishedAt: existing?.finishedAt
      },
      'toolCallId'
    )
  }
}

/**
 * 获取 assistant message 中已具名的 toolCallId。
 * @param message - agent message。
 * @returns toolCallId 列表。
 */
function getNamedAssistantToolCallIds(message: AgentMessageIpcEvent['message']): string[] {
  if (message.role !== 'assistant' || !('content' in message) || !Array.isArray(message.content)) {
    return []
  }
  const ids: string[] = []
  for (const block of message.content) {
    if (
      isRecord(block) &&
      block.type === 'toolCall' &&
      typeof block.id === 'string' &&
      hasDisplayToolName(block.name)
    ) {
      ids.push(block.id)
    }
  }
  return ids
}

/**
 * 判断工具名是否可展示。
 * @param value - 原始工具名。
 * @returns 是否非空字符串。
 */
function hasDisplayToolName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isAssistantErrorMessage(
  message: AgentMessageIpcEvent['message']
): message is AgentMessageIpcEvent['message'] & Record<string, unknown> {
  return message.role === 'assistant' && isRecord(message) && message.stopReason === 'error'
}

/**
 * 应用 agent tool execution event，保留原始事件结构。
 * @param snapshot - snapshot。
 * @param event - agent tool execution event。
 */
function upsertToolExecutionEvent(
  snapshot: ThreadSnapshot,
  event: Extract<
    AgentSessionIpcEvent,
    { type: 'tool_execution_start' | 'tool_execution_update' | 'tool_execution_end' }
  >
): void {
  const existing = snapshot.toolCalls.find((item) => item.toolCallId === event.toolCallId)
  const toolName = getCanonicalToolName(existing?.toolName, event.toolName)
  const base = {
    threadId: snapshot.threadId,
    toolCallId: event.toolCallId,
    toolName,
    args: 'args' in event ? mergeToolArgs(existing?.args, event.args, toolName) : existing?.args,
    rawEvent: event
  } satisfies Partial<ThreadSnapshot['toolCalls'][number]> & { rawEvent: typeof event }

  if (event.type === 'tool_execution_start') {
    upsertUnknown(
      snapshot.toolCalls,
      {
        ...base,
        status: 'running',
        startedAt: existing?.startedAt ?? new Date().toISOString()
      },
      'toolCallId'
    )
    return
  }

  if (event.type === 'tool_execution_update') {
    upsertUnknown(
      snapshot.toolCalls,
      {
        ...base,
        status: existing?.status ?? 'running',
        partialResult: event.partialResult
      },
      'toolCallId'
    )
    return
  }

  upsertUnknown(
    snapshot.toolCalls,
    {
      ...base,
      status: event.isError ? 'failed' : 'succeeded',
      result: event.result,
      resultSummary: summarizeToolResult(event.result),
      finishedAt: new Date().toISOString()
    },
    'toolCallId'
  )
}

/**
 * 获取工具调用的 canonical 展示名。
 * assistant toolCall.name 是工具身份来源；tool execution/result 只能补充状态和结果，
 * 不能用通用 tool 名称覆盖已经具名的工具调用。
 * @param existingName - 已有工具名。
 * @param incomingName - 事件工具名。
 * @returns 合并后的工具名。
 */
function getCanonicalToolName(existingName: unknown, incomingName: unknown): string {
  if (hasDisplayToolName(existingName) && isGenericToolName(incomingName)) {
    return existingName
  }
  if (hasDisplayToolName(incomingName)) {
    return incomingName
  }
  if (hasDisplayToolName(existingName)) {
    return existingName
  }
  return 'tool'
}

/**
 * 判断是否为低置信通用工具名。
 * @param value - 原始工具名。
 * @returns 是否为通用工具名。
 */
function isGenericToolName(value: unknown): boolean {
  return !hasDisplayToolName(value) || value === 'tool'
}

/**
 * 应用 projection event。
 * @param snapshot - snapshot。
 * @param event - projection event。
 */
function applyProjectionEvent(snapshot: ThreadSnapshot, event: ProjectionIpcEvent): void {
  switch (event.type) {
    case 'thread.stateChanged':
      snapshot.status = event.status
      if (event.status === 'error' || event.status === 'stopped') {
        failPendingToolCalls(snapshot, `thread ${event.status}`)
      }
      return
    case 'approval.requested':
      upsertUnknown(snapshot.approvals, event.approval, 'approvalId')
      return
    case 'file.changed': {
      snapshot.fileChanges.push(event.change)
      return
    }
    case 'thread.error': {
      snapshot.diagnostics.push(event.diagnostic)
      return
    }
  }
}

/**
 * 生成工具结果简短文本，兼容现有 DesktopToolCall resultSummary。
 * @param result - 原始工具结果。
 * @returns 结果摘要。
 */
function failPendingToolCalls(
  snapshot: ThreadSnapshot,
  resultSummary: string,
  finishedAt = new Date().toISOString(),
  options: { overwriteSummary?: boolean } = {}
): void {
  for (const toolCall of snapshot.toolCalls) {
    const canFailToolCall = toolCall.status === 'running' || toolCall.status === 'queued'
    const canRefineFailedSummary = options.overwriteSummary && toolCall.status === 'failed'
    if (canFailToolCall || canRefineFailedSummary) {
      toolCall.status = 'failed'
      toolCall.finishedAt = toolCall.finishedAt ?? finishedAt
      toolCall.resultSummary =
        options.overwriteSummary || !toolCall.resultSummary ? resultSummary : toolCall.resultSummary
    }
  }
}

function summarizeToolResult(result: unknown): string | undefined {
  if (typeof result === 'string') {
    return result
  }
  if (!isRecord(result)) {
    return undefined
  }
  const content = result.content
  if (typeof content === 'string') {
    return content
  }
  const text = result.text
  if (typeof text === 'string') {
    return text
  }
  const message = result.message
  if (typeof message === 'string') {
    return message
  }
  return undefined
}

/**
 * 合并工具参数。若收起态摘要所需参数已经存在，则不再解析 update args。
 * @param existingArgs - 已有参数。
 * @param incomingArgs - 新参数。
 * @param toolName - 工具名。
 * @returns 合并后的参数。
 */
function mergeToolArgs(existingArgs: unknown, incomingArgs: unknown, toolName: string): unknown {
  if (hasRequiredToolArgs(existingArgs, toolName)) {
    return existingArgs
  }
  const existing = toArgsRecord(existingArgs, toolName)
  const incoming = toArgsRecord(incomingArgs, toolName)
  if (!existing && !incoming) {
    return incomingArgs ?? existingArgs
  }
  return {
    ...(existing ?? {}),
    ...(incoming ?? {})
  }
}

/**
 * 判断工具收起态摘要所需参数是否已齐。
 * @param args - 参数。
 * @param toolName - 工具名。
 * @returns 是否已齐。
 */
function hasRequiredToolArgs(args: unknown, toolName: string): boolean {
  const keys = getToolSummaryArgKeys(toolName)
  if (keys.length === 0) {
    return isRecord(args)
  }
  const record = isRecord(args) ? args : undefined
  return Boolean(record && keys.every((key) => typeof record[key] === 'string' && record[key]))
}

/**
 * 转换参数为对象；字符串参数只按当前工具需要的字段做轻量解析。
 * @param value - 参数值。
 * @param toolName - 工具名。
 * @returns 参数对象。
 */
function toArgsRecord(value: unknown, toolName: string): Record<string, unknown> | undefined {
  if (isRecord(value)) {
    return value
  }
  if (typeof value !== 'string') {
    return undefined
  }
  try {
    const parsed = JSON.parse(value)
    if (isRecord(parsed)) {
      return parsed
    }
  } catch {
    return parseSummaryArgsFromText(value, toolName)
  }
  return undefined
}

/**
 * 从流式参数文本中解析收起态摘要需要的字段。
 * @param value - 参数文本。
 * @param toolName - 工具名。
 * @returns 参数对象。
 */
function parseSummaryArgsFromText(
  value: string,
  toolName: string
): Record<string, unknown> | undefined {
  const args: Record<string, unknown> = {}
  for (const key of getToolSummaryArgKeys(toolName)) {
    const escapedKey = escapeRegExp(key)
    const match = value.match(new RegExp(`["']?${escapedKey}["']?\\s*:\\s*(["'])(.*?)\\1`, 's'))
    if (match?.[2]) {
      args[key] = match[2]
    }
  }
  return Object.keys(args).length > 0 ? args : undefined
}

/**
 * 获取工具收起态最关键的摘要参数字段。
 * @param toolName - 工具名。
 * @returns 字段名列表。
 */
function getToolSummaryArgKeys(toolName: string): string[] {
  switch (toolName) {
    case 'bash':
      return ['command']
    case 'read':
    case 'edit':
    case 'write':
      return ['path']
    case 'grep':
    case 'find':
      return ['pattern']
    default:
      return []
  }
}

/**
 * 转义正则字面量。
 * @param value - 文本。
 * @returns 转义后的文本。
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 获取 Pi message event 的 UI 稳定 id。
 * @param items - 现有消息。
 * @param message - Pi message。
 * @param role - 消息角色。
 * @param text - 消息文本。
 * @returns 消息 id。
 */
function getPiMessageId(items: ThreadMessage[], message: Omit<ThreadMessage, 'id'>): string {
  if (message.createdAt) {
    return `${message.role}-${message.createdAt}`
  }
  return getStreamingMessageId(items, message.role, message.text)
}

/**
 * 通过 id upsert 消息。
 * @param items - 消息数组。
 * @param item - 消息。
 */
function upsertById(items: ThreadMessage[], item: ThreadMessage): void {
  const index = items.findIndex((existing) => existing.id === item.id)
  if (index >= 0) {
    items[index] = { ...items[index], ...item }
    return
  }
  items.push(item)
}

/**
 * 获取缺少稳定 id 的流式消息 id。
 * @param items - 现有消息。
 * @param role - 消息角色。
 * @param text - 新文本。
 * @returns 可复用或新建的消息 id。
 */
function getStreamingMessageId(
  items: ThreadMessage[],
  role: ThreadMessage['role'],
  text: string | undefined
): string {
  const last = items[items.length - 1]
  if (last?.role === role && isStreamingTextUpdate(last.text, text)) {
    return last.id
  }
  return `message-${items.length}`
}

/**
 * 判断新文本是否像同一条消息的流式更新。
 * @param existing - 已有文本。
 * @param incoming - 新文本。
 * @returns 是否应复用同一条消息。
 */
function isStreamingTextUpdate(
  existing: string | undefined,
  incoming: string | undefined
): boolean {
  if (!existing || !incoming) {
    return true
  }
  return incoming.startsWith(existing) || existing.startsWith(incoming)
}

/**
 * 通过字段 upsert unknown object。
 * @param items - 数组。
 * @param item - 对象。
 * @param key - key。
 */
function upsertUnknown<T extends object>(items: T[], item: T, key: string): void {
  const id = getString(getObjectValue(item, key))
  if (!id) {
    items.push(item)
    return
  }
  const index = items.findIndex((existing) => getObjectValue(existing, key) === id)
  if (index >= 0) {
    const existing = items[index]
    items[index] = isRecord(existing) ? ({ ...existing, ...item } as T) : item
    return
  }
  items.push(item)
}

/**
 * 从对象读取动态字段。
 * @param value - 对象。
 * @param key - key。
 * @returns 字段值。
 */
function getObjectValue(value: object, key: string): unknown {
  return (value as Record<string, unknown>)[key]
}

/**
 * 是否 ThreadStatus。
 * @param value - 值。
 * @returns 是否线程状态。
 */
/**
 * 读取字符串。
 * @param value - 值。
 * @returns 字符串或 undefined。
 */
function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * 合并命令列表并按来源与名称去重。
 * @param groups - 命令列表。
 * @returns 合并后的命令列表。
 */
function mergeCommandInfos(...groups: CommandInfo[][]): CommandInfo[] {
  const merged: CommandInfo[] = []
  const seen = new Set<string>()
  for (const command of groups.flat()) {
    const key = `${command.source}:${command.name}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    merged.push(command)
  }
  return merged
}

/**
 * 规范化 slash command 名称。
 * @param command - command 名称，可带斜杠。
 * @returns 不带斜杠的 command 名称。
 */
function normalizeCommandName(command: string): string {
  return command.trim().replace(/^\/+/, '')
}

/**
 * 判断是否为后端真实 agent session 事件。
 * @param event - IPC event。
 * @returns 是否 agent session event。
 */
function isAgentSessionEventType(event: CodingAgentIpcEvent): event is AgentSessionIpcEvent {
  return agentSessionEventTypes.has(event.type as AgentSessionIpcEvent['type'])
}

/**
 * 判断普通对象。
 * @param value - 值。
 * @returns 是否对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 从 ThreadSnapshot 生成 ThreadSummary。
 * @param snapshot - Thread 快照。
 * @returns Thread 摘要。
 */
function snapshotToSummary(snapshot: ThreadSnapshot): ThreadSummary {
  return {
    threadId: snapshot.threadId,
    projectId: snapshot.projectId,
    sessionFile: snapshot.sessionFile,
    title: snapshot.title,
    status: snapshot.status,
    lineage: snapshot.lineage,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
}
