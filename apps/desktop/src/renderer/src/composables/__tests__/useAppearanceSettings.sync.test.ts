import type { DesktopUiPreferences } from '@shared/coding-agent/types'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDesktopUiPreferencesSyncForTest } from '../desktopUiPreferencesSync'
import {
  resetAppearanceSettingsForTest,
  useAppearanceSettings
} from '../useAppearanceSettings'

describe('useAppearanceSettings Desktop hydration', () => {
  beforeEach(() => {
    installDocument()
    resetDesktopUiPreferencesSyncForTest()
    resetAppearanceSettingsForTest()
  })

  afterEach(() => {
    resetAppearanceSettingsForTest()
    resetDesktopUiPreferencesSyncForTest()
    vi.unstubAllGlobals()
  })

  it('逐字段合并 Desktop 偏好，并保留读取期间的用户修改', async () => {
    const preferences = createDeferred<DesktopUiPreferences>()
    const updateDesktopUiPreferences = vi.fn().mockResolvedValue({})
    installWindow(preferences.promise, updateDesktopUiPreferences)

    const settings = useAppearanceSettings()
    settings.setUiFontSize(16)
    preferences.resolve({
      appearance: {
        uiFontSize: 12,
        codeFontSize: 17,
        density: 'compact',
        messageTimeDisplay: 'always'
      }
    })

    await nextTick()
    await vi.waitFor(() => expect(updateDesktopUiPreferences).toHaveBeenCalledTimes(1))

    expect(settings.uiFontSize.value).toBe(16)
    expect(settings.codeFontSize.value).toBe(17)
    expect(settings.density.value).toBe('compact')
    expect(settings.messageTimeDisplay.value).toBe('always')
    expect(updateDesktopUiPreferences).toHaveBeenCalledWith({
      appearance: { uiFontSize: 16 }
    })
  })

  it('初始读取失败时只补写用户明确修改的字段', async () => {
    const preferences = createDeferred<DesktopUiPreferences>()
    const updateDesktopUiPreferences = vi.fn().mockResolvedValue({})
    installWindow(preferences.promise, updateDesktopUiPreferences)

    const settings = useAppearanceSettings()
    settings.setDensity('comfortable')
    preferences.reject(new Error('read failed'))

    await vi.waitFor(() => expect(updateDesktopUiPreferences).toHaveBeenCalledTimes(1))

    expect(updateDesktopUiPreferences).toHaveBeenCalledWith({
      appearance: { density: 'comfortable' }
    })
  })
})

function installDocument(): void {
  vi.stubGlobal('document', {
    documentElement: {
      style: {
        setProperty: vi.fn()
      }
    }
  })
}

function installWindow(
  preferences: Promise<DesktopUiPreferences>,
  updateDesktopUiPreferences: ReturnType<typeof vi.fn>
): void {
  vi.stubGlobal('window', {
    localStorage: createMemoryStorage(),
    api: {
      codingAgent: {
        getDesktopUiPreferences: vi.fn(() => preferences),
        updateDesktopUiPreferences
      }
    }
  })
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value))
  }
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
