/**
 * 验证第二实例聚焦行为及 app ready 前的 pending 时序。
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  SingleInstanceFocusController,
  focusSingleInstanceWindow,
  type SingleInstanceWindow
} from '../single-instance'

describe('single instance window focus', () => {
  it('在 app ready 前申请锁并只让主实例注册生命周期', () => {
    const source = readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8')
    const lockIndex = source.indexOf('app.requestSingleInstanceLock()')
    const readyIndex = source.indexOf('app.whenReady()')

    expect(lockIndex).toBeGreaterThan(-1)
    expect(lockIndex).toBeLessThan(readyIndex)
    expect(source).toContain('if (!singleInstanceLockAcquired)')
    expect(source).toContain("app.on('second-instance'")
    expect(source).toContain('else if (mainWindowLifecycleReady)')
    expect(source).toContain("app.on('window-all-closed'")
  })

  it('恢复最小化窗口后显示并聚焦', () => {
    const window = createWindow({ minimized: true })

    expect(focusSingleInstanceWindow(window)).toBe(true)
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('窗口尚未创建时保留 pending focus', () => {
    const controller = new SingleInstanceFocusController()
    const window = createWindow()

    controller.requestFocus(null)
    controller.handleWindowCreated(window)

    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('销毁窗口不会消费 pending focus', () => {
    const controller = new SingleInstanceFocusController()
    const destroyedWindow = createWindow({ destroyed: true })
    const replacementWindow = createWindow()

    controller.requestFocus(null)
    controller.handleWindowCreated(destroyedWindow)
    controller.handleWindowCreated(replacementWindow)

    expect(destroyedWindow.show).not.toHaveBeenCalled()
    expect(replacementWindow.show).toHaveBeenCalledOnce()
  })
})

function createWindow(
  options: { destroyed?: boolean; minimized?: boolean } = {}
): SingleInstanceWindow {
  return {
    isDestroyed: vi.fn(() => options.destroyed ?? false),
    isMinimized: vi.fn(() => options.minimized ?? false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn()
  }
}
