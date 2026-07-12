/**
 * initialSettingsLoad.ts - Chat 首屏 settings 延后加载调度。
 */

interface SettingsLoadStore {
  snapshot: unknown
  load: () => Promise<void> | void
}

export interface InitialSettingsLoadSchedule {
  cancel: () => void
}

export interface InitialSettingsLoadOptions<TTimer = ReturnType<typeof setTimeout>> {
  delayMs?: number
  setTimer?: (callback: () => void, delayMs: number) => TTimer
  clearTimer?: (timerId: TTimer) => void
}

export const initialSettingsLoadDelayMs = 900

/**
 * 延后加载 Chat 首屏需要的 settings，避开 main 进程完整 IPC deferred 注册窗口。
 */
export function scheduleInitialSettingsLoad<TTimer = ReturnType<typeof setTimeout>>(
  agentSettings: SettingsLoadStore,
  modelSettings: SettingsLoadStore,
  options: InitialSettingsLoadOptions<TTimer> = {}
): InitialSettingsLoadSchedule {
  const setTimer =
    options.setTimer ??
    ((callback: () => void, delayMs: number): TTimer => setTimeout(callback, delayMs) as TTimer)
  const clearTimer =
    options.clearTimer ??
    ((timerId: TTimer): void => {
      clearTimeout(timerId as ReturnType<typeof setTimeout>)
    })
  const timerId = setTimer(() => {
    if (!agentSettings.snapshot) {
      void agentSettings.load()
    }
    if (!modelSettings.snapshot) {
      void modelSettings.load()
    }
  }, options.delayMs ?? initialSettingsLoadDelayMs)

  return {
    cancel: () => clearTimer(timerId)
  }
}
