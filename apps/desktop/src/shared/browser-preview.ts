/** IPC contract for host-controlled Browser preview navigation and device emulation. */

export const browserPreviewChannels = {
  navigate: 'browser-preview:navigate',
  setEmulation: 'browser-preview:set-emulation',
  openRequested: 'browser-preview:open-requested'
} as const

export interface BrowserPreviewNavigateInput {
  webContentsId: number
  url: string
}

export interface BrowserPreviewDeviceEmulation {
  enabled: boolean
  width: number
  height: number
  deviceScaleFactor: number
  mobile: boolean
  touch: boolean
  userAgent?: string
  platform?: string
  orientation: 'portrait' | 'landscape'
}

export interface BrowserPreviewSetEmulationInput {
  webContentsId: number
  emulation: BrowserPreviewDeviceEmulation
}

export interface BrowserPreviewOpenRequest {
  openerWebContentsId: number
  url: string
  disposition: string
}

/** Validate untrusted IPC device metrics before forwarding them to CDP. */
export function validateBrowserPreviewEmulation(value: unknown): BrowserPreviewDeviceEmulation {
  const input = value as Partial<BrowserPreviewDeviceEmulation> | undefined
  if (
    !input ||
    typeof input.enabled !== 'boolean' ||
    !Number.isInteger(input.width) ||
    input.width! < 240 ||
    input.width! > 2560 ||
    !Number.isInteger(input.height) ||
    input.height! < 240 ||
    input.height! > 2560 ||
    !Number.isFinite(input.deviceScaleFactor) ||
    input.deviceScaleFactor! < 0.5 ||
    input.deviceScaleFactor! > 4 ||
    typeof input.mobile !== 'boolean' ||
    typeof input.touch !== 'boolean' ||
    (input.orientation !== 'portrait' && input.orientation !== 'landscape') ||
    (input.userAgent !== undefined && typeof input.userAgent !== 'string') ||
    (input.platform !== undefined && typeof input.platform !== 'string')
  ) {
    throw new Error('Invalid browser device emulation')
  }
  return input as BrowserPreviewDeviceEmulation
}

export interface BrowserPreviewApi {
  navigate: (input: BrowserPreviewNavigateInput) => Promise<void>
  setEmulation: (input: BrowserPreviewSetEmulationInput) => Promise<void>
  onOpenRequested: (listener: (request: BrowserPreviewOpenRequest) => void) => () => void
}
