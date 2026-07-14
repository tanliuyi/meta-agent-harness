/**
 * 验证第二实例聚焦行为及 app ready 前的 pending 时序。
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  acquireSingleInstanceLock,
  SingleInstanceFocusController,
  focusSingleInstanceWindow,
  type SingleInstanceApp,
  type SingleInstanceWindow
} from '../single-instance'

describe('single instance window focus', () => {
  it('仅在生产模式申请单实例锁', () => {
    const developmentApp = createApp(false)
    const productionApp = createApp(true)
    const lockedProductionApp = createApp(false)

    expect(acquireSingleInstanceLock(developmentApp, true)).toBe(true)
    expect(developmentApp.requestSingleInstanceLock).not.toHaveBeenCalled()
    expect(acquireSingleInstanceLock(productionApp, false)).toBe(true)
    expect(productionApp.requestSingleInstanceLock).toHaveBeenCalledOnce()
    expect(acquireSingleInstanceLock(lockedProductionApp, false)).toBe(false)
  })

  it('在 app ready 前确定实例策略并只让生产主实例注册第二实例监听', () => {
    const source = readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8')
    const lockIndex = source.indexOf('acquireSingleInstanceLock(app, isDevelopment)')
    const readyIndex = source.indexOf('app.whenReady()')

    expect(lockIndex).toBeGreaterThan(-1)
    expect(lockIndex).toBeLessThan(readyIndex)
    expect(source).toContain('if (!singleInstanceLockAcquired)')
    expect(source).toContain('if (!isDevelopment)')
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

function createApp(lockAcquired: boolean): SingleInstanceApp {
  return {
    requestSingleInstanceLock: vi.fn(() => lockAcquired)
  }
}

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
