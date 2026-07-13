import { reactive } from 'vue'

export interface FloatingChatLayoutState {
  open: boolean
  position: { x: number; y: number } | null
  size: { height: number; width: number } | null
}

export interface SessionPanelLayoutState {
  getFloatingChatLayout: (sessionKey: string) => FloatingChatLayoutState
  isFullscreen: (sessionKey: string) => boolean
  setFloatingChatLayout: (sessionKey: string, patch: Partial<FloatingChatLayoutState>) => void
  setFullscreen: (sessionKey: string, fullscreen: boolean) => void
  transfer: (sourceSessionKey: string, targetSessionKey: string) => void
}

export function createSessionPanelLayoutState(): SessionPanelLayoutState {
  const layoutBySessionKey = reactive<
    Record<
      string,
      {
        floatingChat?: FloatingChatLayoutState
        fullscreen?: true
      }
    >
  >({})

  function getFloatingChatLayout(sessionKey: string): FloatingChatLayoutState {
    const layout = layoutBySessionKey[sessionKey]?.floatingChat
    return {
      open: layout?.open ?? true,
      position: layout?.position ? { ...layout.position } : null,
      size: layout?.size ? { ...layout.size } : null
    }
  }

  function isFullscreen(sessionKey: string): boolean {
    return layoutBySessionKey[sessionKey]?.fullscreen === true
  }

  function setFloatingChatLayout(
    sessionKey: string,
    patch: Partial<FloatingChatLayoutState>
  ): void {
    const current = getFloatingChatLayout(sessionKey)
    const sessionLayout = (layoutBySessionKey[sessionKey] ??= {})
    sessionLayout.floatingChat = {
      open: patch.open ?? current.open,
      position:
        patch.position === undefined
          ? current.position
          : patch.position
            ? { ...patch.position }
            : null,
      size: patch.size === undefined ? current.size : patch.size ? { ...patch.size } : null
    }
  }

  function setFullscreen(sessionKey: string, fullscreen: boolean): void {
    if (fullscreen) {
      const sessionLayout = (layoutBySessionKey[sessionKey] ??= {})
      sessionLayout.fullscreen = true
    } else {
      const sessionLayout = layoutBySessionKey[sessionKey]
      if (!sessionLayout) return
      delete sessionLayout.fullscreen
      if (!sessionLayout.floatingChat) delete layoutBySessionKey[sessionKey]
    }
  }

  function transfer(sourceSessionKey: string, targetSessionKey: string): void {
    if (sourceSessionKey === targetSessionKey) return
    const sourceLayout = layoutBySessionKey[sourceSessionKey]
    if (!sourceLayout) return

    const targetLayout = (layoutBySessionKey[targetSessionKey] ??= {})
    if (sourceLayout.fullscreen) {
      targetLayout.fullscreen = true
    }
    if (sourceLayout.floatingChat) {
      targetLayout.floatingChat = {
        open: sourceLayout.floatingChat.open,
        position: sourceLayout.floatingChat.position
          ? { ...sourceLayout.floatingChat.position }
          : null,
        size: sourceLayout.floatingChat.size ? { ...sourceLayout.floatingChat.size } : null
      }
    }
    delete layoutBySessionKey[sourceSessionKey]
  }

  return {
    getFloatingChatLayout,
    isFullscreen,
    setFloatingChatLayout,
    setFullscreen,
    transfer
  }
}

export const sessionPanelFullscreenByKey = createSessionPanelLayoutState()

export const transferSessionPanelLayoutState = sessionPanelFullscreenByKey.transfer
