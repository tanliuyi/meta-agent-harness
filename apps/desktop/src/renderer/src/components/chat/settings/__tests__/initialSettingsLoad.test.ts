/**
 * initialSettingsLoad.test.ts - Chat 首屏 settings 延后加载调度测试。
 */

import { describe, expect, it, vi, type Mock } from 'vitest'
import { initialSettingsLoadDelayMs, scheduleInitialSettingsLoad } from '../initialSettingsLoad'

describe('scheduleInitialSettingsLoad', () => {
  it('延后加载缺失的 agent/model settings', () => {
    const scheduled = createScheduler()
    const agentSettings = createStore()
    const modelSettings = createStore()

    scheduleInitialSettingsLoad(agentSettings, modelSettings, scheduled.options)

    expect(scheduled.delayMs).toBe(initialSettingsLoadDelayMs)
    expect(agentSettings.load).not.toHaveBeenCalled()
    expect(modelSettings.load).not.toHaveBeenCalled()

    scheduled.run()

    expect(agentSettings.load).toHaveBeenCalledTimes(1)
    expect(modelSettings.load).toHaveBeenCalledTimes(1)
  })

  it('已有 snapshot 时不重复加载', () => {
    const scheduled = createScheduler()
    const agentSettings = createStore({ snapshot: { display: {} } })
    const modelSettings = createStore({ snapshot: { settings: {} } })

    scheduleInitialSettingsLoad(agentSettings, modelSettings, scheduled.options)
    scheduled.run()

    expect(agentSettings.load).not.toHaveBeenCalled()
    expect(modelSettings.load).not.toHaveBeenCalled()
  })

  it('cancel 后清理 timer', () => {
    const scheduled = createScheduler()
    const agentSettings = createStore()
    const modelSettings = createStore()

    const registration = scheduleInitialSettingsLoad(
      agentSettings,
      modelSettings,
      scheduled.options
    )
    registration.cancel()

    expect(scheduled.cleared).toBe(true)
  })
})

function createStore(options: { snapshot?: unknown } = {}): {
  snapshot: unknown
  load: Mock<() => void>
} {
  return {
    snapshot: options.snapshot ?? null,
    load: vi.fn<() => void>()
  }
}

function createScheduler(): {
  delayMs: number | undefined
  cleared: boolean
  run: () => void
  options: {
    setTimer: (callback: () => void, delayMs: number) => number
    clearTimer: (timerId: number) => void
  }
} {
  let callback: (() => void) | undefined
  const scheduler = {
    delayMs: undefined as number | undefined,
    cleared: false,
    run: () => callback?.(),
    options: {
      setTimer: (nextCallback: () => void, delayMs: number): number => {
        callback = nextCallback
        scheduler.delayMs = delayMs
        return 1
      },
      clearTimer: (_timerId: number): void => {
        scheduler.cleared = true
      }
    }
  }
  return scheduler
}
