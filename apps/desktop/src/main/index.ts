/**
 * 本文件启动 Electron main 进程并注册 desktop 后端能力。
 */

import { app, shell, BrowserWindow, ipcMain } from 'electron'
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
import { createMainWindowNavigationTarget, isMainWindowNavigationAllowed } from './window-security'
import { setupAutoUpdater } from './updater'
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
      sandbox: false
    }
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
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
