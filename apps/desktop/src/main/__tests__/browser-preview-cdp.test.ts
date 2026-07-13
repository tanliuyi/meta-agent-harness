import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { BrowserPreviewCdpController } from '../browser-preview-cdp'

class FakeDebugger extends EventEmitter {
  attached = false
  attach = vi.fn(() => {
    this.attached = true
  })
  detach = vi.fn(() => {
    this.attached = false
  })
  isAttached = vi.fn(() => this.attached)
  sendCommand = vi.fn(
    async (method: string, params?: unknown, sessionId?: string): Promise<unknown> => ({
      method,
      params,
      sessionId
    })
  )
}

describe('Browser Preview CDP controller', () => {
  it('full mode attaches once and forwards arbitrary methods, params, and session IDs', async () => {
    const controller = new BrowserPreviewCdpController()
    const target = new FakeDebugger()
    const arbitraryMethod = `Custom.${'m'.repeat(256)}`
    const childSessionId = `child-${'s'.repeat(256)}`

    await expect(
      controller.sendCommand(
        7,
        target as never,
        arbitraryMethod,
        { message: '{"id":1}' },
        childSessionId,
        'full'
      )
    ).resolves.toEqual({
      method: arbitraryMethod,
      params: { message: '{"id":1}' },
      sessionId: childSessionId
    })
    await controller.sendCommand(
      7,
      target as never,
      'Browser.getVersion',
      undefined,
      undefined,
      'full'
    )

    expect(target.attach).toHaveBeenCalledTimes(1)
    expect(target.sendCommand).toHaveBeenCalledWith(
      arbitraryMethod,
      { message: '{"id":1}' },
      childSessionId
    )
  })

  it('safe mode allows bounded diagnostics and blocks sensitive or nested protocol access', async () => {
    const controller = new BrowserPreviewCdpController()
    const target = new FakeDebugger()

    await expect(
      controller.sendCommand(8, target as never, 'Page.getLayoutMetrics')
    ).resolves.toMatchObject({ method: 'Page.getLayoutMetrics' })
    for (const method of [
      'Network.getAllCookies',
      'Storage.getCookies',
      'Target.sendMessageToTarget',
      'Page.setDownloadBehavior'
    ]) {
      await expect(controller.sendCommand(8, target as never, method)).rejects.toThrow(
        'requires full access'
      )
    }
    await expect(
      controller.sendCommand(8, target as never, 'DOM.getDocument', { depth: -1 })
    ).rejects.toThrow('depth requires full access')
    await expect(
      controller.sendCommand(8, target as never, 'DOM.getDocument', undefined, 'child-session')
    ).rejects.toThrow('Child CDP sessions require full access')
  })

  it('disabled mode rejects CDP without attaching the debugger', async () => {
    const controller = new BrowserPreviewCdpController()
    const target = new FakeDebugger()

    await expect(
      controller.sendCommand(
        8,
        target as never,
        'Page.getLayoutMetrics',
        undefined,
        undefined,
        'disabled'
      )
    ).rejects.toThrow('disabled in Settings')
    expect(target.attach).not.toHaveBeenCalled()
    expect(target.sendCommand).not.toHaveBeenCalled()
  })

  it('detaches an existing safe-mode debugger immediately when CDP is disabled', async () => {
    const controller = new BrowserPreviewCdpController()
    const target = new FakeDebugger()

    await controller.sendCommand(8, target as never, 'Page.getLayoutMetrics')
    expect(target.attach).toHaveBeenCalledTimes(1)

    controller.updateAllAccessModes('disabled')

    expect(target.detach).toHaveBeenCalledTimes(1)
    await expect(
      controller.sendCommand(
        8,
        target as never,
        'Page.getLayoutMetrics',
        undefined,
        undefined,
        'disabled'
      )
    ).rejects.toThrow('disabled in Settings')
    expect(target.sendCommand).toHaveBeenCalledTimes(1)
  })

  it('buffers full-mode protocol events, reports overflow, and supports clearing', () => {
    const controller = new BrowserPreviewCdpController(2)
    const target = new FakeDebugger()
    controller.register(9, target as never, 'full')

    target.emit('message', {}, 'Network.requestWillBeSent', { requestId: '1' }, undefined)
    target.emit('message', {}, 'Network.responseReceived', { requestId: '1' }, 'network-session')
    target.emit('message', {}, 'Page.loadEventFired', { timestamp: 10 }, undefined)

    expect(controller.readEvents(9, { limit: 1 }, 'full')).toMatchObject({
      buffered: 2,
      dropped: 1,
      events: [{ sequence: 3, method: 'Page.loadEventFired', params: { timestamp: 10 } }]
    })
    expect(controller.readEvents(9, { clear: true }, 'full').events[0]).toMatchObject({
      sequence: 2,
      method: 'Network.responseReceived',
      sessionId: 'network-session'
    })
    expect(controller.readEvents(9)).toEqual({ events: [], buffered: 0, dropped: 0 })
  })

  it('removes the debugger listener with the webview lifecycle', () => {
    const controller = new BrowserPreviewCdpController()
    const target = new FakeDebugger()
    controller.register(11, target as never)

    controller.remove(11)
    target.emit('message', {}, 'Runtime.consoleAPICalled', {}, undefined)

    expect(controller.readEvents(11)).toEqual({ events: [], buffered: 0, dropped: 0 })
    expect(target.listenerCount('message')).toBe(0)
  })

  it('drops oversized events and evicts old events when the byte budget is exhausted', () => {
    const oversizedController = new BrowserPreviewCdpController(10, 256, 1024)
    const oversizedTarget = new FakeDebugger()
    oversizedController.register(12, oversizedTarget as never, 'full')

    oversizedTarget.emit(
      'message',
      {},
      'Runtime.consoleAPICalled',
      { value: 'x'.repeat(1024) },
      undefined
    )
    expect(oversizedController.readEvents(12, {}, 'full')).toEqual({
      events: [],
      buffered: 0,
      dropped: 1
    })

    const budgetController = new BrowserPreviewCdpController(10, 512, 420)
    const budgetTarget = new FakeDebugger()
    budgetController.register(13, budgetTarget as never, 'full')
    budgetTarget.emit('message', {}, 'Runtime.first', { value: 'a'.repeat(120) }, undefined)
    budgetTarget.emit('message', {}, 'Runtime.second', { value: 'b'.repeat(120) }, undefined)

    expect(budgetController.readEvents(13, {}, 'full')).toMatchObject({
      buffered: 1,
      dropped: 1,
      events: [{ sequence: 2, method: 'Runtime.second' }]
    })
  })

  it('applies stability byte budgets to command params, responses, and event reads', async () => {
    const controller = new BrowserPreviewCdpController(10, 512, 4096, 128, 128, 320)
    const target = new FakeDebugger()

    await expect(
      controller.sendCommand(14, target as never, 'Page.getLayoutMetrics', {
        padding: 'x'.repeat(512)
      })
    ).rejects.toThrow('parameters exceed the byte budget')

    target.sendCommand.mockResolvedValueOnce({ value: 'x'.repeat(512) })
    await expect(
      controller.sendCommand(14, target as never, 'Page.getLayoutMetrics')
    ).rejects.toThrow('response exceeds the byte budget')

    controller.register(14, target as never, 'full')
    target.emit('message', {}, 'Runtime.first', { value: 'a'.repeat(80) }, undefined)
    target.emit('message', {}, 'Runtime.second', { value: 'b'.repeat(80) }, undefined)
    expect(controller.readEvents(14, { limit: 2 }, 'full')).toMatchObject({
      truncated: true,
      events: [{ method: 'Runtime.second' }]
    })
  })

  it('keeps stability payload budgets in full mode without restricting protocol methods', async () => {
    const controller = new BrowserPreviewCdpController(10, 512, 4096, 128, 128, 320)
    const target = new FakeDebugger()

    await expect(
      controller.sendCommand(
        16,
        target as never,
        'Runtime.evaluate',
        { expression: 'x'.repeat(512) },
        undefined,
        'full'
      )
    ).rejects.toThrow('parameters exceed the byte budget')

    target.sendCommand.mockResolvedValueOnce({ value: 'r'.repeat(512) })
    await expect(
      controller.sendCommand(16, target as never, 'Runtime.evaluate', undefined, undefined, 'full')
    ).rejects.toThrow('response exceeds the byte budget')
  })

  it('detaches and purges all full-mode events immediately after settings downgrade', () => {
    const controller = new BrowserPreviewCdpController()
    const target = new FakeDebugger()
    target.attached = true
    controller.register(15, target as never, 'full')
    target.emit('message', {}, 'Network.requestWillBeSentExtraInfo', { headers: {} }, undefined)
    target.emit('message', {}, 'Page.loadEventFired', { timestamp: 1 }, undefined)

    expect(controller.readEvents(15, {}, 'safe')).toMatchObject({
      events: [],
      dropped: 2
    })
    expect(target.detach).toHaveBeenCalledTimes(1)
  })

  it('applies downgrade before rejecting the first no-longer-allowed command', async () => {
    const controller = new BrowserPreviewCdpController()
    const target = new FakeDebugger()
    target.attached = true
    controller.register(17, target as never, 'full')
    target.emit('message', {}, 'Network.requestWillBeSent', { requestId: '1' }, undefined)

    await expect(
      controller.sendCommand(
        17,
        target as never,
        'Network.getAllCookies',
        undefined,
        undefined,
        'safe'
      )
    ).rejects.toThrow('requires full access')
    expect(target.detach).toHaveBeenCalledTimes(1)
    expect(controller.readEvents(17, {}, 'safe')).toMatchObject({ events: [], dropped: 1 })
  })

  it('rejects child-session events in safe mode and supports proactive global downgrade', () => {
    const controller = new BrowserPreviewCdpController()
    const target = new FakeDebugger()
    target.attached = true
    controller.register(18, target as never, 'full')
    target.emit('message', {}, 'Page.frameNavigated', {}, 'child-session')

    controller.updateAllAccessModes('safe')
    target.emit('message', {}, 'Page.loadEventFired', {}, 'child-session')
    target.emit('message', {}, 'Page.loadEventFired', {}, undefined)

    expect(controller.readEvents(18, {}, 'safe')).toMatchObject({
      events: [{ method: 'Page.loadEventFired' }],
      dropped: 2
    })
  })
})
