/**
 * workspace-session.ts - 管理 renderer 中 coding thread 的状态与 IPC 调用。
 */

import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import useWorkspaceProjectStore from './workspace-project'
import type {
  ApprovalRequest,
  ApprovalResponse,
  CodingAgentIpcEvent,
  ProjectSummary,
  ThreadMessage,
  ThreadSnapshot,
  ThreadSummary
} from '../../../shared/coding-agent/types'

/** 会话面板 UI 状态。 */
export type SessionUiState = {
  /** 面板是否展开。 */
  panelOpen: boolean
  /** 面板宽度。 */
  panelWidth: number
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
      if (!existed || !activeSessionId.value || !sessions[activeSessionId.value]) {
        activeSessionId.value = event.threadId
      }
      return
    }
    if (event.type === 'project' && event.event && typeof event.event === 'object') {
      const payload = event.event as {
        type?: string
        project?: ProjectSummary
        projectId?: string
      }
      if (payload.project) {
        workspaceProject.projects[payload.project.projectId] = payload.project
      }
    }
    if (event.type === 'projection' && event.event && typeof event.event === 'object') {
      const payload = event.event as {
        type?: string
        status?: ThreadSummary['status']
        approval?: ApprovalRequest
      }
      if (payload.type === 'thread.stateChanged' && payload.status && sessions[event.threadId]) {
        sessions[event.threadId].status = payload.status
      }
      if (payload.type === 'approval.requested' && payload.approval) {
        pendingApprovals[payload.approval.approvalId] = payload.approval
      }
    }
    applyEventToSessions(sessions, event)
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
 */
export function applyEventToSessions(
  sessions: Record<string, WorkspaceSession>,
  event: CodingAgentIpcEvent
): void {
  if (event.type === 'threadSnapshot') {
    mergeSnapshot(sessions, event.snapshot)
    return
  }
  if (event.type !== 'canonical' && event.type !== 'projection') {
    return
  }
  const session = sessions[event.threadId]
  if (!session?.snapshot || !event.event || typeof event.event !== 'object') {
    return
  }
  const payload = event.event as Record<string, unknown>
  if (event.type === 'canonical') {
    applyCanonicalEvent(session.snapshot, payload)
    session.status = session.snapshot.status
    return
  }
  applyProjectionEvent(session.snapshot, payload)
  session.status = session.snapshot.status
}

/**
 * 应用 canonical event。
 * @param snapshot - snapshot。
 * @param event - canonical event。
 */
function applyCanonicalEvent(snapshot: ThreadSnapshot, event: Record<string, unknown>): void {
  switch (event.type) {
    case 'agent_start':
    case 'turn_start':
      snapshot.status = 'running'
      return
    case 'turn_end':
      snapshot.status = 'idle'
      return
    case 'message_start':
    case 'message_end':
    case 'message_update':
      upsertMessageEvent(snapshot, event)
      return
  }
}

/**
 * 应用 canonical message event。
 * @param snapshot - snapshot。
 * @param event - canonical message event。
 */
function upsertMessageEvent(snapshot: ThreadSnapshot, event: Record<string, unknown>): void {
  const message = extractMessagePayload(event)
  const role = normalizeMessageRole(message?.role)
  if (!role) {
    return
  }
  const text =
    extractText(message?.content) ??
    getString(event.assistantMessage) ??
    getString(event.delta) ??
    extractText(event.delta)
  upsertById(snapshot.messages, {
    id: getMessageEventId(snapshot.messages, event, role, text),
    role,
    text,
    createdAt: normalizeTimestamp(event.timestamp ?? message?.timestamp)
  })
}

/**
 * 应用 projection event。
 * @param snapshot - snapshot。
 * @param event - projection event。
 */
function applyProjectionEvent(snapshot: ThreadSnapshot, event: Record<string, unknown>): void {
  switch (event.type) {
    case 'thread.stateChanged':
      if (isThreadStatus(event.status)) {
        snapshot.status = event.status
      }
      return
    case 'thinking.changed':
      if (isThinkingLevel(event.level)) {
        snapshot.thinkingLevel = event.level
      }
      return
    case 'queue.changed':
      snapshot.queue = {
        steering: toStringArray(event.steering),
        followUp: toStringArray(event.followUp)
      }
      return
    case 'approval.requested':
      if (isRecord(event.approval)) {
        upsertUnknown(snapshot.approvals, event.approval, 'approvalId')
      }
      return
    case 'approval.resolved':
      removeUnknown(snapshot.approvals, getString(event.approvalId), 'approvalId')
      return
    case 'tool.call':
    case 'tool.updated':
      upsertUnknown(
        snapshot.toolCalls,
        isRecord(event.toolCall) ? event.toolCall : event,
        'toolCallId'
      )
      return
    case 'file.changed':
      snapshot.fileChanges.push(isRecord(event.fileChange) ? event.fileChange : event)
      return
    case 'diagnostic':
      snapshot.diagnostics.push(event)
      return
  }
}

/**
 * 从 canonical event 读取消息载荷。
 * @param event - canonical event。
 * @returns 消息载荷。
 */
function extractMessagePayload(
  event: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (isRecord(event.message)) {
    return event.message
  }
  if (isRecord(event.userMessage)) {
    return { ...event.userMessage, role: getString(event.userMessage.role) ?? 'user' }
  }
  if (isRecord(event.assistantMessage)) {
    return {
      ...event.assistantMessage,
      role: getString(event.assistantMessage.role) ?? 'assistant'
    }
  }
  if (typeof event.userMessage === 'string') {
    return { role: 'user', content: event.userMessage }
  }
  if (typeof event.assistantMessage === 'string') {
    return { role: 'assistant', content: event.assistantMessage }
  }
  return undefined
}

/**
 * 获取 canonical message event 的稳定 id。
 * @param items - 现有消息。
 * @param event - canonical event。
 * @param role - 消息角色。
 * @param text - 消息文本。
 * @returns 消息 id。
 */
function getMessageEventId(
  items: ThreadMessage[],
  event: Record<string, unknown>,
  role: ThreadMessage['role'],
  text: string | undefined
): string {
  return (
    getString(event.entryId) ??
    getString(event.messageId) ??
    getString(event.id) ??
    getStreamingMessageId(items, role, text)
  )
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
function upsertUnknown(items: unknown[], item: Record<string, unknown>, key: string): void {
  const id = getString(item[key])
  if (!id) {
    items.push(item)
    return
  }
  const index = items.findIndex((existing) => isRecord(existing) && existing[key] === id)
  if (index >= 0) {
    items[index] = { ...(items[index] as Record<string, unknown>), ...item }
    return
  }
  items.push(item)
}

/**
 * 通过字段移除 unknown object。
 * @param items - 数组。
 * @param id - id。
 * @param key - key。
 */
function removeUnknown(items: unknown[], id: string | undefined, key: string): void {
  if (!id) {
    return
  }
  const index = items.findIndex((existing) => isRecord(existing) && existing[key] === id)
  if (index >= 0) {
    items.splice(index, 1)
  }
}

/**
 * 归一化消息 role。
 * @param role - role。
 * @returns ThreadMessage role。
 */
function normalizeMessageRole(role: unknown): ThreadMessage['role'] | undefined {
  switch (role) {
    case 'user':
    case 'assistant':
    case 'tool':
    case 'system':
      return role
    case 'toolResult':
      return 'tool'
    default:
      return undefined
  }
}

/**
 * 提取文本。
 * @param value - 值。
 * @returns 文本。
 */
function extractText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (!Array.isArray(value)) {
    return undefined
  }
  const text = value
    .filter((part): part is { type: string; text: string } => {
      return isRecord(part) && part.type === 'text' && typeof part.text === 'string'
    })
    .map((part) => part.text)
    .join('')
  return text || undefined
}

/**
 * 归一化 timestamp。
 * @param value - timestamp。
 * @returns ISO 字符串。
 */
function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    return new Date(value).toISOString()
  }
  return undefined
}

/**
 * 是否 ThreadStatus。
 * @param value - 值。
 * @returns 是否线程状态。
 */
function isThreadStatus(value: unknown): value is ThreadSummary['status'] {
  return (
    value === 'new' ||
    value === 'queued' ||
    value === 'starting' ||
    value === 'idle' ||
    value === 'running' ||
    value === 'stopping' ||
    value === 'stopped' ||
    value === 'error'
  )
}

/**
 * 是否 ThinkingLevel。
 * @param value - 值。
 * @returns 是否 thinking level。
 */
function isThinkingLevel(value: unknown): value is ThreadSnapshot['thinkingLevel'] {
  return (
    value === 'off' ||
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
  )
}

/**
 * 转字符串数组。
 * @param value - 值。
 * @returns 字符串数组。
 */
function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

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
