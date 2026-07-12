export interface ChatTimelineOpenState {
  collapsedHistory: Record<string, boolean>
  thinking: Record<string, boolean>
  toolGroup: Record<string, boolean>
  tool: Record<string, boolean>
}

export type ChatTimelineOpenStateBySession = Record<string, ChatTimelineOpenState>

export function getChatTimelineSessionStateKey(
  sessionId: string | undefined,
  sessionFile?: string
): string {
  if (!sessionId) {
    return 'draft'
  }
  return JSON.stringify([sessionId, sessionFile ?? null])
}

export function ensureChatTimelineOpenState(
  states: ChatTimelineOpenStateBySession,
  sessionId: string | undefined,
  sessionFile?: string
): ChatTimelineOpenState {
  const key = getChatTimelineSessionStateKey(sessionId, sessionFile)
  const existing = states[key]
  if (existing) {
    return existing
  }
  states[key] = {
    collapsedHistory: {},
    thinking: {},
    toolGroup: {},
    tool: {}
  }
  // 重新读取以确保 reactive 容器返回 Vue proxy，而不是刚赋值的原始对象。
  return states[key]
}
