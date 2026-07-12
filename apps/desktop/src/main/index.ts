/**
 * 本文件启动 Electron main 进程并注册 desktop 后端能力。
 */

import { app, shell, BrowserWindow, ipcMain, webContents } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import windowStateKeeper from 'electron-window-state'
import icon from '../../resources/icon.png?asset'
import { installCodingAgentPackageDirEnv } from './coding-agent/coding-agent-package-dir'
import {
  getLoadedCodingAgentManager,
  registerDeferredCodingAgentIpc
} from './coding-agent/deferred-ipc'
import {
  registerWebviewResourceProtocol,
  registerWebviewResourceScheme
} from './coding-agent/webview-resource-protocol'
import { normalizeAllowedExternalUrl } from './coding-agent/external-url'
import {
  createMainWindowNavigationTarget,
  isBrowserPreviewUrlAllowed,
  isMainWindowNavigationAllowed
} from './window-security'
import { setupAutoUpdater } from './updater'
import {
  browserPreviewChannels,
  type BrowserPreviewNavigateInput,
  type BrowserPreviewOpenRequest,
  type BrowserPreviewSetEmulationInput,
  validateBrowserPreviewEmulation
} from '../shared/browser-preview'
// import { installIpcLogger } from 'electron-ipc-logger'

const defaultWindowBounds = {
  width: 1920,
  height: 1080
}
const minimumWindowBounds = {
  width: 960,
  height: 640
}
const initialRendererHash = '/new'

registerWebviewResourceScheme()

/**
 * 为当前平台生成无边框窗口的 BrowserWindow 选项。
 * macOS 使用隐藏式标题栏保留原生交通灯按钮；Windows/Linux 使用 frameless。
 */
function getFramelessOptions(): Electron.BrowserWindowConstructorOptions {
  const isMac = process.platform === 'darwin'
  if (isMac) {
    return {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 12, y: 10 }
    }
  }
  return { frame: false }
}

/**
 * 创建并加载主渲染窗口。
 * 配置窗口尺寸、菜单栏、preload 路径及外部链接打开行为。
 */
function isMainRendererDevToolsShortcut(input: Electron.Input): boolean {
  return (
    input.type === 'keyDown' &&
    input.key.toLowerCase() === 'i' &&
    input.alt &&
    (input.meta || input.control) &&
    !input.shift
  )
}

function createWindow(): BrowserWindow {
  const mainWindowState = windowStateKeeper({
    defaultWidth: defaultWindowBounds.width,
    defaultHeight: defaultWindowBounds.height
  })

  const mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: minimumWindowBounds.width,
    minHeight: minimumWindowBounds.height,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'darwin' ? {} : { icon }),
    ...getFramelessOptions(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true
    }
  })

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (
      params.partition !== 'browser-preview' ||
      (params.src !== 'about:blank' && !isBrowserPreviewUrlAllowed(params.src))
    ) {
      event.preventDefault()
      return
    }
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
    const popupPreferences = webPreferences as Electron.WebPreferences & { disablePopups: boolean }
    popupPreferences.disablePopups = false
  })

  const browserPreviewUserAgents = new Map<number, string>()
  mainWindow.webContents.on('did-attach-webview', (_event, contents) => {
    contents.once('destroyed', () => browserPreviewUserAgents.delete(contents.id))
    contents.on('before-input-event', (event, input) => {
      if (is.dev && isMainRendererDevToolsShortcut(input)) {
        event.preventDefault()
        mainWindow.webContents.toggleDevTools()
      }
    })
    contents.setWindowOpenHandler((details) => {
      if (isBrowserPreviewUrlAllowed(details.url)) {
        const request: BrowserPreviewOpenRequest = {
          openerWebContentsId: contents.id,
          url: details.url,
          disposition: details.disposition
        }
        mainWindow.webContents.send(browserPreviewChannels.openRequested, request)
      }
      return { action: 'deny' }
    })
    const blockUnsafeNavigation = (event: Electron.Event, url: string): void => {
      if (url !== 'about:blank' && !isBrowserPreviewUrlAllowed(url)) event.preventDefault()
    }
    contents.on('will-navigate', blockUnsafeNavigation)
    contents.on('will-redirect', blockUnsafeNavigation)
  })

  const getBrowserPreviewGuest = (
    sender: Electron.WebContents,
    id: number
  ): Electron.WebContents => {
    if (sender !== mainWindow.webContents) throw new Error('Unauthorized browser preview request')
    const guest = webContents.fromId(id)
    if (
      !guest ||
      guest.getType() !== 'webview' ||
      guest.hostWebContents !== mainWindow.webContents
    ) {
      throw new Error('Browser preview guest not found')
    }
    return guest
  }
  ipcMain.removeHandler(browserPreviewChannels.navigate)
  ipcMain.handle(
    browserPreviewChannels.navigate,
    async (event, input: BrowserPreviewNavigateInput): Promise<void> => {
      if (
        !input ||
        !Number.isInteger(input.webContentsId) ||
        !isBrowserPreviewUrlAllowed(input.url)
      ) {
        throw new Error('Invalid browser navigation')
      }
      await getBrowserPreviewGuest(event.sender, input.webContentsId).loadURL(input.url)
    }
  )

  ipcMain.removeHandler(browserPreviewChannels.setEmulation)
  ipcMain.handle(
    browserPreviewChannels.setEmulation,
    async (event, input: BrowserPreviewSetEmulationInput): Promise<void> => {
      if (!input || !Number.isInteger(input.webContentsId)) {
        throw new Error('Invalid browser emulation request')
      }
      const guest = getBrowserPreviewGuest(event.sender, input.webContentsId)
      const emulation = validateBrowserPreviewEmulation(input.emulation)
      browserPreviewUserAgents.set(
        guest.id,
        browserPreviewUserAgents.get(guest.id) || guest.getUserAgent()
      )
      if (!guest.debugger.isAttached()) {
        try {
          guest.debugger.attach('1.3')
        } catch {
          throw new Error('Close Browser DevTools before changing device emulation')
        }
      }

      if (!emulation.enabled) {
        await guest.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
        await guest.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false })
        await guest.debugger.sendCommand('Emulation.setUserAgentOverride', {
          userAgent: browserPreviewUserAgents.get(guest.id) || guest.getUserAgent()
        })
        return
      }

      const landscape = emulation.orientation === 'landscape'
      await guest.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: emulation.width,
        height: emulation.height,
        deviceScaleFactor: emulation.deviceScaleFactor,
        mobile: emulation.mobile,
        screenWidth: emulation.width,
        screenHeight: emulation.height,
        screenOrientation: {
          type: landscape ? 'landscapePrimary' : 'portraitPrimary',
          angle: landscape ? 90 : 0
        }
      })
      await guest.debugger.sendCommand('Emulation.setTouchEmulationEnabled', {
        enabled: emulation.touch,
        maxTouchPoints: emulation.touch ? 5 : 1
      })
      await guest.debugger.sendCommand('Emulation.setUserAgentOverride', {
        userAgent:
          emulation.userAgent || browserPreviewUserAgents.get(guest.id) || guest.getUserAgent(),
        platform: emulation.platform
      })
    }
  )

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (is.dev && isMainRendererDevToolsShortcut(input)) {
      event.preventDefault()
      mainWindow.webContents.toggleDevTools()
      return
    }
    if (input.key === 'Alt' && !input.control && !input.meta && !input.shift) {
      event.preventDefault()
      mainWindow.setMenuBarVisibility(false)
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.setMenuBarVisibility(false)
    mainWindow.show()
  })

  mainWindowState.manage(mainWindow)

  const rendererIndexPath = join(__dirname, '../renderer/index.html')
  const devRendererUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  const navigationTarget = createMainWindowNavigationTarget({
    devRendererUrl,
    rendererIndexPath
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      void shell.openExternal(normalizeAllowedExternalUrl(details.url))
    } catch (error) {
      console.warn(
        'Blocked external window URL:',
        error instanceof Error ? error.message : String(error)
      )
    }
    return { action: 'deny' }
  })

  const preventUntrustedNavigation = (event: Electron.Event, url: string): void => {
    if (isMainWindowNavigationAllowed(url, navigationTarget)) {
      return
    }
    event.preventDefault()
    console.warn('Blocked main window navigation:', url)
  }
  mainWindow.webContents.on('will-navigate', preventUntrustedNavigation)
  mainWindow.webContents.on('will-redirect', preventUntrustedNavigation)

  if (devRendererUrl) {
    const rendererUrl = new URL(devRendererUrl)
    rendererUrl.hash = initialRendererHash
    mainWindow.loadURL(rendererUrl.toString())
  } else {
    mainWindow.loadFile(rendererIndexPath, { hash: initialRendererHash })
  }

  return mainWindow
}

/**
 * 注册窗口控制 IPC：最小化、最大化/还原、关闭、窗口状态查询。
 */
function registerWindowControlIpc(): void {
  ipcMain.handle('window:minimize', () => {
    const focused = BrowserWindow.getFocusedWindow()
    if (focused) focused.minimize()
  })

  ipcMain.handle('window:maximize', () => {
    const focused = BrowserWindow.getFocusedWindow()
    if (focused) {
      if (focused.isMaximized()) {
        focused.unmaximize()
      } else {
        focused.maximize()
      }
    }
  })

  ipcMain.handle('window:close', () => {
    const focused = BrowserWindow.getFocusedWindow()
    if (focused) focused.close()
  })

  ipcMain.handle('window:isMaximized', () => {
    const focused = BrowserWindow.getFocusedWindow()
    return focused ? focused.isMaximized() : false
  })

  ipcMain.handle('window:platform', () => process.platform)
}

app.whenReady().then(async () => {
  // await installIpcLogger({
  //   disable: !is.dev,
  //   logSize: 1000
  // })

  installCodingAgentPackageDirEnv()

  // 在 Windows 上设置应用用户模型 ID
  electronApp.setAppUserModelId('com.meta-agent.desktop')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => console.log('pong'))
  registerWindowControlIpc()
  registerWebviewResourceProtocol(getLoadedCodingAgentManager)

  createWindow()
  registerDeferredCodingAgentIpc()
  setupAutoUpdater()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
