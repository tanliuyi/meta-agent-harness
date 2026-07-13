export interface SessionPanelCacheCandidate<TComponent> {
  cacheKey: string
  compact: boolean
  component: TComponent
  instanceId: string
  panelId?: string
  sessionKey: string
  threadId?: string
}

export interface SessionPanelCacheEntry<TComponent> extends SessionPanelCacheCandidate<TComponent> {
  lastUsedAt: number
}

interface ReconcileSessionPanelCacheOptions<TComponent> {
  accessSequence: number
  activeCacheKey: string
  currentCandidates: readonly SessionPanelCacheCandidate<TComponent>[]
  currentSessionKey: string
  liveThreadIds: ReadonlySet<string>
  maxEntries: number
}

interface ReconcileSessionPanelCacheResult<TComponent> {
  accessSequence: number
  entries: SessionPanelCacheEntry<TComponent>[]
}

/**
 * Reconciles the retained tab cache without treating every open tab as recently used.
 * Only the active candidate may create a new cache entry; existing open entries remain cached.
 */
export function reconcileSessionPanelCache<TComponent>(
  cachedEntries: readonly SessionPanelCacheEntry<TComponent>[],
  options: ReconcileSessionPanelCacheOptions<TComponent>
): ReconcileSessionPanelCacheResult<TComponent> {
  const isLiveCandidate = (candidate: SessionPanelCacheCandidate<TComponent>): boolean =>
    candidate.threadId === undefined
      ? candidate.sessionKey === options.currentSessionKey
      : options.liveThreadIds.has(candidate.threadId)
  const candidatesByCacheKey = new Map(
    options.currentCandidates
      .filter(isLiveCandidate)
      .map((candidate) => [candidate.cacheKey, candidate] as const)
  )

  const entries = cachedEntries.flatMap((entry): SessionPanelCacheEntry<TComponent>[] => {
    const belongsToLiveThread =
      entry.threadId === undefined
        ? entry.sessionKey === options.currentSessionKey
        : options.liveThreadIds.has(entry.threadId)
    if (!belongsToLiveThread) {
      return []
    }
    if (entry.sessionKey !== options.currentSessionKey) {
      return [entry]
    }
    const currentCandidate = candidatesByCacheKey.get(entry.cacheKey)
    return currentCandidate ? [{ ...entry, ...currentCandidate }] : []
  })

  let accessSequence = options.accessSequence
  const activeCandidate = candidatesByCacheKey.get(options.activeCacheKey)
  if (activeCandidate) {
    accessSequence += 1
    const activeIndex = entries.findIndex((entry) => entry.cacheKey === options.activeCacheKey)
    const activeEntry = { ...activeCandidate, lastUsedAt: accessSequence }
    if (activeIndex >= 0) {
      entries[activeIndex] = activeEntry
    } else {
      entries.push(activeEntry)
    }
  }

  while (entries.length > options.maxEntries) {
    let oldestIndex = -1
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!
      if (entry.cacheKey === options.activeCacheKey) {
        continue
      }
      if (oldestIndex < 0 || entry.lastUsedAt < entries[oldestIndex]!.lastUsedAt) {
        oldestIndex = index
      }
    }
    if (oldestIndex < 0) {
      break
    }
    entries.splice(oldestIndex, 1)
  }

  return { accessSequence, entries }
}
