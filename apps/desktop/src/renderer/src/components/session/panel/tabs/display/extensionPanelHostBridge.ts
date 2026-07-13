import type { DesktopExtensionWebviewPanel } from '@shared/coding-agent/types'
import {
  cloneExtensionPanelStateForHost,
  createExtensionPanelStateRestorePayload,
  getExtensionPanelTargetOrigin,
  isExtensionPanelOpenExternalPayload,
  isExtensionPanelStatePayload,
  shouldAcceptExtensionPanelMessage,
  type ExtensionPanelThemePayload
} from './extensionPanelDisplay'

export type ExtensionPanelMessageProjection = {
  sequence: number
  message: unknown
}

export type ExtensionPanelViewStateEvent = {
  type: 'viewStateChanged'
  panelId: string
  visible: boolean
  active: boolean
}

export type ExtensionPanelHostMessageResult =
  'ignored' | 'state-updated' | 'state-rejected' | 'open-external' | 'forwarded'

export function cloneExtensionPanelMessage(message: unknown): unknown {
  try {
    return structuredClone(message)
  } catch {
    return JSON.parse(JSON.stringify(message))
  }
}

export function postExtensionPanelPayload(input: {
  target: Pick<Window, 'postMessage'> | null | undefined
  panel: DesktopExtensionWebviewPanel | undefined
  navigationBlocked: boolean
  payload: unknown
  unrestrictedUrlAccess?: boolean
}): boolean {
  if (!input.target || !input.panel || input.navigationBlocked) {
    return false
  }
  input.target.postMessage(
    cloneExtensionPanelMessage(input.payload),
    getExtensionPanelTargetOrigin(input.panel, input.unrestrictedUrlAccess)
  )
  return true
}

export function postExtensionPanelMessage(input: {
  target: Pick<Window, 'postMessage'> | null | undefined
  panel: DesktopExtensionWebviewPanel | undefined
  navigationBlocked: boolean
  message: ExtensionPanelMessageProjection | undefined
  unrestrictedUrlAccess?: boolean
}): boolean {
  if (input.message === undefined) {
    return false
  }
  return postExtensionPanelPayload({
    target: input.target,
    panel: input.panel,
    navigationBlocked: input.navigationBlocked,
    payload: input.message.message,
    unrestrictedUrlAccess: input.unrestrictedUrlAccess
  })
}

export function postExtensionPanelState(input: {
  target: Pick<Window, 'postMessage'> | null | undefined
  panel: DesktopExtensionWebviewPanel | undefined
  navigationBlocked: boolean
  state: unknown
  unrestrictedUrlAccess?: boolean
}): boolean {
  if (input.state === undefined) {
    return false
  }
  return postExtensionPanelPayload({
    target: input.target,
    panel: input.panel,
    navigationBlocked: input.navigationBlocked,
    payload: createExtensionPanelStateRestorePayload(input.state),
    unrestrictedUrlAccess: input.unrestrictedUrlAccess
  })
}

export function postExtensionPanelTheme(input: {
  target: Pick<Window, 'postMessage'> | null | undefined
  panel: DesktopExtensionWebviewPanel | undefined
  navigationBlocked: boolean
  theme: ExtensionPanelThemePayload
  unrestrictedUrlAccess?: boolean
}): boolean {
  return postExtensionPanelPayload({
    target: input.target,
    panel: input.panel,
    navigationBlocked: input.navigationBlocked,
    payload: input.theme,
    unrestrictedUrlAccess: input.unrestrictedUrlAccess
  })
}

export function postExtensionPanelVisibility(input: {
  target: Pick<Window, 'postMessage'> | null | undefined
  panel: DesktopExtensionWebviewPanel | undefined
  navigationBlocked: boolean
  visible: boolean
  unrestrictedUrlAccess?: boolean
}): boolean {
  return postExtensionPanelPayload({
    target: input.target,
    panel: input.panel,
    navigationBlocked: input.navigationBlocked,
    payload: { type: 'pi:webview.visibility', visible: input.visible },
    unrestrictedUrlAccess: input.unrestrictedUrlAccess
  })
}

export function getNextExtensionPanelViewState(input: {
  panelId: string | undefined
  threadId: string | undefined
  panel: DesktopExtensionWebviewPanel | undefined
  lastVisibleState: boolean | undefined
  visible: boolean
}): { nextLastVisibleState: boolean | undefined; event?: ExtensionPanelViewStateEvent } {
  if (
    !input.panelId ||
    !input.threadId ||
    !input.panel ||
    input.lastVisibleState === input.visible
  ) {
    return { nextLastVisibleState: input.lastVisibleState }
  }
  return {
    nextLastVisibleState: input.visible,
    event: {
      type: 'viewStateChanged',
      panelId: input.panelId,
      visible: input.visible,
      active: input.visible
    }
  }
}

export function handleExtensionPanelHostMessage(input: {
  panelId: string | undefined
  threadId: string | undefined
  panel: DesktopExtensionWebviewPanel | undefined
  hostActive: boolean
  navigationBlocked: boolean
  event: Pick<MessageEvent, 'origin' | 'source' | 'data'>
  frameWindow: Window | null | undefined
  unrestrictedUrlAccess?: boolean
  setPanelState: (threadId: string, panelId: string, state: unknown) => void
  openExternalUrl: (uri: string) => void
  sendPanelMessage: (threadId: string, panelId: string, message: unknown) => void
}): ExtensionPanelHostMessageResult {
  if (!input.panelId || !input.threadId || !input.hostActive || input.navigationBlocked) {
    return 'ignored'
  }
  if (
    !shouldAcceptExtensionPanelMessage({
      panel: input.panel,
      eventOrigin: input.event.origin,
      eventSource: input.event.source,
      frameWindow: input.frameWindow,
      unrestrictedUrlAccess: input.unrestrictedUrlAccess
    })
  ) {
    return 'ignored'
  }
  if (isExtensionPanelStatePayload(input.event.data)) {
    const nextState = cloneExtensionPanelStateForHost(input.event.data.state)
    if (!nextState.ok) {
      return 'state-rejected'
    }
    input.setPanelState(input.threadId, input.panelId, nextState.value)
    return 'state-updated'
  }
  if (isExtensionPanelOpenExternalPayload(input.event.data)) {
    input.openExternalUrl(input.event.data.uri)
    return 'open-external'
  }
  input.sendPanelMessage(input.threadId, input.panelId, input.event.data)
  return 'forwarded'
}
