export type PendingMemoryAction = {
  requestId: string
  kind: 'refresh' | 'add' | 'replace' | 'remove'
}

export type MemoryTarget = 'memory' | 'user' | 'project' | 'failure'

export type MemorySnapshot = {
  type: 'hermes.snapshot'
  project: string | null
  entries: Record<MemoryTarget, string[]>
  skills: Array<{
    skillId: string
    name: string
    description: string
    scope: string
    updated: string
  }>
  limits: { memory: number; user: number; project: number }
}

export type MemoryPanelMessageUpdate = {
  snapshot: MemorySnapshot | undefined
  snapshotError: boolean
  actionResult: { success: boolean; error?: string } | null
}

export function selectThreadPanelMessage(
  runtimeByThreadId: Record<
    string,
    { extensionPanelMessages?: Record<string, { message?: unknown }> } | undefined
  >,
  threadId: string | undefined,
  panelId: string | undefined
): unknown {
  if (!threadId || !panelId) return undefined
  return runtimeByThreadId[threadId]?.extensionPanelMessages?.[panelId]?.message
}

export function applyMemoryPanelMessage(
  message: unknown,
  pending: PendingMemoryAction | undefined,
  currentSnapshot: MemorySnapshot | undefined
): MemoryPanelMessageUpdate | null {
  if (!message || typeof message !== 'object') return null
  const candidate = message as {
    type?: unknown
    requestId?: unknown
    result?: { success?: unknown; error?: unknown }
    snapshot?: unknown
  }

  if (candidate.type === 'hermes.snapshot') {
    return isMemorySnapshot(message)
      ? { snapshot: message, snapshotError: false, actionResult: null }
      : { snapshot: currentSnapshot, snapshotError: true, actionResult: null }
  }

  if (
    !pending ||
    candidate.type !== 'hermes.actionResult' ||
    candidate.requestId !== pending.requestId ||
    typeof candidate.result?.success !== 'boolean'
  ) {
    return null
  }

  const actionResult = {
    success: candidate.result.success,
    error: typeof candidate.result.error === 'string' ? candidate.result.error : undefined
  }
  if (!actionResult.success) {
    return { snapshot: currentSnapshot, snapshotError: false, actionResult }
  }
  return isMemorySnapshot(candidate.snapshot)
    ? { snapshot: candidate.snapshot, snapshotError: false, actionResult }
    : { snapshot: currentSnapshot, snapshotError: true, actionResult }
}

function isMemorySnapshot(value: unknown): value is MemorySnapshot {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<MemorySnapshot>
  return (
    candidate.type === 'hermes.snapshot' &&
    (candidate.project === null || typeof candidate.project === 'string') &&
    candidate.entries !== undefined &&
    ['memory', 'user', 'project', 'failure'].every((key) => {
      const entries = candidate.entries?.[key as MemoryTarget]
      return Array.isArray(entries) && entries.every((entry) => typeof entry === 'string')
    }) &&
    Array.isArray(candidate.skills) &&
    candidate.skills.every(
      (skill) =>
        typeof skill?.skillId === 'string' &&
        typeof skill.name === 'string' &&
        typeof skill.description === 'string' &&
        typeof skill.scope === 'string' &&
        typeof skill.updated === 'string'
    ) &&
    candidate.limits !== undefined &&
    ['memory', 'user', 'project'].every((key) =>
      Number.isFinite(candidate.limits?.[key as keyof MemorySnapshot['limits']])
    )
  )
}
