/**
 * workspace-session.ts - 管理 renderer 中 coding thread 的状态与 IPC 调用。
 */

import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import type {
  ApprovalRequest,
  ApprovalResponse,
  CodingAgentIpcEvent,
  ThreadSnapshot,
  ThreadSummary
} from '../../../shared/coding-agent/types'

/** 会话面板 UI 状态。 */
type SessionUiState = {
  /** 面板是否展开。 */
  panelOpen: boolean
  /** 面板宽度。 */
  panelWidth: number
}

/** 工作区会话对象。 */
type WorkspaceSession = ThreadSummary & {
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

  /** 创建 thread 时输入的工作目录。 */
  const cwdInput = ref('')

  /** 消息输入框的草稿内容。 */
  const draftMessage = ref('')

  /** 错误提示信息。 */
  const errorMessage = ref<string>()

  /** 是否正在加载。 */
  const loading = ref(false)

  /** 所有会话数据。 */
  const sessions = reactive<Record<string, WorkspaceSession>>({})

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
        sessions[thread.threadId] = {
          ...thread,
          ui: sessions[thread.threadId]?.ui ?? createUiState()
        }
      }
      if (!activeSessionId.value && threads[0]) {
        activeSessionId.value = threads[0].threadId
        await refreshSnapshot(threads[0].threadId)
      }
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error)
    } finally {
      loading.value = false
    }
  }

  /**
   * 根据输入的工作目录创建新 thread。
   */
  const createThread = async (): Promise<void> => {
    const cwd = cwdInput.value.trim()
    if (!cwd) {
      errorMessage.value = '请输入工作目录'
      return
    }
    loading.value = true
    errorMessage.value = undefined
    try {
      const snapshot = await window.api.codingAgent.createThread({ cwd })
      sessions[snapshot.threadId] = snapshotToSession(snapshot)
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
    sessions[threadId] = {
      ...(sessions[threadId] ?? snapshotToSession(snapshot)),
      ...snapshotToSummary(snapshot),
      snapshot,
      ui: sessions[threadId]?.ui ?? createUiState()
    }
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
    if (sessions[sessionId]) {
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
      sessions[event.threadId] = snapshotToSession(event.snapshot)
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
  }

  /** 订阅 IPC 事件并保存取消订阅函数。 */
  const unsubscribe = window.api.codingAgent.onEvent(handleEvent)

  return {
    abortActive,
    activeSession,
    activeSessionId,
    activeSnapshot,
    createThread,
    cwdInput,
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
 * 从 ThreadSnapshot 生成 ThreadSummary。
 * @param snapshot - Thread 快照。
 * @returns Thread 摘要。
 */
function snapshotToSummary(snapshot: ThreadSnapshot): ThreadSummary {
  return {
    threadId: snapshot.threadId,
    cwd: snapshot.cwd,
    sessionFile: snapshot.sessionFile,
    title: snapshot.title,
    status: snapshot.status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
}
