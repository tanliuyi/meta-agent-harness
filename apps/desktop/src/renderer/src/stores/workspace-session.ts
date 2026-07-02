/**
 * workspace-session.ts - 管理 renderer 中 coding thread 的状态与 IPC 调用。
 */

import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import useWorkspaceProjectStore from './workspace-project'
import { toDesktopMessageContent } from '@shared/coding-agent/types'
import type {
  ApprovalRequest,
  ApprovalResponse,
  CodingAgentIpcEvent,
  ThreadSnapshot,
  ThreadMessage,
  ThreadSummary
} from '@shared/coding-agent/types'

/** 会话面板 UI 状态。 */
export type SessionUiState = {
  /** 面板是否展开。 */
  panelOpen: boolean
  /** 面板宽度。 */
  panelWidth: number
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
  /** UI 状态。 */
  ui: SessionUiState
}

/** 会话面板最小宽度。 */
const minSessionPanelWidth = 220

/** 会话面板最大宽度。 */
const maxSessionPanelWidth = 460

/**
 * 创建默认会话 UI 状态。
 * @returns 默认会话 UI 状态。
 */
const createUiState = (): SessionUiState => ({
  panelOpen: true,
  panelWidth: 300
})

/**
 * Workspace Session Store。
 * 负责加载、创建、管理 thread，处理 IPC 事件以及审批请求。
 */
export default defineStore('workspace-session', () => {
  /** 当前活跃会话 ID。 */
  const activeSessionId = ref<string>()

  /** 消息输入框的草稿内容。 */
  const draftMessage = ref('')

  /** 错误提示信息。 */
  const errorMessage = ref<string>()

  /** 是否正在加载。 */
  const loading = ref(false)

  /** 所有会话数据。 */
  const sessions = reactive<Record<string, WorkspaceSession>>({})

  const workspaceProject = useWorkspaceProjectStore()

  /** 待处理的审批请求。 */
  const pendingApprovals = reactive<Record<string, ApprovalRequest>>({})

  /** 最近接收到的 IPC 事件列表。 */
  const events = ref<CodingAgentIpcEvent[]>([])

  /** 消息的渲染状态（版本号 + streaming/complete），key 为 threadId:messageId。 */
  const messageRenderState = reactive<Record<string, MessageRenderState>>({})

  /** 待提交的渲染版本更新。 */
  const pendingRevisions = new Map<string, MessageRenderState>()
  let revisionFlushId: number | null = null

  /** 待提交的 canonical message 事件，按 thread + message 合并。 */
  const pendingMessageEvents = new Map<string, CanonicalMessageIpcEvent>()
  let messageEventFlushId: number | null = null

  /**
   * 将 pending 的版本更新 flush 到响应式状态。
   */
  function flushRevisionUpdates(): void {
    revisionFlushId = null
    for (const [id, state] of pendingRevisions) {
      messageRenderState[id] = { ...state }
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
    const existing = pendingRevisions.get(key) ?? messageRenderState[key]
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
   * 将 pending 的 canonical message 事件 flush 到 snapshot。
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
   * 合并 canonical message 事件到下一帧提交。
   * @param event - canonical message IPC 事件。
   */
  function scheduleMessageEvent(event: CanonicalMessageIpcEvent): void {
    const session = sessions[event.threadId]
    const snapshot = session?.snapshot
    const content = toDesktopMessageContent(event.event.message)
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
   * 获取消息的渲染状态，未记录时返回初始状态。
   * @param messageId - 消息 ID。
   * @returns 渲染状态。
   */
  function getMessageRenderState(threadId: string, messageId: string): MessageRenderState {
    return messageRenderState[getMessageRenderStateKey(threadId, messageId)] ?? {
      revision: 1,
      renderState: 'complete'
    }
  }

  /**
   * 从完整快照同步消息渲染状态。
   * 所有消息标记为完成态；新消息初始化为版本 1。
   * @param snapshot - 线程快照。
   */
  function syncRenderStateFromSnapshot(snapshot: ThreadSnapshot): void {
    const keys = new Set(
      snapshot.messages.map((message) => getMessageRenderStateKey(snapshot.threadId, message.id))
    )
    for (const key of Object.keys(messageRenderState)) {
      if (key.startsWith(`${snapshot.threadId}:`) && !keys.has(key)) {
        delete messageRenderState[key]
      }
    }
    for (const message of snapshot.messages) {
      const key = getMessageRenderStateKey(snapshot.threadId, message.id)
      messageRenderState[key] = {
        revision: messageRenderState[key]?.revision ?? 1,
        renderState: 'complete'
      }
    }
  }

  /** 当前活跃会话对象。 */
  const activeSession = computed(() => {
    return activeSessionId.value ? sessions[activeSessionId.value] : undefined
  })

  /** 当前活跃会话的快照。 */
  const activeSnapshot = computed(() => activeSession.value?.snapshot)

  /** 会话列表。 */
  const sessionList = computed(() => Object.values(sessions))

  /** 按 Project ID 分组的会话列表。 */
  const sessionsByProject = computed(() =>
    sessionList.value.reduce<Record<string, WorkspaceSession[]>>((groups, session) => {
      groups[session.projectId] ??= []
      groups[session.projectId].push(session)
      return groups
    }, {})
  )

  /**
   * 加载所有 thread 列表。
   * 若不存在活跃会话，则默认选中第一个并刷新快照。
   */
  const loadThreads = async (): Promise<void> => {
    loading.value = true
    errorMessage.value = undefined
    try {
      const threads = await window.api.codingAgent.listThreads()
      for (const thread of threads) {
        mergeSession(sessions, {
          ...thread,
          ui: sessions[thread.threadId]?.ui ?? createUiState()
        })
      }
      const activeExists =
        activeSessionId.value && threads.some((thread) => thread.threadId === activeSessionId.value)
      if (!activeExists) {
        activeSessionId.value = threads[0]?.threadId
      }
      if (activeSessionId.value) {
        await refreshSnapshot(activeSessionId.value)
      }
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error)
    } finally {
      loading.value = false
    }
  }

  /**
   * 在指定 Project 下创建新 thread。
   * @param projectId - Project ID。
   */
  const createThread = async (projectId: string): Promise<void> => {
    if (!projectId) {
      errorMessage.value = '请先打开 Project'
      return
    }
    loading.value = true
    errorMessage.value = undefined
    try {
      const snapshot = await window.api.codingAgent.createThread({ projectId })
      mergeSnapshot(sessions, snapshot)
      syncRenderStateFromSnapshot(snapshot)
      activeSessionId.value = snapshot.threadId
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error)
    } finally {
      loading.value = false
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
    const snapshot = await window.api.codingAgent.getSnapshot(threadId)
    mergeSession(sessions, {
      ...(sessions[threadId] ?? snapshotToSession(snapshot)),
      ...snapshotToSummary(snapshot),
      snapshot,
      ui: sessions[threadId]?.ui ?? createUiState()
    })
    syncRenderStateFromSnapshot(snapshot)
  }

  /**
   * 向当前活跃会话发送 prompt。
   */
  const sendPrompt = async (): Promise<void> => {
    const threadId = activeSessionId.value
    const message = draftMessage.value.trim()
    if (!threadId || !message) {
      return
    }
    errorMessage.value = undefined
    draftMessage.value = ''
    try {
      await window.api.codingAgent.prompt({ threadId, message })
      sessions[threadId].status = 'running'
      if (sessions[threadId].snapshot) {
        sessions[threadId].snapshot.status = 'running'
      }
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * 中止当前活跃会话的执行。
   */
  const abortActive = async (): Promise<void> => {
    if (!activeSessionId.value) {
      return
    }
    await window.api.codingAgent.abort(activeSessionId.value)
    await refreshSnapshot(activeSessionId.value)
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
    delete pendingApprovals[approval.approvalId]
  }

  /**
   * 设置当前活跃会话 ID 并刷新快照。
   * @param sessionId - 目标会话 ID。
   */
  const setActiveSessionId = async (sessionId: string): Promise<void> => {
    const session = sessions[sessionId]
    if (session) {
      activeSessionId.value = sessionId
      await refreshSnapshot(sessionId)
    }
  }

  /**
   * 设置当前活跃会话面板的展开状态。
   * @param open - 是否展开。
   */
  const setActiveSessionPanelOpen = (open: boolean): void => {
    if (activeSession.value) {
      activeSession.value.ui.panelOpen = open
    }
  }

  /**
   * 设置当前活跃会话面板的宽度，并限制在最小/最大宽度范围内。
   * @param width - 目标宽度。
   */
  const setActiveSessionPanelWidth = (width: number): void => {
    if (!activeSession.value) {
      return
    }
    activeSession.value.ui.panelWidth = Math.min(
      maxSessionPanelWidth,
      Math.max(minSessionPanelWidth, width)
    )
  }

  /**
   * 处理来自主进程的 coding agent 事件。
   * 更新会话快照、状态以及待处理审批请求。
   * @param event - IPC 事件。
   */
  const handleEvent = (event: CodingAgentIpcEvent): void => {
    events.value.unshift(event)
    events.value = events.value.slice(0, 80)
    if (event.type === 'threadSnapshot') {
      const existed = Boolean(sessions[event.threadId])
      mergeSnapshot(sessions, event.snapshot)
      syncRenderStateFromSnapshot(event.snapshot)
      if (!existed || !activeSessionId.value || !sessions[activeSessionId.value]) {
        activeSessionId.value = event.threadId
      }
      return
    }
    if (event.type === 'canonical') {
      const messageEvent = toCanonicalMessageIpcEvent(event)
      if (messageEvent) {
        scheduleMessageEvent(messageEvent)
        return
      }
    }
    if (event.type === 'project') {
      workspaceProject.projects[event.event.project.projectId] = event.event.project
    }
    if (event.type === 'projection') {
      if (event.event.type === 'thread.stateChanged' && sessions[event.threadId]) {
        sessions[event.threadId].status = event.event.status
      }
      if (event.event.type === 'approval.requested') {
        pendingApprovals[event.event.approval.approvalId] = event.event.approval
      }
    }
    const threadId = getEventThreadId(event)
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
    activeSession,
    activeSessionId,
    activeSnapshot,
    createThread,
    draftMessage,
    errorMessage,
    events,
    getMessageRenderState,
    loadThreads,
    loading,
    maxSessionPanelWidth,
    minSessionPanelWidth,
    pendingApprovals,
    refreshSnapshot,
    respondApproval,
    sendPrompt,
    sessionList,
    sessionsByProject,
    sessions,
    setActiveSessionId,
    setActiveSessionPanelOpen,
    setActiveSessionPanelWidth,
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
    snapshot,
    ui: createUiState()
  }
}

/**
 * 合并 session，保留已有 UI 状态，确保响应式列表更新稳定。
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
    snapshot: mergeThreadSnapshot(existing?.snapshot, session.snapshot),
    ui: existing?.ui ?? session.ui ?? createUiState()
  }
  if (existing) {
    Object.assign(existing, merged)
    return existing
  }
  sessions[session.threadId] = merged
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
  if (event.type !== 'canonical' && event.type !== 'projection') {
    return
  }
  const session = sessions[event.threadId]
  if (!session?.snapshot) {
    return
  }
  if (event.type === 'canonical') {
    const messageId = applyCanonicalEvent(session.snapshot, event.event)
    session.status = session.snapshot.status
    if (messageId && onMessageRevision) {
      const renderState = event.event.type === 'message_end' ? 'complete' : 'streaming'
      onMessageRevision(messageId, renderState)
    }
    return
  }
  applyProjectionEvent(session.snapshot, event.event)
  session.status = session.snapshot.status
}

type CanonicalIpcEvent = Extract<CodingAgentIpcEvent, { type: 'canonical' }>['event']
type ProjectionIpcEvent = Extract<CodingAgentIpcEvent, { type: 'projection' }>['event']
type CanonicalMessageIpcEvent = Extract<CodingAgentIpcEvent, { type: 'canonical' }> & {
  event: Extract<CanonicalIpcEvent, { type: 'message_start' | 'message_end' | 'message_update' }>
}

/**
 * 将 canonical IPC event 转成 canonical message IPC event。
 * @param event - canonical IPC event。
 * @returns message event 或 undefined。
 */
function toCanonicalMessageIpcEvent(
  event: Extract<CodingAgentIpcEvent, { type: 'canonical' }>
): CanonicalMessageIpcEvent | undefined {
  if (
    event.event.type !== 'message_start' &&
    event.event.type !== 'message_end' &&
    event.event.type !== 'message_update'
  ) {
    return undefined
  }
  return event as CanonicalMessageIpcEvent
}

/**
 * 应用 canonical event。
 * @param snapshot - snapshot。
 * @param event - canonical event。
 */
function applyCanonicalEvent(snapshot: ThreadSnapshot, event: CanonicalIpcEvent): string | undefined {
  switch (event.type) {
    case 'agent_start':
    case 'turn_start':
      snapshot.status = 'running'
      return undefined
    case 'turn_end':
      snapshot.status = 'idle'
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
 * 应用 canonical message event。
 * @param snapshot - snapshot。
 * @param event - canonical message event。
 * @returns 被更新的消息 ID，若未更新则返回 undefined。
 */
function upsertMessageEvent(
  snapshot: ThreadSnapshot,
  event: Extract<CanonicalIpcEvent, { type: 'message_start' | 'message_end' | 'message_update' }>
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
 * 应用 canonical tool execution event，保留原始事件结构。
 * @param snapshot - snapshot。
 * @param event - canonical tool execution event。
 */
function upsertToolExecutionEvent(
  snapshot: ThreadSnapshot,
  event: Extract<
    CanonicalIpcEvent,
    { type: 'tool_execution_start' | 'tool_execution_update' | 'tool_execution_end' }
  >
): void {
  const existing = snapshot.toolCalls.find((item) => item.toolCallId === event.toolCallId)
  const base = {
    threadId: snapshot.threadId,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    args: 'args' in event ? event.args : existing?.args,
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
    case 'thinking.changed':
      snapshot.thinkingLevel = event.level
      return
    case 'queue.changed':
      snapshot.queue = {
        steering: [...event.steering],
        followUp: [...event.followUp]
      }
      return
    case 'approval.requested':
      upsertUnknown(snapshot.approvals, event.approval, 'approvalId')
      return
    case 'tool.started':
    case 'tool.updated':
    case 'tool.finished': {
      upsertUnknown(snapshot.toolCalls, { ...event.toolCall, rawEvent: event }, 'toolCallId')
      return
    }
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
