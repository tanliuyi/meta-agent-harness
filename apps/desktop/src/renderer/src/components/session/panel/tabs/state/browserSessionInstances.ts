export interface BrowserSessionInstance {
  lastUsedAt: number
  scope: string
  threadId?: string
}

export const MAX_IDLE_BROWSER_SESSION_INSTANCES = 4

interface ReconcileBrowserSessionInstancesInput {
  activeInstance?: BrowserSessionInstance
  activeScope?: string
  busyScopes: string[]
  currentDraftScope?: string
  maxIdleInstances?: number
  now: number
  requiredThreadInstances: BrowserSessionInstance[]
  validThreadInstances: BrowserSessionInstance[]
}

function addInstance(
  instances: BrowserSessionInstance[],
  instance: BrowserSessionInstance | undefined
): void {
  if (!instance) return
  const existing = instances.find((candidate) => candidate.scope === instance.scope)
  if (existing) {
    if (instance.threadId) existing.threadId = instance.threadId
    existing.lastUsedAt = Math.max(existing.lastUsedAt, instance.lastUsedAt)
    return
  }
  instances.push({ ...instance })
}

export function reconcileBrowserSessionInstances(
  current: BrowserSessionInstance[],
  input: ReconcileBrowserSessionInstancesInput
): BrowserSessionInstance[] {
  const validThreadIds = new Set(
    input.validThreadInstances.flatMap((instance) => (instance.threadId ? [instance.threadId] : []))
  )
  const validThreadByScope = new Map(
    input.validThreadInstances.map((instance) => [instance.scope, instance] as const)
  )
  const busyScopes = new Set(input.busyScopes)
  const next: BrowserSessionInstance[] = []

  for (const instance of current) {
    const validThread = instance.threadId
      ? validThreadIds.has(instance.threadId)
        ? instance
        : undefined
      : validThreadByScope.get(instance.scope)
    if (validThread) {
      addInstance(next, {
        lastUsedAt: instance.lastUsedAt,
        scope: instance.scope,
        threadId: validThread.threadId
      })
    } else if (
      instance.scope === input.activeScope ||
      instance.scope === input.currentDraftScope ||
      busyScopes.has(instance.scope)
    ) {
      addInstance(next, instance)
    }
  }

  addInstance(next, input.activeInstance)
  for (const instance of input.requiredThreadInstances) addInstance(next, instance)

  const active = input.activeScope
    ? next.find((instance) => instance.scope === input.activeScope)
    : undefined
  if (active) active.lastUsedAt = Math.max(active.lastUsedAt, input.now)

  const protectedScopes = new Set([
    ...input.busyScopes,
    ...input.requiredThreadInstances.map((instance) => instance.scope)
  ])
  if (input.activeScope) protectedScopes.add(input.activeScope)
  if (input.currentDraftScope) protectedScopes.add(input.currentDraftScope)

  const maxIdleInstances = Math.max(0, input.maxIdleInstances ?? MAX_IDLE_BROWSER_SESSION_INSTANCES)
  const retainedIdleScopes = new Set(
    next
      .filter((instance) => !protectedScopes.has(instance.scope))
      .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
      .slice(0, maxIdleInstances)
      .map((instance) => instance.scope)
  )

  return next.filter(
    (instance) => protectedScopes.has(instance.scope) || retainedIdleScopes.has(instance.scope)
  )
}
