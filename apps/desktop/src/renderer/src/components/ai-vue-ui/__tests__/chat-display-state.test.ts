import { describe, expect, it } from 'vitest'
import { getChatDisplayOpenState, pruneChatDisplayOpenState } from '../chat-display-state'

describe('chat display open state', () => {
  it('按 stateKey 隔离并复用展开状态', () => {
    const first = getChatDisplayOpenState('state-a')
    const same = getChatDisplayOpenState('state-a')
    const other = getChatDisplayOpenState('state-b')

    first.toolGroups.a = true
    expect(same).toBe(first)
    expect(same.toolGroups.a).toBe(true)
    expect(other.toolGroups.a).toBeUndefined()
  })

  it('仅清理事实源中已不存在的 key', () => {
    const state = getChatDisplayOpenState('state-prune')
    state.collapsedHistory['history:keep'] = true
    state.collapsedHistory['history:drop'] = true
    state.toolGroups.keep = true
    state.toolGroups.drop = true

    pruneChatDisplayOpenState(state, new Set(['history:keep']), new Set(['keep']))

    expect(state.collapsedHistory).toEqual({ 'history:keep': true })
    expect(state.toolGroups).toEqual({ keep: true })
  })
})
