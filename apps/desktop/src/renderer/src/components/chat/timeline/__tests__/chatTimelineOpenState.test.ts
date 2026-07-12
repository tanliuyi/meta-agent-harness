import { effect, isReactive, reactive } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  ensureChatTimelineOpenState,
  getChatTimelineSessionStateKey,
  type ChatTimelineOpenStateBySession
} from '../chatTimelineOpenState'

describe('chatTimelineOpenState', () => {
  it('keeps expansion state isolated when switching away from and back to a session', () => {
    const states: ChatTimelineOpenStateBySession = {}
    const sessionA = ensureChatTimelineOpenState(states, 'session-a')
    sessionA.toolGroup['tool-group:read'] = true
    sessionA.tool.read = true

    const sessionB = ensureChatTimelineOpenState(states, 'session-b')
    expect(sessionB.toolGroup['tool-group:read']).toBeUndefined()
    sessionB.toolGroup['tool-group:bash'] = true

    expect(ensureChatTimelineOpenState(states, 'session-a')).toBe(sessionA)
    expect(ensureChatTimelineOpenState(states, 'session-a').toolGroup).toEqual({
      'tool-group:read': true
    })
    expect(ensureChatTimelineOpenState(states, 'session-a').tool).toEqual({ read: true })
  })

  it('uses one stable state bucket for the draft timeline', () => {
    const states: ChatTimelineOpenStateBySession = {}
    const draft = ensureChatTimelineOpenState(states, undefined, '/tmp/stale-session.jsonl')
    draft.thinking['thinking:1'] = true

    expect(getChatTimelineSessionStateKey(undefined, '/tmp/stale-session.jsonl')).toBe('draft')
    expect(ensureChatTimelineOpenState(states, undefined)).toBe(draft)
  })

  it('restores separate state buckets for different session files in one thread', () => {
    const states: ChatTimelineOpenStateBySession = {}
    const sessionA = ensureChatTimelineOpenState(states, 'thread-a', '/tmp/session-a.jsonl')
    sessionA.thinking['thinking:a'] = true

    const sessionB = ensureChatTimelineOpenState(states, 'thread-a', '/tmp/session-b.jsonl')
    sessionB.tool.bash = true

    expect(sessionB).not.toBe(sessionA)
    expect(ensureChatTimelineOpenState(states, 'thread-a', '/tmp/session-a.jsonl')).toBe(sessionA)
    expect(sessionA.thinking).toEqual({ 'thinking:a': true })
    expect(sessionA.tool.bash).toBeUndefined()
  })

  it('returns the proxy after creating state inside a reactive container', () => {
    const states = reactive<ChatTimelineOpenStateBySession>({})
    const session = ensureChatTimelineOpenState(states, 'session-a', '/tmp/session-a.jsonl')
    let observed: boolean | undefined
    let effectRuns = 0

    effect(() => {
      effectRuns += 1
      observed = session.tool.read
    })

    expect(isReactive(session)).toBe(true)
    expect(effectRuns).toBe(1)
    session.tool.read = true
    expect(observed).toBe(true)
    expect(effectRuns).toBe(2)
  })
})
