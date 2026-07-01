import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import type { SessionStatus } from '@renderer/composables/useSessionContext'

type SessionUiState = {
  panelOpen: boolean
  panelWidth: number
}

type WorkspaceSession = {
  sessionId: string
  status: SessionStatus
  title: string
  ui: SessionUiState
}

const minSessionPanelWidth = 200
const maxSessionPanelWidth = 420

const createSession = ({
  sessionId,
  status = 'idle',
  title
}: {
  sessionId: string
  status?: SessionStatus
  title: string
}): WorkspaceSession => ({
  sessionId,
  status,
  title,
  ui: {
    panelOpen: true,
    panelWidth: 256
  }
})

export default defineStore('workspace-session', () => {
  const activeSessionId = ref('local-session')
  const sessions = reactive<Record<string, WorkspaceSession>>({
    'local-session': createSession({
      sessionId: 'local-session',
      title: '新会话'
    })
  })

  const activeSession = computed(() => sessions[activeSessionId.value])

  const setActiveSessionId = (sessionId: string): void => {
    if (sessions[sessionId]) {
      activeSessionId.value = sessionId
    }
  }

  const setActiveSessionPanelOpen = (open: boolean): void => {
    activeSession.value.ui.panelOpen = open
  }

  const setActiveSessionPanelWidth = (width: number): void => {
    activeSession.value.ui.panelWidth = Math.min(
      maxSessionPanelWidth,
      Math.max(minSessionPanelWidth, width)
    )
  }

  return {
    activeSession,
    activeSessionId,
    maxSessionPanelWidth,
    minSessionPanelWidth,
    sessions,
    setActiveSessionId,
    setActiveSessionPanelOpen,
    setActiveSessionPanelWidth
  }
})
