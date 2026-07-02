/**
 * useSessionContext.ts - 提供 workspace session 上下文注入与读取能力。
 */

import { computed, inject, provide, toValue } from 'vue'
import type { ComputedRef, InjectionKey, MaybeRefOrGetter } from 'vue'
import type { ThreadStatus } from '@shared/coding-agent/types'

/** 会话状态类型。 */
export type SessionStatus = ThreadStatus

/** 会话基础信息。 */
export type SessionInfo = {
  /** 会话 ID。 */
  sessionId: string
  /** 会话状态。 */
  status: SessionStatus
  /** 会话标题。 */
  title: string
}

/** 会话面板状态。 */
export type SessionPanelState = {
  /** 最大宽度。 */
  maxWidth: number
  /** 最小宽度。 */
  minWidth: number
  /** 是否展开。 */
  open: boolean
  /** 当前宽度。 */
  width: number
}

/** 会话上下文对象。 */
export type SessionContext = {
  /** 面板状态计算属性。 */
  panel: ComputedRef<SessionPanelState>
  /** 会话信息计算属性。 */
  session: ComputedRef<SessionInfo>
  /** 设置面板展开状态。 */
  setPanelOpen: (open: boolean) => void
  /** 设置面板宽度。 */
  setPanelWidth: (width: number) => void
}

/** 提供 session 上下文所需的选项。 */
type ProvideSessionContextOptions = {
  /** 面板状态（支持 ref 或 getter）。 */
  panel: MaybeRefOrGetter<SessionPanelState>
  /** 会话信息（支持 ref 或 getter）。 */
  session: MaybeRefOrGetter<SessionInfo>
  /** 设置面板展开状态。 */
  setPanelOpen: (open: boolean) => void
  /** 设置面板宽度。 */
  setPanelWidth: (width: number) => void
}

/** 注入上下文使用的 key。 */
const sessionContextKey: InjectionKey<SessionContext> = Symbol('session-context')

/**
 * 向子组件提供会话上下文。
 * @param options - 提供上下文所需的选项。
 * @returns 构建好的会话上下文。
 */
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

/**
 * 组合式函数：读取当前注入的会话上下文。
 * @returns 会话上下文。
 * @throws 如果未在 provideSessionContext 之下调用则抛出错误。
 */
export const useSessionContext = (): SessionContext => {
  const context = inject(sessionContextKey)

  if (!context) {
    throw new Error('useSessionContext 必须在 provideSessionContext 之下使用。')
  }

  return context
}
