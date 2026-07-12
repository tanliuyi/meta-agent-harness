import { describe, expect, it } from 'vitest'
import type { DesktopExtensionWebviewPanel } from '@shared/coding-agent/types'
import {
  cloneExtensionPanelStateForHost,
  collectExtensionPanelThemePayload,
  createExtensionPanelStateRestorePayload,
  createExtensionPanelThemePayload,
  getExtensionPanelAllowedNavigationOrigin,
  getExtensionPanelMessageOrigin,
  getExtensionPanelResolvedUrl,
  getExtensionPanelSandbox,
  getExtensionPanelTargetOrigin,
  injectExtensionPanelCsp,
  injectExtensionPanelHostStyles,
  injectPiPanelHelper,
  injectExtensionPanelScriptNonces,
  isExtensionPanelNavigationAllowed,
  isExtensionPanelOpenExternalPayload,
  isExtensionPanelStatePayload,
  prepareExtensionPanelHtml,
  serializeExtensionPanelStateForInjection,
  shouldAcceptExtensionPanelMessage,
  shouldRetainExtensionPanelContext
} from '../extensionPanelDisplay'

const urlPanel: DesktopExtensionWebviewPanel = {
  id: 'docs',
  title: 'Docs',
  source: { type: 'url', url: 'https://example.com/panel.html' }
}

const htmlPanel: DesktopExtensionWebviewPanel = {
  id: 'html',
  title: 'HTML',
  source: { type: 'html', html: '<h1>Panel</h1>' }
}

describe('extensionPanelDisplay', () => {
  it('用 desktop token 构造 webview theme payload', () => {
    const payload = createExtensionPanelThemePayload({
      theme: 'dark',
      tokens: {
        foreground: 'rgb(1, 2, 3)',
        background: 'rgb(4, 5, 6)',
        mutedForeground: 'rgb(7, 8, 9)',
        border: 'rgb(10, 11, 12)',
        accent: 'rgb(13, 14, 15)',
        focusBorder: 'rgb(16, 17, 18)',
        danger: 'rgb(19, 20, 21)',
        codeBackground: 'rgb(22, 23, 24)',
        scrollbarThumb: 'rgb(25, 26, 27)',
        scrollbarThumbHover: 'rgb(28, 29, 30)'
      }
    })

    expect(payload).toEqual({
      type: 'pi:webview.theme',
      theme: 'dark',
      tokens: {
        foreground: 'rgb(1, 2, 3)',
        background: 'rgb(4, 5, 6)',
        mutedForeground: 'rgb(7, 8, 9)',
        border: 'rgb(10, 11, 12)',
        accent: 'rgb(13, 14, 15)',
        focusBorder: 'rgb(16, 17, 18)',
        danger: 'rgb(19, 20, 21)',
        codeBackground: 'rgb(22, 23, 24)',
        scrollbarThumb: 'rgb(25, 26, 27)',
        scrollbarThumbHover: 'rgb(28, 29, 30)'
      }
    })
  })

  it('theme payload 在缺少 DOM token 时使用稳定 fallback', () => {
    const payload = collectExtensionPanelThemePayload({ theme: 'light' })

    expect(payload.type).toBe('pi:webview.theme')
    expect(payload.theme).toBe('light')
    expect(payload.tokens.foreground).toBe('#201f1b')
    expect(payload.tokens.background).toBe('#ffffff')
  })

  it('默认 sandbox 不允许脚本，按权限追加能力', () => {
    expect(getExtensionPanelSandbox(htmlPanel)).toBe('')
    expect(
      getExtensionPanelSandbox({
        ...urlPanel,
        source: {
          type: 'url',
          url: 'https://example.com/panel.html',
          permissions: {
            enableScripts: true,
            forms: true,
            popups: true,
            downloads: true,
            sameOrigin: true
          }
        }
      })
    ).toBe('allow-scripts allow-forms allow-popups allow-downloads allow-same-origin')
    expect(
      getExtensionPanelSandbox({
        ...htmlPanel,
        source: { type: 'html', html: '<h1>Panel</h1>', permissions: { sameOrigin: true } }
      })
    ).toBe('')
  })

  it('URL panel 使用 URL origin，HTML panel 使用 opaque target', () => {
    expect(getExtensionPanelMessageOrigin(urlPanel)).toBe('https://example.com')
    expect(getExtensionPanelTargetOrigin(urlPanel)).toBe('https://example.com')
    expect(getExtensionPanelMessageOrigin(htmlPanel)).toBeUndefined()
    expect(getExtensionPanelTargetOrigin(htmlPanel)).toBe('*')
  })

  it('URL panel 对 localhost 入口应用 portMapping 并使用映射后 origin', () => {
    const mappedPanel: DesktopExtensionWebviewPanel = {
      id: 'dev',
      title: 'Dev',
      source: {
        type: 'url',
        url: 'http://localhost:5173/index.html?x=1',
        portMapping: [{ webviewPort: 5173, extensionHostPort: 62100 }]
      }
    }

    expect(getExtensionPanelResolvedUrl(mappedPanel)).toBe('http://localhost:62100/index.html?x=1')
    expect(getExtensionPanelMessageOrigin(mappedPanel)).toBe('http://localhost:62100')
    expect(getExtensionPanelTargetOrigin(mappedPanel)).toBe('http://localhost:62100')
    expect(getExtensionPanelAllowedNavigationOrigin(mappedPanel)).toBe('http://localhost:62100')
    expect(
      getExtensionPanelResolvedUrl({
        ...mappedPanel,
        source: {
          type: 'url',
          url: 'https://example.com:5173/app',
          portMapping: [{ webviewPort: 5173, extensionHostPort: 62100 }]
        }
      })
    ).toBe('https://example.com:5173/app')
  })

  it('URL panel navigation 只允许停留在 resolved entry origin', () => {
    const mappedPanel: DesktopExtensionWebviewPanel = {
      id: 'dev',
      title: 'Dev',
      source: {
        type: 'url',
        url: 'http://localhost:5173/index.html',
        portMapping: [{ webviewPort: 5173, extensionHostPort: 62100 }]
      }
    }

    expect(isExtensionPanelNavigationAllowed(urlPanel, 'https://example.com/next')).toBe(true)
    expect(isExtensionPanelNavigationAllowed(urlPanel, 'https://example.com:443/next')).toBe(true)
    expect(isExtensionPanelNavigationAllowed(urlPanel, 'https://evil.example/next')).toBe(false)
    expect(isExtensionPanelNavigationAllowed(urlPanel, 'mailto:dev@example.com')).toBe(false)
    expect(isExtensionPanelNavigationAllowed(htmlPanel, 'https://example.com/next')).toBe(false)
    expect(isExtensionPanelNavigationAllowed(mappedPanel, 'http://localhost:5173/next')).toBe(true)
    expect(isExtensionPanelNavigationAllowed(mappedPanel, 'http://localhost:62100/next')).toBe(true)
    expect(isExtensionPanelNavigationAllowed(mappedPanel, 'http://127.0.0.1:5173/next')).toBe(false)
  })

  it('只接受当前 iframe source 且 URL origin 匹配的消息', () => {
    const frameWindow = {} as Window
    expect(
      shouldAcceptExtensionPanelMessage({
        panel: urlPanel,
        eventOrigin: 'https://example.com',
        eventSource: frameWindow,
        frameWindow
      })
    ).toBe(true)
    expect(
      shouldAcceptExtensionPanelMessage({
        panel: urlPanel,
        eventOrigin: 'https://evil.example',
        eventSource: frameWindow,
        frameWindow
      })
    ).toBe(false)
    expect(
      shouldAcceptExtensionPanelMessage({
        panel: htmlPanel,
        eventOrigin: 'null',
        eventSource: frameWindow,
        frameWindow
      })
    ).toBe(true)
    expect(
      shouldAcceptExtensionPanelMessage({
        panel: htmlPanel,
        eventOrigin: 'null',
        eventSource: {} as Window,
        frameWindow
      })
    ).toBe(false)
  })

  it('默认不保留隐藏 webview context，显式配置后保留', () => {
    expect(shouldRetainExtensionPanelContext(htmlPanel)).toBe(false)
    expect(
      shouldRetainExtensionPanelContext({
        ...htmlPanel,
        retainContextWhenHidden: true
      })
    ).toBe(true)
  })

  it('给 HTML panel 注入 piPanel helper', () => {
    const injected = injectPiPanelHelper(
      '<html><head><title>x</title></head><body></body></html>',
      'nonce-a',
      '{"count":1}'
    )
    expect(injected).toContain("window, 'piPanel'")
    expect(injected).toContain('data-pi-panel-helper="true"')
    expect(injected).toContain('nonce="nonce-a"')
    expect(injected).toContain('const initialStateJson = "{\\"count\\":1}"')
    expect(injected).toContain('panelState = JSON.parse(initialStateJson)')
    expect(injected.indexOf('piPanel')).toBeLessThan(injected.indexOf('<title>x</title>'))
    expect(injected).toContain('getState()')
    expect(injected).toContain('setState(state)')
    expect(injected).toContain("type: 'pi:webview.state'")
    expect(injected).toContain("event.data.type === 'pi:webview.restoreState'")

    const plain = injectPiPanelHelper('<h1>Panel</h1>', 'nonce-b')
    expect(plain).toContain("window, 'piPanel'")
    expect(plain).toContain('data-pi-panel-helper="true"')
    expect(plain).toContain('nonce="nonce-b"')
    expect(plain).toContain('<h1>Panel</h1>')
  })

  it('给 HTML panel 注入 host 默认样式', () => {
    const injected = injectExtensionPanelHostStyles(
      '<html><head><link rel="stylesheet" href="./panel.css"></head><body></body></html>'
    )
    expect(injected).toContain('data-pi-panel-host-style="true"')
    expect(injected).toContain('data-pi-panel-theme-style="true"')
    expect(injected).toContain('--pi-panel-bg:')
    expect(injected).toContain('--vscode-editor-background: var(--pi-panel-bg)')
    expect(injected).toContain('scrollbar-width: thin')
    expect(injected.indexOf('data-pi-panel-host-style')).toBeLessThan(
      injected.indexOf('<link rel="stylesheet"')
    )
    expect(injectExtensionPanelHostStyles(injected)).toBe(injected)

    const plain = injectExtensionPanelHostStyles('<h1>Panel</h1>')
    expect(plain).toContain('data-pi-panel-host-style="true"')
    expect(plain).toContain('<h1>Panel</h1>')
  })

  it('给 HTML panel 注入 CSP 和脚本 nonce', () => {
    const html = '<html><head></head><body><script>window.app = true</script></body></html>'
    const withNonce = injectExtensionPanelScriptNonces(html, 'nonce-a')

    expect(withNonce).toContain('<script nonce="nonce-a">window.app = true</script>')
    expect(injectExtensionPanelScriptNonces(withNonce, 'nonce-b')).toContain(
      '<script nonce="nonce-b">window.app = true</script>'
    )

    const withCsp = injectExtensionPanelCsp(withNonce, 'nonce-a')
    expect(withCsp).toContain('data-pi-panel-csp="true"')
    expect(withCsp).toContain("default-src 'none'")
    expect(withCsp).toContain("style-src 'unsafe-inline' pi-webview-resource:")
    expect(withCsp).toContain("script-src 'nonce-nonce-a' pi-webview-resource:")
    expect(withCsp).toContain('connect-src pi-webview-resource: https: http:')
    expect(withCsp).toContain("base-uri 'none'")
    expect(withCsp).toContain("form-action 'none'")
    expect(withCsp).not.toContain('navigate-to')
  })

  it('准备 srcdoc HTML 时按脚本权限注入 helper 和 CSP', () => {
    const withoutScripts = prepareExtensionPanelHtml({
      ...htmlPanel,
      source: { type: 'html', html: '<html><head></head><body></body></html>' }
    })
    expect(withoutScripts).toContain('data-pi-panel-host-style="true"')
    expect(withoutScripts).not.toContain('data-pi-panel-helper="true"')
    expect(withoutScripts).not.toContain('data-pi-panel-csp="true"')

    const injected = prepareExtensionPanelHtml({
      ...htmlPanel,
      source: {
        type: 'html',
        html: '<html><head></head><body><script>window.app = true</script></body></html>',
        permissions: { enableScripts: true }
      }
    })
    expect(injected).toContain('data-pi-panel-host-style="true"')
    expect(injected).toContain('data-pi-panel-helper="true"')
    expect(injected).toContain('data-pi-panel-csp="true"')
    expect(injected).toContain("script-src 'nonce-theme-init'")
    expect(injected).toContain('<script nonce="theme-init">window.app = true</script>')
  })

  it('业务 HTML 引用 window.piPanel 时仍然注入 helper', () => {
    const html =
      '<html><head></head><body><script>window.piPanel.post({ type: "ping" })</script></body></html>'
    const injected = injectPiPanelHelper(html, 'nonce-a')

    expect(injected).not.toBe(html)
    expect(injected).toContain('data-pi-panel-helper="true"')
    expect(injected).toContain('window.piPanel.post')
  })

  it('识别 host-reserved webview state 消息并构造恢复消息', () => {
    expect(isExtensionPanelStatePayload({ type: 'pi:webview.state', state: { count: 1 } })).toBe(
      true
    )
    expect(isExtensionPanelStatePayload({ type: 'pi:webview.state' })).toBe(false)
    expect(isExtensionPanelStatePayload({ type: 'ping', state: { count: 1 } })).toBe(false)
    expect(createExtensionPanelStateRestorePayload({ count: 2 })).toEqual({
      type: 'pi:webview.restoreState',
      state: { count: 2 }
    })
  })

  it('识别 host-reserved openExternal 消息并注入 helper API', () => {
    expect(
      isExtensionPanelOpenExternalPayload({
        type: 'pi:webview.openExternal',
        uri: 'https://example.com'
      })
    ).toBe(true)
    expect(isExtensionPanelOpenExternalPayload({ type: 'pi:webview.openExternal' })).toBe(false)
    expect(isExtensionPanelOpenExternalPayload({ type: 'ping', uri: 'https://example.com' })).toBe(
      false
    )

    const injected = injectPiPanelHelper('<html><head></head><body></body></html>', 'nonce-a')
    expect(injected).toContain('openExternal(uri)')
    expect(injected).toContain("type: 'pi:webview.openExternal'")
    expect(injected).toContain("document.addEventListener('click'")
    expect(injected).toContain("event.target.closest('a[href]')")
  })

  it('只接受 JSON 可序列化且大小受限的 webview state', () => {
    expect(cloneExtensionPanelStateForHost({ count: 1 })).toEqual({
      ok: true,
      value: { count: 1 }
    })
    expect(cloneExtensionPanelStateForHost(undefined)).toEqual({ ok: false, reason: 'not-json' })

    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(cloneExtensionPanelStateForHost(circular)).toEqual({ ok: false, reason: 'not-json' })
    expect(cloneExtensionPanelStateForHost({ text: 'abcdef' }, 8)).toEqual({
      ok: false,
      reason: 'too-large'
    })
    expect(serializeExtensionPanelStateForInjection({ count: 1 })).toBe('{"count":1}')
    expect(serializeExtensionPanelStateForInjection(undefined)).toBeUndefined()
  })

  it('准备 srcdoc HTML 时可注入同步可读的初始 webview state', () => {
    const injected = prepareExtensionPanelHtml(
      {
        ...htmlPanel,
        source: {
          type: 'html',
          html: '<html><head></head><body><script>window.restored = window.piPanel.getState()</script></body></html>',
          permissions: { enableScripts: true }
        }
      },
      undefined,
      { selectedId: 'deploy-prod' }
    )

    expect(injected).toContain('const initialStateJson = "{\\"selectedId\\":\\"deploy-prod\\"}"')
    expect(injected.indexOf('panelState = JSON.parse(initialStateJson)')).toBeLessThan(
      injected.indexOf('window.restored = window.piPanel.getState()')
    )
  })

  it('注入初始 webview state 时转义 script 结束标签', () => {
    const injected = prepareExtensionPanelHtml(
      {
        ...htmlPanel,
        source: {
          type: 'html',
          html: '<html><head></head><body></body></html>',
          permissions: { enableScripts: true }
        }
      },
      undefined,
      { text: '</script><script>window.evil = true</script>' }
    )

    expect(injected).not.toContain('</script><script>window.evil')
    expect(injected).toContain('\\u003c/script>\\u003cscript>window.evil = true\\u003c/script>')
  })
})
