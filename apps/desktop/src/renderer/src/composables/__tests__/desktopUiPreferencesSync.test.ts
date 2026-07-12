import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  queueDesktopUiPreferencesUpdate,
  resetDesktopUiPreferencesSyncForTest
} from '../desktopUiPreferencesSync'

describe('desktopUiPreferencesSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetDesktopUiPreferencesSyncForTest()
  })

  afterEach(() => {
    resetDesktopUiPreferencesSyncForTest()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('串行深合并写入期间产生的 appearance 与 workspace patch', async () => {
    const firstWrite = createDeferred<void>()
    const updateDesktopUiPreferences = vi
      .fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue({})
    installApi(updateDesktopUiPreferences)

    queueDesktopUiPreferencesUpdate({ appearance: { density: 'compact' } })
    queueDesktopUiPreferencesUpdate({ appearance: { wrapCode: true } })
    queueDesktopUiPreferencesUpdate({ workspace: { sidebarWidth: 280 } })

    expect(updateDesktopUiPreferences).toHaveBeenCalledTimes(1)
    firstWrite.resolve()
    await vi.waitFor(() => expect(updateDesktopUiPreferences).toHaveBeenCalledTimes(2))

    expect(updateDesktopUiPreferences.mock.calls[1]?.[0]).toEqual({
      appearance: { wrapCode: true },
      workspace: { sidebarWidth: 280 }
    })
  })

  it('失败后有限退避重试，并在新修改到来时补写保留的 patch', async () => {
    const updateDesktopUiPreferences = vi.fn().mockRejectedValue(new Error('disk unavailable'))
    installApi(updateDesktopUiPreferences)

    queueDesktopUiPreferencesUpdate({ appearance: { motion: 'reduced' } })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(50)
    await vi.advanceTimersByTimeAsync(250)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(updateDesktopUiPreferences).toHaveBeenCalledTimes(3)

    updateDesktopUiPreferences.mockResolvedValue({})
    queueDesktopUiPreferencesUpdate({ workspace: { threadSortMode: 'threaded' } })
    await vi.waitFor(() => expect(updateDesktopUiPreferences).toHaveBeenCalledTimes(4))

    expect(updateDesktopUiPreferences.mock.calls[3]?.[0]).toEqual({
      appearance: { motion: 'reduced' },
      workspace: { threadSortMode: 'threaded' }
    })
  })
})

function installApi(updateDesktopUiPreferences: ReturnType<typeof vi.fn>): void {
  vi.stubGlobal('window', {
    api: {
      codingAgent: {
        updateDesktopUiPreferences
      }
    }
  })
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}
