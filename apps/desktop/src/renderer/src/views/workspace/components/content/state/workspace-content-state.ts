import type { SessionInfo, SessionPanelState } from '@renderer/composables/useSessionContext'
import type { SessionUiState, WorkspaceSession } from '@renderer/stores/workspace-session'

export interface WorkspaceContentPanelInput {
  maxWidth?: number
  minWidth: number
  panel: SessionUiState
}

export function createStableSessionPanelState(
  input: WorkspaceContentPanelInput,
  previous?: SessionPanelState
): SessionPanelState {
  const next: SessionPanelState = {
    maxWidth: input.maxWidth,
    minWidth: input.minWidth,
    open: input.panel.panelOpen,
    width: input.panel.panelWidth
  }

  if (
    previous &&
    previous.maxWidth === next.maxWidth &&
    previous.minWidth === next.minWidth &&
    previous.open === next.open &&
    previous.width === next.width
  ) {
    return previous
  }

  return next
}

export function createStableSessionInfo(
  session: WorkspaceSession | undefined,
  previous?: SessionInfo
): SessionInfo {
  const next: SessionInfo = {
    sessionId: session?.threadId ?? '',
    status: session?.status ?? 'new',
    title: session?.title ?? '新会话'
  }

  if (
    previous &&
    previous.sessionId === next.sessionId &&
    previous.status === next.status &&
    previous.title === next.title
  ) {
    return previous
  }

  return next
}
