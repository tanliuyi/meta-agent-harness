/** IPC contract for host-controlled Browser preview navigation and device emulation. */

// Product requirement: Browser behaves like a shared browser profile so users stay signed in
// across projects and agent sessions instead of authenticating repeatedly.
export const browserPreviewPartition = 'persist:browser-preview'
const MAX_BROWSER_PREVIEW_USER_AGENT_LENGTH = 512
const MAX_BROWSER_PREVIEW_PLATFORM_LENGTH = 128

export const browserPreviewChannels = {
  navigate: 'browser-preview:navigate',
  setEmulation: 'browser-preview:set-emulation',
  sendCdpCommand: 'browser-preview:send-cdp-command',
  readCdpEvents: 'browser-preview:read-cdp-events',
  openRequested: 'browser-preview:open-requested',
  permissionRequested: 'browser-preview:permission-requested',
  respondPermission: 'browser-preview:respond-permission'
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

export interface BrowserPreviewCdpCommandInput {
  webContentsId: number
  method: string
  params?: Record<string, unknown>
  sessionId?: string
}

export interface BrowserPreviewReadCdpEventsInput {
  webContentsId: number
  clear?: boolean
  limit?: number
}

export interface BrowserPreviewCdpEvent {
  sequence: number
  method: string
  params: unknown
  sessionId?: string
  receivedAt: string
}

export interface BrowserPreviewCdpEventsResult {
  events: BrowserPreviewCdpEvent[]
  buffered: number
  dropped: number
  /** 本次读取因响应字节预算未返回全部请求事件。 */
  truncated?: boolean
}

export interface BrowserPreviewOpenRequest {
  openerWebContentsId: number
  url: string
  disposition: string
}

export interface BrowserPreviewPermissionRequest {
  requestId: string
  origin: string
  permission: string
}

export interface BrowserPreviewPermissionResponse {
  requestId: string
  allow: boolean
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
    (input.userAgent !== undefined &&
      (typeof input.userAgent !== 'string' ||
        input.userAgent.length > MAX_BROWSER_PREVIEW_USER_AGENT_LENGTH)) ||
    (input.platform !== undefined &&
      (typeof input.platform !== 'string' ||
        input.platform.length > MAX_BROWSER_PREVIEW_PLATFORM_LENGTH))
  ) {
    throw new Error('Invalid browser device emulation')
  }
  return input as BrowserPreviewDeviceEmulation
}

export interface BrowserPreviewApi {
  navigate: (input: BrowserPreviewNavigateInput) => Promise<void>
  setEmulation: (input: BrowserPreviewSetEmulationInput) => Promise<void>
  sendCdpCommand: (input: BrowserPreviewCdpCommandInput) => Promise<unknown>
  readCdpEvents: (input: BrowserPreviewReadCdpEventsInput) => Promise<BrowserPreviewCdpEventsResult>
  onOpenRequested: (listener: (request: BrowserPreviewOpenRequest) => void) => () => void
  onPermissionRequested: (
    listener: (request: BrowserPreviewPermissionRequest) => void
  ) => () => void
  respondPermission: (input: BrowserPreviewPermissionResponse) => Promise<void>
}
