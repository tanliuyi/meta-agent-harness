import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createWebContentsLifetime } from '../web-contents-lifetime'

class FakeWebContents extends EventEmitter {
  destroyed = false

  isDestroyed(): boolean {
    return this.destroyed
  }
}

describe('WebContents lifetime', () => {
  it('主文档 reload/navigation 时 abort，子 frame 与同文档导航不影响', () => {
    const webContents = new FakeWebContents()
    const lifetime = createWebContentsLifetime(webContents as never)

    webContents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
    webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    expect(lifetime.signal.aborted).toBe(false)

    webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    expect(lifetime.signal.aborted).toBe(true)
  })

  it('WebContents 销毁时 abort，dispose 后不再监听', () => {
    const destroyed = new FakeWebContents()
    const destroyedLifetime = createWebContentsLifetime(destroyed as never)
    destroyed.emit('destroyed')
    expect(destroyedLifetime.signal.aborted).toBe(true)

    const disposed = new FakeWebContents()
    const disposedLifetime = createWebContentsLifetime(disposed as never)
    disposedLifetime.dispose()
    disposed.emit('destroyed')
    expect(disposedLifetime.signal.aborted).toBe(false)
  })

  it('renderer 进程异常退出时 abort', () => {
    const webContents = new FakeWebContents()
    const lifetime = createWebContentsLifetime(webContents as never)

    webContents.emit('render-process-gone')

    expect(lifetime.signal.aborted).toBe(true)
  })
})
