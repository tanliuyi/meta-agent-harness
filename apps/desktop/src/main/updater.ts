import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { updaterChannels, type UpdaterState } from '../shared/updater'

let state: UpdaterState = {
  status: 'idle',
  currentVersion: app.getVersion()
}
let initialized = false

function serializeReleaseNotes(releaseNotes: UpdateInfo['releaseNotes']): string | undefined {
  if (typeof releaseNotes === 'string') return releaseNotes
  if (!releaseNotes) return undefined
  return releaseNotes.map((note) => `${note.version}\n${note.note ?? ''}`.trim()).join('\n\n')
}

function publishState(patch: Partial<UpdaterState>): void {
  state = { ...state, ...patch }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(updaterChannels.stateChanged, state)
    }
  }
}

function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error('Auto-update failed:', error)
  publishState({ status: 'error', error: message })
}

async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    publishState({ status: 'unsupported' })
    return
  }

  publishState({ status: 'checking', error: undefined })
  await autoUpdater.checkForUpdates()
}

export function setupAutoUpdater(): void {
  if (initialized) return
  initialized = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    autoUpdater.channel = 'latest-arm64'
  }

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    publishState({
      status: 'available',
      availableVersion: info.version,
      releaseNotes: serializeReleaseNotes(info.releaseNotes),
      error: undefined
    })
  })
  autoUpdater.on('update-not-available', () => {
    publishState({ status: 'up-to-date', availableVersion: undefined, percent: undefined })
  })
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    publishState({
      status: 'downloading',
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total
    })
  })
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    publishState({ status: 'ready', availableVersion: info.version, percent: 100 })
  })
  autoUpdater.on('error', reportError)

  ipcMain.handle(updaterChannels.getState, () => state)
  ipcMain.handle(updaterChannels.check, async () => {
    await checkForUpdates().catch(reportError)
  })
  ipcMain.handle(updaterChannels.download, async () => {
    publishState({ status: 'downloading', percent: 0, error: undefined })
    await autoUpdater.downloadUpdate().catch(reportError)
  })
  ipcMain.handle(updaterChannels.install, () => {
    setImmediate(() => autoUpdater.quitAndInstall())
  })

  if (!app.isPackaged) {
    publishState({ status: 'unsupported' })
    return
  }

  const check = (): void => {
    void checkForUpdates().catch(reportError)
  }
  setTimeout(check, 10_000)
  setInterval(check, 4 * 60 * 60 * 1000)
}
