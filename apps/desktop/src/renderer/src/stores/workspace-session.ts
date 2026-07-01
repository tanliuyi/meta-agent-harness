/**
 * 本文件管理 renderer 中 coding thread 的状态与 IPC 调用。
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

type SessionUiState = {
  panelOpen: boolean
  panelWidth: number
}

type WorkspaceSession = ThreadSummary & {
  snapshot?: ThreadSnapshot
  ui: SessionUiState
}

const minSessionPanelWidth = 220
const maxSessionPanelWidth = 460

const createUiState = (): SessionUiState => ({
  panelOpen: true,
  panelWidth: 300
})

export default defineStore('workspace-session', () => {
  const activeSessionId = ref<string>()
  const cwdInput = ref('')
  const draftMessage = ref('')
  const errorMessage = ref<string>()
  const loading = ref(false)
  const sessions = reactive<Record<string, WorkspaceSession>>({})
  const pendingApprovals = reactive<Record<string, ApprovalRequest>>({})
  const events = ref<CodingAgentIpcEvent[]>([])

  const activeSession = computed(() => {
    return activeSessionId.value ? sessions[activeSessionId.value] : undefined
  })

  const activeSnapshot = computed(() => activeSession.value?.snapshot)
  const sessionList = computed(() => Object.values(sessions))

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

  const abortActive = async (): Promise<void> => {
    if (!activeSessionId.value) {
      return
    }
    await window.api.codingAgent.abort(activeSessionId.value)
    await refreshSnapshot(activeSessionId.value)
  }

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

  const setActiveSessionId = async (sessionId: string): Promise<void> => {
    if (sessions[sessionId]) {
      activeSessionId.value = sessionId
      await refreshSnapshot(sessionId)
    }
  }

  const setActiveSessionPanelOpen = (open: boolean): void => {
    if (activeSession.value) {
      activeSession.value.ui.panelOpen = open
    }
  }

  const setActiveSessionPanelWidth = (width: number): void => {
    if (!activeSession.value) {
      return
    }
    activeSession.value.ui.panelWidth = Math.min(
      maxSessionPanelWidth,
      Math.max(minSessionPanelWidth, width)
    )
  }

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

function snapshotToSession(snapshot: ThreadSnapshot): WorkspaceSession {
  return {
    ...snapshotToSummary(snapshot),
    snapshot,
    ui: createUiState()
  }
}

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
