/**
 * 本文件测试主窗口顶层导航 allowlist。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createMainWindowNavigationTarget,
  isBrowserPreviewUrlAllowed,
  isMainWindowNavigationAllowed
} from '../window-security'

describe('main window security', () => {
  it('dev 模式只允许 renderer dev server 同 origin 导航', () => {
    const target = createMainWindowNavigationTarget({
      devRendererUrl: 'http://localhost:5174/#/new',
      rendererIndexPath: path.join('out', 'renderer', 'index.html')
    })

    expect(isMainWindowNavigationAllowed('http://localhost:5174/#/new', target)).toBe(true)
    expect(isMainWindowNavigationAllowed('http://localhost:5174/settings', target)).toBe(true)
    expect(isMainWindowNavigationAllowed('http://127.0.0.1:5174/#/new', target)).toBe(false)
    expect(isMainWindowNavigationAllowed('https://example.com/', target)).toBe(false)
    expect(isMainWindowNavigationAllowed('file:///tmp/evil.html', target)).toBe(false)
  })

  it('生产模式只允许 renderer index 文件本身，hash 变化可通过', () => {
    const rendererIndexPath = path.resolve('out', 'renderer', 'index.html')
    const target = createMainWindowNavigationTarget({ rendererIndexPath })
    const rendererIndexUrl = pathToFileURL(rendererIndexPath).toString()

    expect(isMainWindowNavigationAllowed(`${rendererIndexUrl}#/new`, target)).toBe(true)
    expect(isMainWindowNavigationAllowed(`${rendererIndexUrl}#/settings`, target)).toBe(true)
    expect(
      isMainWindowNavigationAllowed(
        pathToFileURL(path.resolve('out', 'renderer', 'other.html')).toString(),
        target
      )
    ).toBe(false)
    expect(isMainWindowNavigationAllowed('https://example.com/', target)).toBe(false)
  })

  it('拒绝无效 dev renderer URL 协议', () => {
    expect(() =>
      createMainWindowNavigationTarget({
        devRendererUrl: 'file:///tmp/index.html',
        rendererIndexPath: path.join('out', 'renderer', 'index.html')
      })
    ).toThrow('Invalid dev renderer URL protocol')
  })

  it('浏览器预览只允许无凭据的 HTTP(S) 地址', () => {
    expect(isBrowserPreviewUrlAllowed('http://localhost:5173/app')).toBe(true)
    expect(isBrowserPreviewUrlAllowed('https://127.0.0.1:8443/')).toBe(true)
    expect(isBrowserPreviewUrlAllowed('http://[::1]:3000/')).toBe(true)
    expect(isBrowserPreviewUrlAllowed('http://user:pass@localhost:3000/')).toBe(false)
    expect(isBrowserPreviewUrlAllowed('https://example.com/')).toBe(true)
    expect(isBrowserPreviewUrlAllowed('file:///tmp/index.html')).toBe(false)
    expect(isBrowserPreviewUrlAllowed('javascript:alert(1)')).toBe(false)
    expect(isBrowserPreviewUrlAllowed('not-a-url')).toBe(false)
  })

  it('webview 生命周期绑定到当前主窗口，并将安全的新窗口请求转交 Browser tabs', () => {
    const source = readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8')
    expect(source).toContain("mainWindow.webContents.on('did-attach-webview'")
    expect(source).toContain('popupPreferences.disablePopups = false')
    expect(source).toContain('contents.setWindowOpenHandler((details) =>')
    expect(source).toContain('browserPreviewChannels.openRequested')
    expect(source).toContain("return { action: 'deny' }")
    expect(source).not.toContain("app.on('web-contents-created'")
  })

  it('仅向所属 Browser webview 按 main 配置转发 CDP 命令', () => {
    const source = readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8')
    expect(source).toContain('browserPreviewChannels.sendCdpCommand')
    expect(source).toContain('getBrowserPreviewGuest(event.sender, input.webContentsId)')
    expect(source).toContain('browserPreviewCdp.sendCommand(')
    expect(source).toContain('readDesktopRuntimeConfig().browserCdpAccess')
    expect(source).toContain('Full mode keeps the complete protocol surface')
  })

  it('完整能力由 Settings 应用内确认，不使用 Electron 原生 confirm', () => {
    const ipcSource = readFileSync(path.join(__dirname, '..', 'coding-agent', 'ipc.ts'), 'utf8')
    const safetySource = readFileSync(
      path.join(
        __dirname,
        '..',
        '..',
        'renderer',
        'src',
        'views',
        'settings',
        'agent',
        'SafetyView.vue'
      ),
      'utf8'
    )
    expect(ipcSource).not.toContain('showMessageBox')
    expect(safetySource).toContain('saveSafetyWithConfirmation')
    expect(safetySource).toContain("confirmText: '了解风险并开启'")
  })

  it('Browser 网页权限通过 renderer 工作台确认队列响应', () => {
    const source = readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8')
    expect(source).toContain('browserPreviewChannels.permissionRequested')
    expect(source).toContain('browserPreviewChannels.respondPermission')
    expect(source).toContain('requestBrowserPreviewPermission')
    expect(source).toContain('browserPermissionResponseTimeoutMs')
    expect(source).not.toContain('showMessageBox')
  })

  it('Browser 网页权限降级立即重载隔离分区 guest，升级不重载', () => {
    const source = readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8')
    expect(source).toContain('browserPreviewPermissions.updateMode(config.browserWebPermissions)')
    expect(source).toContain('if (change.downgraded)')
    expect(source).toContain('reloadBrowserPreviewPermissionGuests(')
    expect(source).toContain('webContents.getAllWebContents()')
  })

  it('限制主窗口最小尺寸，避免进入不可用布局', () => {
    const source = readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8')
    expect(source).toContain('width: 960')
    expect(source).toContain('height: 640')
    expect(source).toContain('minWidth: minimumWindowBounds.width')
    expect(source).toContain('minHeight: minimumWindowBounds.height')
  })

  it('主窗口启用 context isolation、禁用 Node integration 并进入 Chromium sandbox', () => {
    const source = readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8')
    expect(source).toContain('contextIsolation: true')
    expect(source).toContain('nodeIntegration: false')
    expect(source).toContain('sandbox: true')
    expect(source).not.toContain('sandbox: false')
  })
})
