/**
 * 本文件启动 Electron main 进程并注册 desktop 后端能力。
 */

import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import windowStateKeeper from 'electron-window-state'
import icon from '../../resources/icon.png?asset'
import { installCodingAgentPackageDirEnv } from './coding-agent/coding-agent-package-dir'
import { registerDeferredCodingAgentIpc } from './coding-agent/deferred-ipc'
// import { installIpcLogger } from 'electron-ipc-logger'

const defaultWindowBounds = {
  width: 1920,
  height: 1080
}
const initialRendererHash = '/new'

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
function createWindow(): void {
  const mainWindowState = windowStateKeeper({
    defaultWidth: defaultWindowBounds.width,
    defaultHeight: defaultWindowBounds.height
  })

  const mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
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

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const rendererUrl = new URL(process.env['ELECTRON_RENDERER_URL'])
    rendererUrl.hash = initialRendererHash
    mainWindow.loadURL(rendererUrl.toString())
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: initialRendererHash })
  }
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

  createWindow()
  registerDeferredCodingAgentIpc()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
