import { describe, expect, it, vi } from 'vitest'
import type { DesktopExtensionWebviewPanel } from '@shared/coding-agent/types'
import {
  getNextExtensionPanelViewState,
  handleExtensionPanelHostMessage,
  isExtensionPanelNavigationBlocked,
  postExtensionPanelMessage,
  postExtensionPanelState,
  postExtensionPanelTheme,
  postExtensionPanelVisibility
} from '../extensionPanelHostBridge'
import { createExtensionPanelThemePayload } from '../extensionPanelDisplay'

const urlPanel: DesktopExtensionWebviewPanel = {
  id: 'url-panel',
  title: 'URL Panel',
  source: { type: 'url', url: 'https://example.com/panel.html' }
}

const htmlPanel: DesktopExtensionWebviewPanel = {
  id: 'html-panel',
  title: 'HTML Panel',
  source: { type: 'html', html: '<main>Panel</main>' }
}

function createTarget() {
  return { postMessage: vi.fn() } as Pick<Window, 'postMessage'>
}

describe('extensionPanelHostBridge', () => {
  it('向 iframe 投递消息时使用 panel targetOrigin，并在 blocked 时停止投递', () => {
    const target = createTarget()

    expect(
      postExtensionPanelMessage({
        target,
        panel: urlPanel,
        navigationBlocked: false,
        message: { sequence: 1, message: { type: 'ping' } }
      })
    ).toBe(true)
    expect(target.postMessage).toHaveBeenCalledWith({ type: 'ping' }, 'https://example.com')

    expect(
      postExtensionPanelMessage({
        target,
        panel: urlPanel,
        navigationBlocked: true,
        message: { sequence: 2, message: { type: 'blocked' } }
      })
    ).toBe(false)
    expect(target.postMessage).toHaveBeenCalledTimes(1)
  })

  it('向 iframe 投递 state、theme 和 visibility lifecycle', () => {
    const target = createTarget()
    const theme = createExtensionPanelThemePayload({ theme: 'dark' })

    expect(
      postExtensionPanelState({
        target,
        panel: htmlPanel,
        navigationBlocked: false,
        state: { selectedId: 'a' }
      })
    ).toBe(true)
    expect(
      postExtensionPanelTheme({
        target,
        panel: htmlPanel,
        navigationBlocked: false,
        theme
      })
    ).toBe(true)
    expect(
      postExtensionPanelVisibility({
        target,
        panel: htmlPanel,
        navigationBlocked: false,
        visible: true
      })
    ).toBe(true)

    expect(target.postMessage).toHaveBeenNthCalledWith(
      1,
      { type: 'pi:webview.restoreState', state: { selectedId: 'a' } },
      '*'
    )
    expect(target.postMessage).toHaveBeenNthCalledWith(2, theme, '*')
    expect(target.postMessage).toHaveBeenNthCalledWith(
      3,
      { type: 'pi:webview.visibility', visible: true },
      '*'
    )
  })

  it('处理来自 iframe 的 host-reserved state 和 openExternal 消息，不转发给扩展', () => {
    const frameWindow = {} as Window
    const setPanelState = vi.fn()
    const openExternalUrl = vi.fn()
    const sendPanelMessage = vi.fn()

    expect(
      handleExtensionPanelHostMessage({
        panelId: 'html-panel',
        threadId: 'thread-a',
        panel: htmlPanel,
        navigationBlocked: false,
        event: {
          origin: 'null',
          source: frameWindow,
          data: { type: 'pi:webview.state', state: { count: 1 } }
        },
        frameWindow,
        setPanelState,
        openExternalUrl,
        sendPanelMessage
      })
    ).toBe('state-updated')
    expect(setPanelState).toHaveBeenCalledWith('thread-a', 'html-panel', { count: 1 })
    expect(sendPanelMessage).not.toHaveBeenCalled()

    expect(
      handleExtensionPanelHostMessage({
        panelId: 'html-panel',
        threadId: 'thread-a',
        panel: htmlPanel,
        navigationBlocked: false,
        event: {
          origin: 'null',
          source: frameWindow,
          data: { type: 'pi:webview.openExternal', uri: 'https://example.com/docs' }
        },
        frameWindow,
        setPanelState,
        openExternalUrl,
        sendPanelMessage
      })
    ).toBe('open-external')
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/docs')
    expect(sendPanelMessage).not.toHaveBeenCalled()
  })

  it('只转发当前 iframe 且 origin 合法的业务消息', () => {
    const frameWindow = {} as Window
    const sendPanelMessage = vi.fn()

    expect(
      handleExtensionPanelHostMessage({
        panelId: 'url-panel',
        threadId: 'thread-a',
        panel: urlPanel,
        navigationBlocked: false,
        event: {
          origin: 'https://example.com',
          source: frameWindow,
          data: { type: 'ready' }
        },
        frameWindow,
        setPanelState: vi.fn(),
        openExternalUrl: vi.fn(),
        sendPanelMessage
      })
    ).toBe('forwarded')
    expect(sendPanelMessage).toHaveBeenCalledWith('thread-a', 'url-panel', { type: 'ready' })

    expect(
      handleExtensionPanelHostMessage({
        panelId: 'url-panel',
        threadId: 'thread-a',
        panel: urlPanel,
        navigationBlocked: false,
        event: {
          origin: 'https://evil.example',
          source: frameWindow,
          data: { type: 'ready' }
        },
        frameWindow,
        setPanelState: vi.fn(),
        openExternalUrl: vi.fn(),
        sendPanelMessage
      })
    ).toBe('ignored')
    expect(sendPanelMessage).toHaveBeenCalledTimes(1)
  })

  it('blocked navigation 会停止接收 iframe 消息', () => {
    const frameWindow = {} as Window
    const sendPanelMessage = vi.fn()

    expect(
      handleExtensionPanelHostMessage({
        panelId: 'url-panel',
        threadId: 'thread-a',
        panel: urlPanel,
        navigationBlocked: true,
        event: {
          origin: 'https://example.com',
          source: frameWindow,
          data: { type: 'ready' }
        },
        frameWindow,
        setPanelState: vi.fn(),
        openExternalUrl: vi.fn(),
        sendPanelMessage
      })
    ).toBe('ignored')
    expect(sendPanelMessage).not.toHaveBeenCalled()
  })

  it('URL panel navigation blocked 规则跟随 resolved entry origin', () => {
    expect(
      isExtensionPanelNavigationBlocked({
        panel: urlPanel,
        readableFrameLocation: 'https://example.com/next',
        urlSource: 'https://example.com/panel.html'
      })
    ).toBe(false)
    expect(
      isExtensionPanelNavigationBlocked({
        panel: urlPanel,
        readableFrameLocation: 'https://evil.example/next',
        urlSource: 'https://example.com/panel.html'
      })
    ).toBe(true)
    expect(
      isExtensionPanelNavigationBlocked({
        panel: htmlPanel,
        readableFrameLocation: undefined,
        urlSource: ''
      })
    ).toBe(false)
  })

  it('view state lifecycle 去重并保持 active 与 visible 一致', () => {
    expect(
      getNextExtensionPanelViewState({
        panelId: 'html-panel',
        threadId: 'thread-a',
        panel: htmlPanel,
        lastVisibleState: undefined,
        visible: true
      })
    ).toEqual({
      nextLastVisibleState: true,
      event: {
        type: 'viewStateChanged',
        panelId: 'html-panel',
        visible: true,
        active: true
      }
    })
    expect(
      getNextExtensionPanelViewState({
        panelId: 'html-panel',
        threadId: 'thread-a',
        panel: htmlPanel,
        lastVisibleState: true,
        visible: true
      })
    ).toEqual({ nextLastVisibleState: true })
  })
})
