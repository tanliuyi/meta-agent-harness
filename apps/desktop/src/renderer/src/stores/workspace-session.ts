/**
 * workspace-session.ts - 管理 renderer 中 coding thread 的状态与 IPC 调用。
 */

import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowReactive } from 'vue'
import useWorkspaceProjectStore from './workspace-project'
import { formatFileArgForInsertion } from '../../../../../../packages/coding-agent/src/core/file-reference-format'
import { toDesktopMessageContent } from '@shared/coding-agent/types'
import type { JSONContent } from '@tiptap/vue-3'
import type {
  AgentSessionIpcEvent,
  ApprovalRequest,
  ApprovalResponse,
  CodingAgentIpcEvent,
  PromptImage,
  PromptImageFile,
  PromptImageAttachment,
  ThreadSnapshot,
  ThreadMessage,
  ThreadSummary
} from '@shared/coding-agent/types'

const PROMPT_TITLE_MAX_CHARS = 30

/** 会话面板 UI 状态。 */
export type SessionUiState = {
  /** 面板是否展开。 */
  panelOpen: boolean
  /** 面板宽度。 */
  panelWidth: number
}

/** Composer 中尚未发送的图片附件。 */
export type ComposerImageAttachment = PromptImageAttachment & {
  /** 前端稳定 ID。 */
  id: string
}

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
  /** 未选中会话时的临时 Composer 草稿。 */
  orphanDraftMessage: JSONContent
  /** 当前上下文内每个 thread 独立的 Composer 草稿。 */
  composerDrafts: Record<string, JSONContent>
  /** 未选中会话时的临时图片草稿。 */
  orphanImageAttachments: ComposerImageAttachment[]
  /** 当前上下文内每个 thread 独立的图片草稿。 */
  composerImageAttachments: Record<string, ComposerImageAttachment[]>
  /** 当前上下文的面板 UI 状态。 */
  panel: SessionUiState
}

/** 单个 thread 的运行态。 */
export type WorkspaceSessionRuntime = {
  /** 待处理的审批请求。 */
  approvals: Record<string, ApprovalRequest>
  /** 最近接收到的 IPC 事件列表。 */
  events: CodingAgentIpcEvent[]
  /** 消息渲染状态，key 为 messageId。 */
  renderState: Record<string, MessageRenderState>
  /** 是否正在刷新当前 thread snapshot。 */
  loadingSnapshot: boolean
  /** 当前 thread 最近一次错误。 */
  errorMessage?: string
}

/** 会话面板最小宽度。 */
const minSessionPanelWidth = 220

/** 会话面板最大宽度。 */
const maxSessionPanelWidth = 460

/** 默认会话上下文 ID。 */
const defaultSessionContextId = 'main'

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
  'compaction_end',
  'auto_retry_start',
  'auto_retry_end'
])

/**
 * 创建默认会话 UI 状态。
 * @returns 默认会话 UI 状态。
 */
const createUiState = (): SessionUiState => ({
  panelOpen: true,
  panelWidth: 300
})

/**
 * 创建空白 Composer 文档。
 * @returns Tiptap 空文档。
 */
const createEmptyComposerContent = (): JSONContent => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph'
    }
  ]
})

/**
 * Composer 文本缓存，避免频繁从同一份 Tiptap JSON 递归取文本。
 */
const composerTextCache = new WeakMap<JSONContent, string>()

/**
 * Workspace Session Store。
 * 负责加载、创建、管理 thread，处理 IPC 事件以及审批请求。
 */
export default defineStore('workspace-session', () => {
  /** 全局错误提示信息。 */
  const globalErrorMessage = ref<string>()

  /** 是否正在加载 thread 列表。 */
  const loadingThreads = ref(false)

  /** 所有会话数据。 */
  const sessions = shallowReactive<Record<string, WorkspaceSession>>({})

  /** 每个视图上下文的选择态与 UI 状态。 */
  const contexts = shallowReactive<Record<string, WorkspaceSessionContext>>({})

  /** 每个 thread 的运行态。 */
  const runtimeByThreadId = shallowReactive<Record<string, WorkspaceSessionRuntime>>({})

  const workspaceProject = useWorkspaceProjectStore()

  /** 待提交的渲染版本更新。 */
  const pendingRevisions = new Map<string, MessageRenderState>()
  let revisionFlushId: number | null = null

  /** 待提交的 agent message 事件，按 thread + message 合并。 */
  const pendingMessageEvents = new Map<string, AgentMessageIpcEvent>()
  let messageEventFlushId: number | null = null

  /** 待提交的工具更新事件，按 thread + toolCall 合并。 */
  const pendingToolUpdateEvents = new Map<string, ToolUpdateIpcEvent>()
  let toolUpdateEventFlushId: number | null = null

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
      panel: createUiState()
    }) as WorkspaceSessionContext
    return contexts[contextId]
  }

  /**
   * 确保指定 thread 的运行态存在。
   * @param threadId - thread ID。
   * @returns thread 运行态。
   */
  function ensureRuntime(threadId: string): WorkspaceSessionRuntime {
    runtimeByThreadId[threadId] ??= reactive({
      approvals: {},
      events: [],
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

  /**
   * 获取上下文选中的 thread ID。
   * @param contextId - 上下文 ID。
   * @returns thread ID。
   */
  function getContextActiveThreadId(contextId = defaultSessionContextId): string | undefined {
    return ensureSessionContext(contextId).activeThreadId
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
    if (threadId) {
      context.selectedProjectId = sessions[threadId]?.projectId ?? context.selectedProjectId
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
    context.selectedProjectId = projectId
    globalErrorMessage.value = undefined
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
    for (const threadId of Object.keys(runtimeByThreadId)) {
      if (!existingThreadIds.has(threadId)) {
        delete runtimeByThreadId[threadId]
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
      return
    }

    const messageId = getPiMessageId(snapshot.messages, content)
    pendingMessageEvents.set(getMessageRenderStateKey(event.threadId, messageId), event)
    if (messageEventFlushId === null) {
      messageEventFlushId = requestAnimationFrame(flushPendingMessageEvents)
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
   * 所有消息标记为完成态；新消息初始化为版本 1。
   * @param snapshot - 线程快照。
   */
  function syncRenderStateFromSnapshot(snapshot: ThreadSnapshot): void {
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
        renderState: 'complete'
      }
    }
  }

  /** 默认上下文。 */
  const mainContext = computed(() => ensureSessionContext(defaultSessionContextId))

  /** 当前活跃会话 ID。 */
  const activeSessionId = computed(() => mainContext.value.activeThreadId)

  /** 当前活跃会话对象。 */
  const activeSession = computed(() => {
    return activeSessionId.value ? sessions[activeSessionId.value] : undefined
  })

  /** 当前活跃会话的快照。 */
  const activeSnapshot = computed(() => activeSession.value?.snapshot)

  /** 当前活跃或新会话草稿所属 Project ID。 */
  const activeProjectId = computed(
    () => activeSession.value?.projectId ?? mainContext.value.selectedProjectId
  )

  /** 当前是否处于尚未创建 thread 的新会话草稿态。 */
  const isNewSessionActive = computed(
    () => !activeSessionId.value && Boolean(mainContext.value.selectedProjectId)
  )

  /** 当前活跃 thread 的运行态。 */
  const activeRuntime = computed(() => getRuntime(activeSessionId.value))

  /** 当前活跃会话面板状态。 */
  const activeSessionPanel = computed(() => mainContext.value.panel)

  /** 当前活跃会话的审批请求。 */
  const activePendingApprovals = computed(() => activeRuntime.value?.approvals ?? {})

  /** 当前活跃会话的最近事件。 */
  const activeEvents = computed(() => activeRuntime.value?.events ?? [])

  /** 当前活跃会话的 Composer 草稿，按 session 隔离。 */
  const draftMessage = computed({
    get: () => {
      const threadId = activeSessionId.value
      const context = mainContext.value
      return threadId
        ? ensureComposerDraft(context.composerDrafts, threadId)
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
      ? ensureComposerImages(context.composerImageAttachments, threadId)
      : context.orphanImageAttachments
  })

  /** 当前活跃会话是否有可发送草稿。 */
  const hasDraftMessage = computed(
    () =>
      Boolean(getComposerText(draftMessage.value).trim()) ||
      draftImages.value.length > 0
  )

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
   * 仅刷新仍然有效的活跃 thread；没有活跃 thread 时保持新会话空态。
   */
  const loadThreads = async (contextId = defaultSessionContextId): Promise<void> => {
    loadingThreads.value = true
    globalErrorMessage.value = undefined
    try {
      const threads = await window.api.codingAgent.listThreads()
      for (const thread of threads) {
        mergeSession(sessions, thread)
        ensureRuntime(thread.threadId)
      }
      pruneThreadScopedState(new Set(threads.map((thread) => thread.threadId)))
      const context = ensureSessionContext(contextId)
      const activeExists =
        context.activeThreadId &&
        threads.some((thread) => thread.threadId === context.activeThreadId)
      if (!activeExists) {
        context.activeThreadId = undefined
      }
      if (context.activeThreadId) {
        await refreshSnapshot(context.activeThreadId)
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
    contextId = defaultSessionContextId
  ): Promise<void> => {
    if (!projectId) {
      globalErrorMessage.value = '请先打开 Project'
      return
    }
    loadingThreads.value = true
    globalErrorMessage.value = undefined
    try {
      const snapshot = await window.api.codingAgent.createThread({ projectId })
      mergeSnapshot(sessions, snapshot)
      ensureRuntime(snapshot.threadId)
      syncRenderStateFromSnapshot(snapshot)
      setContextActiveThreadId(snapshot.threadId, contextId)
    } catch (error) {
      globalErrorMessage.value = error instanceof Error ? error.message : String(error)
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
      const snapshot = await window.api.codingAgent.getSnapshot(threadId)
      const existing = sessions[threadId]
      const summary = snapshotToSummary(snapshot)
      mergeSession(sessions, {
        ...(existing ?? snapshotToSession(snapshot)),
        ...summary,
        createdAt: existing?.createdAt ?? summary.createdAt,
        updatedAt: existing?.updatedAt ?? summary.updatedAt,
        snapshot
      })
      syncRenderStateFromSnapshot(snapshot)
    } catch (error) {
      runtime.errorMessage = error instanceof Error ? error.message : String(error)
    } finally {
      runtime.loadingSnapshot = false
    }
  }

  /**
   * 向当前活跃会话发送 prompt。
   */
  const sendPrompt = async (contextId = defaultSessionContextId): Promise<void> => {
    const context = ensureSessionContext(contextId)
    let threadId = context.activeThreadId
    const draft = getComposerDraft(threadId, contextId)
    const text = getComposerText(draft).trim()
    const fileArgs = getComposerFileArgs(draft)
    const images = getComposerImages(threadId, contextId)
    const message = text || (images.length > 0 ? '请分析这些图片' : '')
    if (!message) {
      return
    }
    if (!threadId && !context.selectedProjectId) {
      globalErrorMessage.value = '请先选择 Project'
      return
    }
    let runtime: WorkspaceSessionRuntime | undefined
    if (threadId) {
      runtime = ensureRuntime(threadId)
      runtime.errorMessage = undefined
    }
    globalErrorMessage.value = undefined
    try {
      if (!threadId) {
        loadingThreads.value = true
        const orphanDraft = context.orphanDraftMessage
        const orphanImages = [...context.orphanImageAttachments]
        const snapshot = await window.api.codingAgent.createThread({
          projectId: context.selectedProjectId!
        })
        mergeSnapshot(sessions, snapshot)
        syncRenderStateFromSnapshot(snapshot)
        threadId = snapshot.threadId
        context.activeThreadId = threadId
        context.selectedProjectId = snapshot.projectId
        context.composerDrafts[threadId] = orphanDraft
        context.composerImageAttachments[threadId] = orphanImages
        runtime = ensureRuntime(threadId)
        runtime.errorMessage = undefined
      }
      const initialTitle = getInitialPromptTitle(sessions[threadId], message)
      if (initialTitle) {
        const updatedThread = await window.api.codingAgent.setThreadTitle({
          threadId,
          title: initialTitle
        })
        mergeSession(sessions, updatedThread)
        const snapshot = sessions[threadId]?.snapshot
        if (snapshot) {
          snapshot.title = updatedThread.title
        }
      }
      await window.api.codingAgent.prompt({
        threadId,
        message,
        ...(fileArgs.length > 0 ? { fileArgs } : {}),
        ...getPromptImagePayload(images)
      })
      clearComposerDraft(threadId, contextId)
      clearComposerImages(threadId, contextId)
      context.orphanDraftMessage = createEmptyComposerContent()
      context.orphanImageAttachments = []
      const session = sessions[threadId]
      if (session) {
        session.status = 'running'
      }
      if (session?.snapshot) {
        session.snapshot.status = 'running'
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (runtime) {
        runtime.errorMessage = message
      } else {
        globalErrorMessage.value = message
      }
    } finally {
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
    input: Pick<ApprovalResponse, 'allow' | 'choice' | 'reason'>
  ): Promise<void> => {
    await window.api.codingAgent.respondApproval({
      threadId: approval.threadId,
      response: {
        approvalId: approval.approvalId,
        allow: input.allow,
        scope: approval.scope,
        choice: input.choice,
        reason: input.reason
      }
    })
    delete ensureRuntime(approval.threadId).approvals[approval.approvalId]
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
   * 设置当前活跃会话面板的展开状态。
   * @param open - 是否展开。
   */
  const setActiveSessionPanelOpen = (open: boolean, contextId = defaultSessionContextId): void => {
    ensureSessionContext(contextId).panel.panelOpen = open
  }

  /**
   * 设置当前活跃会话面板的宽度，并限制在最小/最大宽度范围内。
   * @param width - 目标宽度。
   */
  const setActiveSessionPanelWidth = (width: number, contextId = defaultSessionContextId): void => {
    ensureSessionContext(contextId).panel.panelWidth = Math.min(
      maxSessionPanelWidth,
      Math.max(minSessionPanelWidth, width)
    )
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
  const removeComposerImage = (
    imageId: string,
    contextId = defaultSessionContextId
  ): void => {
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
    }
    switch (event.type) {
      case 'threadSnapshot': {
        mergeSnapshot(sessions, event.snapshot)
        ensureRuntime(event.threadId)
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
      case 'projection':
        if (event.event.type === 'thread.stateChanged' && sessions[event.threadId]) {
          sessions[event.threadId].status = event.event.status
        }
        if (event.event.type === 'approval.requested') {
          ensureRuntime(event.threadId).approvals[event.event.approval.approvalId] =
            event.event.approval
        }
        break
    }
    applyEventToSessions(sessions, event, (messageId, renderState) => {
      if (threadId) {
        bumpMessageRevision(threadId, messageId, renderState)
      }
    })
  }

  /** 订阅 IPC 事件并保存取消订阅函数。 */
  const unsubscribe = window.api.codingAgent.onEvent(handleEvent)

  return {
    abortActive,
    addComposerImages,
    activeEvents,
    activePendingApprovals,
    activeProjectId,
    activeRuntime,
    activeSession,
    activeSessionId,
    activeSessionPanel,
    activeSnapshot,
    contexts,
    createThread,
    clearComposerDraft,
    defaultSessionContextId,
    draftImages,
    draftMessage,
    errorMessage,
    events: activeEvents,
    getContextActiveThreadId,
    getContextComposerDrafts,
    getComposerDraft,
    getComposerImages,
    getMessageRenderState,
    hasDraftMessage,
    isNewSessionActive,
    loadThreads,
    loading,
    loadingThreads,
    maxSessionPanelWidth,
    minSessionPanelWidth,
    pendingApprovals: activePendingApprovals,
    refreshSnapshot,
    removeComposerImage,
    respondApproval,
    runtimeByThreadId,
    sendPrompt,
    sessionList,
    sessionsByProject,
    sessions,
    setActiveComposerDraft,
    setContextActiveThreadId,
    setActiveSessionId,
    setActiveSessionPanelOpen,
    setActiveSessionPanelWidth,
    startNewSession,
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

/**
 * 确保指定会话存在 Composer 草稿。
 * @param threadId - thread ID。
 * @returns Composer 草稿。
 */
function ensureComposerDraft(
  composerDrafts: Record<string, JSONContent>,
  threadId: string
): JSONContent {
  composerDrafts[threadId] ??= createEmptyComposerContent()
  return composerDrafts[threadId]
}

/**
 * 确保指定会话存在图片附件草稿。
 * @param composerImages - 图片附件草稿桶。
 * @param threadId - thread ID。
 * @returns 图片附件列表。
 */
function ensureComposerImages(
  composerImages: Record<string, ComposerImageAttachment[]>,
  threadId: string
): ComposerImageAttachment[] {
  composerImages[threadId] ??= []
  return composerImages[threadId]
}

/**
 * 去除仅供 Composer UI 使用的附件元信息。
 * @param image - Composer 图片附件。
 * @returns Prompt 图片内容。
 */
function toPromptImage(image: ComposerImageAttachment): PromptImage {
  return {
    type: image.type,
    mimeType: image.mimeType,
    data: image.data
  }
}

/**
 * 将 Composer 图片草稿拆成 Pi @file 图片和 inline 图片。
 * @param images - Composer 图片附件。
 * @returns prompt 图片 payload。
 */
function getPromptImagePayload(images: ComposerImageAttachment[]): {
  images?: PromptImage[]
  imageFiles?: PromptImageFile[]
} {
  const imageFiles = images
    .filter((image): image is ComposerImageAttachment & { path: string } => Boolean(image.path))
    .map((image) => ({ path: image.path, inlineFallback: toPromptImage(image) }))
  const inlineImages = images.filter((image) => !image.path).map(toPromptImage)
  return {
    ...(inlineImages.length > 0 ? { images: inlineImages } : {}),
    ...(imageFiles.length > 0 ? { imageFiles } : {})
  }
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
  if (existing) {
    Object.assign(existing, merged)
    return existing
  }
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
 * 原地合并 snapshot，避免组件持有旧 snapshot 引用时失去响应式更新。
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
  Object.assign(existing, incoming)
  return existing
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
    if (!session?.snapshot) {
      return
    }
    applyProjectionEvent(session.snapshot, event.event)
    session.status = session.snapshot.status
    return
  }
  if (isAgentSessionEventType(event)) {
    const session = sessions[event.threadId]
    if (!session?.snapshot) {
      return
    }
    const messageId = applyAgentSessionEvent(session.snapshot, event as AgentSessionIpcEvent)
    session.status = session.snapshot.status
    if (messageId && onMessageRevision) {
      onMessageRevision(messageId, event.type === 'message_end' ? 'complete' : 'streaming')
    }
  }
}

type ProjectionIpcEvent = Extract<CodingAgentIpcEvent, { type: 'projection' }>['event']
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
    case 'turn_end':
      snapshot.status = 'idle'
      return undefined
    case 'thinking_level_changed':
      snapshot.thinkingLevel = event.level
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
    ...content
  })
  return id
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
  const base = {
    threadId: snapshot.threadId,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    args:
      'args' in event ? mergeToolArgs(existing?.args, event.args, event.toolName) : existing?.args,
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
 * 应用 projection event。
 * @param snapshot - snapshot。
 * @param event - projection event。
 */
function applyProjectionEvent(snapshot: ThreadSnapshot, event: ProjectionIpcEvent): void {
  switch (event.type) {
    case 'thread.stateChanged':
      snapshot.status = event.status
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
}
