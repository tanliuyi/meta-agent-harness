export const updaterChannels = {
  getState: 'updater:get-state',
  check: 'updater:check',
  download: 'updater:download',
  install: 'updater:install',
  stateChanged: 'updater:state-changed'
} as const

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'up-to-date'
  | 'error'
  | 'unsupported'

export interface UpdaterState {
  status: UpdaterStatus
  currentVersion: string
  availableVersion?: string
  releaseNotes?: string
  percent?: number
  transferred?: number
  total?: number
  error?: string
}

export interface UpdaterApi {
  getState: () => Promise<UpdaterState>
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
  onStateChanged: (listener: (state: UpdaterState) => void) => () => void
}
