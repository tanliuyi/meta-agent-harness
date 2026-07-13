import type { Session, WebContents } from 'electron'
import type { BrowserWebPermissionMode } from '../shared/coding-agent/types'

type BrowserPreviewPermissionSession = Pick<
  Session,
  'setPermissionRequestHandler' | 'setPermissionCheckHandler'
>

type BrowserPreviewPermissionWebContents = Pick<
  WebContents,
  'getType' | 'isDestroyed' | 'reload' | 'session'
>

export interface BrowserPreviewPermissionConfirmation {
  origin: string
  permission: string
}

export type ConfirmBrowserPreviewPermission = (
  request: BrowserPreviewPermissionConfirmation
) => boolean | Promise<boolean>

export interface BrowserPreviewPermissionModeChange {
  previousMode: BrowserWebPermissionMode
  mode: BrowserWebPermissionMode
  downgraded: boolean
}

export interface BrowserPreviewPermissionController {
  updateMode: (mode: BrowserWebPermissionMode) => void
}

export type OnBrowserPreviewPermissionModeChanged = (
  change: BrowserPreviewPermissionModeChange
) => void

export function reloadBrowserPreviewPermissionGuests(
  allWebContents: readonly BrowserPreviewPermissionWebContents[],
  targetSession: Session,
  onReloadError: (error: unknown) => void = () => undefined
): void {
  for (const contents of allWebContents) {
    if (
      contents.getType() !== 'webview' ||
      contents.session !== targetSession ||
      contents.isDestroyed()
    ) {
      continue
    }
    try {
      contents.reload()
    } catch (error) {
      onReloadError(error)
    }
  }
}

const MAX_PERMISSION_LENGTH = 128
const MAX_URL_LENGTH = 8 * 1024
const validPermissionPattern = /^[a-z][a-zA-Z0-9-]*$/

function containsRawUrlControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x20 || code === 0x7f) return true
  }
  return false
}

function normalizePermissionMode(value: unknown): BrowserWebPermissionMode {
  return value === 'prompt' || value === 'full' ? value : 'disabled'
}

function permissionModeRank(mode: BrowserWebPermissionMode): number {
  if (mode === 'full') return 2
  if (mode === 'prompt') return 1
  return 0
}

function normalizePermission(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_PERMISSION_LENGTH ||
    !validPermissionPattern.test(value)
  ) {
    return undefined
  }
  return value
}

function normalizeHttpOrigin(value: unknown, originOnly = false): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_URL_LENGTH ||
    containsRawUrlControl(value)
  ) {
    return undefined
  }

  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return undefined
    }
    if (originOnly && (url.pathname !== '/' || url.search.length > 0 || url.hash.length > 0)) {
      return undefined
    }
    return url.origin
  } catch {
    return undefined
  }
}

function decisionKey(origin: string, permission: string): string {
  return `${origin}\n${permission}`
}

/** Configure the permission policy for the isolated Browser Preview session. */
export function configureBrowserPreviewPermissions(
  targetSession: BrowserPreviewPermissionSession,
  initialMode: BrowserWebPermissionMode = 'disabled',
  confirmPermission: ConfirmBrowserPreviewPermission = () => false,
  onModeChanged: OnBrowserPreviewPermissionModeChanged = () => undefined
): BrowserPreviewPermissionController {
  const decisions = new Map<string, boolean>()
  const pendingDecisions = new Map<
    string,
    {
      promise: Promise<boolean>
      resolve: (decision: boolean) => void
      version: number
    }
  >()
  let mode = normalizePermissionMode(initialMode)
  let modeVersion = 0
  let confirmationQueue: Promise<void> = Promise.resolve()

  const requestDecision = (
    origin: string,
    permission: string,
    key: string,
    version: number
  ): Promise<boolean> => {
    if (decisions.has(key)) return Promise.resolve(decisions.get(key) === true)

    const existing = pendingDecisions.get(key)
    if (existing?.version === version) return existing.promise

    let resolvePending: (decision: boolean) => void = () => undefined
    const promise = new Promise<boolean>((resolve) => {
      resolvePending = resolve
    })
    const pending = { promise, resolve: resolvePending, version }
    pendingDecisions.set(key, pending)

    const runConfirmation = async (): Promise<void> => {
      if (mode !== 'prompt' || modeVersion !== version || pendingDecisions.get(key) !== pending) {
        return
      }

      let decision = false
      try {
        decision = (await confirmPermission({ origin, permission })) === true
      } catch {
        decision = false
      }

      if (mode !== 'prompt' || modeVersion !== version || pendingDecisions.get(key) !== pending) {
        return
      }
      decisions.set(key, decision)
      pendingDecisions.delete(key)
      resolvePending(decision)
    }
    confirmationQueue = confirmationQueue.then(runConfirmation, runConfirmation)

    return promise
  }

  targetSession.setPermissionRequestHandler((_webContents, permissionValue, callback, details) => {
    const permission = normalizePermission(permissionValue)
    const origin = normalizeHttpOrigin(details?.requestingUrl)
    if (!permission || !origin) {
      callback(false)
      return
    }

    if (mode !== 'prompt') {
      callback(mode === 'full')
      return
    }

    const key = decisionKey(origin, permission)
    const requestModeVersion = modeVersion
    void requestDecision(origin, permission, key, requestModeVersion).then((decision) => {
      callback(mode === 'prompt' && modeVersion === requestModeVersion && decision)
    })
  })

  targetSession.setPermissionCheckHandler((_webContents, permissionValue, requestingOrigin) => {
    const permission = normalizePermission(permissionValue)
    const origin = normalizeHttpOrigin(requestingOrigin, true)
    if (!permission || !origin) return false

    if (mode !== 'prompt') return mode === 'full'
    return decisions.get(decisionKey(origin, permission)) === true
  })

  return {
    updateMode(nextModeValue): void {
      const nextMode = normalizePermissionMode(nextModeValue)
      if (nextMode === mode) return

      const previousMode = mode
      mode = nextMode
      modeVersion += 1
      decisions.clear()
      for (const pending of pendingDecisions.values()) pending.resolve(false)
      pendingDecisions.clear()
      confirmationQueue = Promise.resolve()
      onModeChanged({
        previousMode,
        mode: nextMode,
        downgraded: permissionModeRank(nextMode) < permissionModeRank(previousMode)
      })
    }
  }
}
