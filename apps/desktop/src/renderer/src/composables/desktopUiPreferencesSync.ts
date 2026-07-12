import type { UpdateDesktopUiPreferencesInput } from '@shared/coding-agent/types'

const retryDelays = [50, 250] as const

let pendingPatch: UpdateDesktopUiPreferencesInput | undefined
let isFlushing = false
let retryIndex = 0
let retryTimer: ReturnType<typeof setTimeout> | undefined

function mergePatches(
  base: UpdateDesktopUiPreferencesInput | undefined,
  override: UpdateDesktopUiPreferencesInput | undefined
): UpdateDesktopUiPreferencesInput | undefined {
  if (!base && !override) return undefined

  const appearance = {
    ...base?.appearance,
    ...override?.appearance
  }
  const workspace = {
    ...base?.workspace,
    ...override?.workspace
  }

  return {
    ...(Object.keys(appearance).length > 0 ? { appearance } : {}),
    ...(Object.keys(workspace).length > 0 ? { workspace } : {})
  }
}

function startFlush(): void {
  void flushPendingPatch().catch(() => {
    // flushPendingPatch 会消费 IPC 错误；这里只防止未来改动产生未处理 rejection。
  })
}

function scheduleRetry(): void {
  const delay = retryDelays[retryIndex]
  if (delay === undefined || retryTimer !== undefined) return

  retryIndex += 1
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    startFlush()
  }, delay)
}

async function flushPendingPatch(): Promise<void> {
  if (isFlushing || !pendingPatch) return

  const patch = pendingPatch
  pendingPatch = undefined
  isFlushing = true
  let succeeded = false

  try {
    const updatePreferences = window.api?.codingAgent.updateDesktopUiPreferences
    if (!updatePreferences) {
      throw new Error('Desktop UI preferences API is unavailable')
    }
    await updatePreferences(patch)
    succeeded = true
    retryIndex = 0
  } catch {
    // 旧 patch 先合并，确保写入期间产生的新值优先。
    pendingPatch = mergePatches(patch, pendingPatch)
    scheduleRetry()
  } finally {
    isFlushing = false
  }

  if (succeeded && pendingPatch) {
    startFlush()
  }
}

/**
 * 合并并串行写入 Desktop UI 偏好。
 *
 * 写入失败时 patch 会保留，并进行有限次数的退避重试。新的用户修改会重新开启一轮重试，
 * 因此失败不会丢失状态，也不会形成无界重试循环。
 */
export function queueDesktopUiPreferencesUpdate(patch: UpdateDesktopUiPreferencesInput): void {
  pendingPatch = mergePatches(pendingPatch, patch)
  retryIndex = 0

  if (retryTimer !== undefined) {
    clearTimeout(retryTimer)
    retryTimer = undefined
  }

  startFlush()
}

export function resetDesktopUiPreferencesSyncForTest(): void {
  if (retryTimer !== undefined) {
    clearTimeout(retryTimer)
  }
  pendingPatch = undefined
  isFlushing = false
  retryIndex = 0
  retryTimer = undefined
}
