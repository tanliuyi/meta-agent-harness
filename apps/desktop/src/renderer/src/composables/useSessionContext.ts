import { computed, inject, provide, toValue } from 'vue'
import type { ComputedRef, InjectionKey, MaybeRefOrGetter } from 'vue'

export type SessionStatus = 'idle' | 'running' | 'completed' | 'failed'

export type SessionInfo = {
  sessionId: string
  status: SessionStatus
  title: string
}

export type SessionPanelState = {
  maxWidth: number
  minWidth: number
  open: boolean
  width: number
}

export type SessionContext = {
  panel: ComputedRef<SessionPanelState>
  session: ComputedRef<SessionInfo>
  setPanelOpen: (open: boolean) => void
  setPanelWidth: (width: number) => void
}

type ProvideSessionContextOptions = {
  panel: MaybeRefOrGetter<SessionPanelState>
  session: MaybeRefOrGetter<SessionInfo>
  setPanelOpen: (open: boolean) => void
  setPanelWidth: (width: number) => void
}

const sessionContextKey: InjectionKey<SessionContext> = Symbol('session-context')

export const provideSessionContext = ({
  panel,
  setPanelOpen,
  setPanelWidth,
  session
}: ProvideSessionContextOptions): SessionContext => {
  const context: SessionContext = {
    panel: computed(() => toValue(panel)),
    session: computed(() => toValue(session)),
    setPanelOpen,
    setPanelWidth
  }

  provide(sessionContextKey, context)

  return context
}

export const useSessionContext = (): SessionContext => {
  const context = inject(sessionContextKey)

  if (!context) {
    throw new Error('useSessionContext must be used under provideSessionContext.')
  }

  return context
}
