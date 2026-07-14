/**
 * 管理第二实例触发的主窗口聚焦，并覆盖 app ready 前窗口尚未创建的时序。
 */

export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean
}

export function acquireSingleInstanceLock(app: SingleInstanceApp, isDevelopment: boolean): boolean {
  return isDevelopment || app.requestSingleInstanceLock()
}

export interface SingleInstanceWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

export class SingleInstanceFocusController {
  private pending = false

  requestFocus(window: SingleInstanceWindow | null): void {
    this.pending = !focusSingleInstanceWindow(window)
  }

  handleWindowCreated(window: SingleInstanceWindow): void {
    if (!this.pending) return
    this.pending = !focusSingleInstanceWindow(window)
  }
}

export function focusSingleInstanceWindow(window: SingleInstanceWindow | null): boolean {
  if (!window || window.isDestroyed()) return false
  if (window.isMinimized()) {
    window.restore()
  }
  window.show()
  window.focus()
  return true
}
