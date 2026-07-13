import { describe, expect, it } from 'vitest'
import {
  reconcileSessionPanelCache,
  type SessionPanelCacheCandidate,
  type SessionPanelCacheEntry
} from '../sessionPanelCache'

type TestComponent = { name: string }
type Candidate = SessionPanelCacheCandidate<TestComponent>
type Entry = SessionPanelCacheEntry<TestComponent>

function candidate(
  sessionKey: string,
  instanceId: string,
  threadId: string | undefined = sessionKey
): Candidate {
  return {
    cacheKey: `${sessionKey}:${instanceId}`,
    compact: false,
    component: { name: `${sessionKey}-${instanceId}` },
    instanceId,
    sessionKey,
    threadId
  }
}

function entry(
  sessionKey: string,
  instanceId: string,
  lastUsedAt: number,
  threadId: string | undefined = sessionKey
): Entry {
  return { ...candidate(sessionKey, instanceId, threadId), lastUsedAt }
}

describe('reconcileSessionPanelCache', () => {
  it('切换 thread 时保留旧缓存，且不把当前 thread 未访问的 open tab 加入 LRU', () => {
    const result = reconcileSessionPanelCache([entry('thread-a', 'tab-1', 1)], {
      accessSequence: 1,
      activeCacheKey: 'thread-b:tab-2',
      currentCandidates: [candidate('thread-b', 'tab-1'), candidate('thread-b', 'tab-2')],
      currentSessionKey: 'thread-b',
      liveThreadIds: new Set(['thread-a', 'thread-b']),
      maxEntries: 12
    })

    expect(result.entries.map((item) => item.cacheKey)).toEqual([
      'thread-a:tab-1',
      'thread-b:tab-2'
    ])
  })

  it('关闭当前或后台 tab 时只移除目标缓存', () => {
    const cached = [
      entry('thread-a', 'tab-1', 1),
      entry('thread-a', 'tab-2', 2),
      entry('thread-a', 'tab-3', 3),
      entry('thread-b', 'tab-1', 4)
    ]
    const afterBackgroundClose = reconcileSessionPanelCache(cached, {
      accessSequence: 4,
      activeCacheKey: 'thread-a:tab-2',
      currentCandidates: [candidate('thread-a', 'tab-2'), candidate('thread-a', 'tab-3')],
      currentSessionKey: 'thread-a',
      liveThreadIds: new Set(['thread-a', 'thread-b']),
      maxEntries: 12
    })

    expect(afterBackgroundClose.entries.map((item) => item.cacheKey)).toEqual([
      'thread-a:tab-2',
      'thread-a:tab-3',
      'thread-b:tab-1'
    ])

    const afterCurrentClose = reconcileSessionPanelCache(afterBackgroundClose.entries, {
      accessSequence: afterBackgroundClose.accessSequence,
      activeCacheKey: 'thread-a:tab-3',
      currentCandidates: [candidate('thread-a', 'tab-3')],
      currentSessionKey: 'thread-a',
      liveThreadIds: new Set(['thread-a', 'thread-b']),
      maxEntries: 12
    })

    expect(afterCurrentClose.entries.map((item) => item.cacheKey)).toEqual([
      'thread-a:tab-3',
      'thread-b:tab-1'
    ])
  })

  it('即使删除的是当前 thread，也不会从 current candidate 重建其缓存', () => {
    const result = reconcileSessionPanelCache([entry('thread-a', 'tab-1', 1)], {
      accessSequence: 1,
      activeCacheKey: 'thread-a:tab-1',
      currentCandidates: [candidate('thread-a', 'tab-1')],
      currentSessionKey: 'thread-a',
      liveThreadIds: new Set(),
      maxEntries: 12
    })

    expect(result.entries).toEqual([])
  })

  it('超过上限时淘汰最旧的非 active 缓存', () => {
    const cached = Array.from({ length: 13 }, (_, index) =>
      entry('thread-a', `tab-${index + 1}`, 100 + index)
    )
    const currentCandidates = cached.map(
      ({ cacheKey, compact, component, instanceId, sessionKey, threadId }): Candidate => ({
        cacheKey,
        compact,
        component,
        instanceId,
        sessionKey,
        threadId
      })
    )
    const result = reconcileSessionPanelCache(cached, {
      accessSequence: 0,
      activeCacheKey: 'thread-a:tab-1',
      currentCandidates,
      currentSessionKey: 'thread-a',
      liveThreadIds: new Set(['thread-a']),
      maxEntries: 12
    })

    expect(result.entries).toHaveLength(12)
    expect(result.entries.some((item) => item.cacheKey === 'thread-a:tab-1')).toBe(true)
    expect(result.entries.some((item) => item.cacheKey === 'thread-a:tab-2')).toBe(false)
  })
})
