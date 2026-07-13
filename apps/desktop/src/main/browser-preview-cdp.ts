import type { Debugger, Event } from 'electron'
import type {
  BrowserPreviewCdpEvent,
  BrowserPreviewCdpEventsResult
} from '../shared/browser-preview'
import type { BrowserCdpAccessMode } from '../shared/coding-agent/types'

type BrowserPreviewDebugger = Pick<
  Debugger,
  'attach' | 'detach' | 'isAttached' | 'off' | 'on' | 'sendCommand'
>

type CdpMessageListener = (event: Event, method: string, params: unknown, sessionId: string) => void

type BrowserPreviewCdpState = {
  accessMode: BrowserCdpAccessMode
  bufferedBytes: number
  debugger: BrowserPreviewDebugger
  dropped: number
  eventSizes: number[]
  events: BrowserPreviewCdpEvent[]
  listener: CdpMessageListener
  sequence: number
}

const DEFAULT_MAX_BUFFERED_EVENTS = 1000
const DEFAULT_MAX_EVENT_BYTES = 256 * 1024
const DEFAULT_MAX_BUFFERED_BYTES = 4 * 1024 * 1024
const DEFAULT_READ_LIMIT = 200
const DEFAULT_MAX_COMMAND_INPUT_BYTES = 256 * 1024
const DEFAULT_MAX_COMMAND_RESPONSE_BYTES = 256 * 1024
const DEFAULT_MAX_READ_BYTES = 512 * 1024
const MAX_CDP_METHOD_LENGTH = 128
const MAX_CDP_SESSION_ID_LENGTH = 128

const SAFE_CDP_METHODS = new Set([
  'Accessibility.disable',
  'Accessibility.enable',
  'Accessibility.getPartialAXTree',
  'CSS.disable',
  'CSS.enable',
  'CSS.getComputedStyleForNode',
  'DOM.describeNode',
  'DOM.disable',
  'DOM.enable',
  'DOM.getAttributes',
  'DOM.getBoxModel',
  'DOM.getDocument',
  'DOM.querySelector',
  'DOM.scrollIntoView',
  'Log.clear',
  'Log.disable',
  'Log.enable',
  'Page.getFrameTree',
  'Page.getLayoutMetrics',
  'Performance.disable',
  'Performance.enable',
  'Performance.getMetrics'
])
const SAFE_CDP_EVENT_DOMAINS = new Set([
  'Accessibility',
  'CSS',
  'DOM',
  'Log',
  'Page',
  'Performance'
])

/** Browser Preview CDP controller with settings-driven capability and resource boundaries. */
export class BrowserPreviewCdpController {
  private readonly stateByWebContentsId = new Map<number, BrowserPreviewCdpState>()

  constructor(
    private readonly maxBufferedEvents = DEFAULT_MAX_BUFFERED_EVENTS,
    private readonly maxEventBytes = DEFAULT_MAX_EVENT_BYTES,
    private readonly maxBufferedBytes = DEFAULT_MAX_BUFFERED_BYTES,
    private readonly maxCommandInputBytes = DEFAULT_MAX_COMMAND_INPUT_BYTES,
    private readonly maxCommandResponseBytes = DEFAULT_MAX_COMMAND_RESPONSE_BYTES,
    private readonly maxReadBytes = DEFAULT_MAX_READ_BYTES
  ) {}

  register(
    webContentsId: number,
    targetDebugger: BrowserPreviewDebugger,
    accessMode: BrowserCdpAccessMode = 'safe'
  ): void {
    const current = this.stateByWebContentsId.get(webContentsId)
    if (current?.debugger === targetDebugger) {
      this.updateAccessMode(current, accessMode)
      return
    }
    if (current) current.debugger.off('message', current.listener)

    const state: BrowserPreviewCdpState = {
      accessMode,
      bufferedBytes: 0,
      debugger: targetDebugger,
      dropped: 0,
      eventSizes: [],
      events: [],
      listener: () => undefined,
      sequence: 0
    }
    state.listener = (_event, method, params, sessionId) => {
      state.sequence += 1
      if (!isCdpEventAllowed(state.accessMode, method, sessionId)) {
        state.dropped += 1
        return
      }
      const protocolEvent: BrowserPreviewCdpEvent = {
        sequence: state.sequence,
        method,
        params,
        receivedAt: new Date().toISOString(),
        ...(sessionId ? { sessionId } : {})
      }
      const eventBytes = estimateValueBytes(protocolEvent, this.maxEventBytes)
      if (eventBytes > this.maxEventBytes) {
        state.dropped += 1
        return
      }
      state.events.push(protocolEvent)
      state.eventSizes.push(eventBytes)
      state.bufferedBytes += eventBytes
      while (
        state.events.length > this.maxBufferedEvents ||
        state.bufferedBytes > this.maxBufferedBytes
      ) {
        state.events.shift()
        state.bufferedBytes -= state.eventSizes.shift() ?? 0
        state.dropped += 1
      }
    }
    targetDebugger.on('message', state.listener)
    this.stateByWebContentsId.set(webContentsId, state)
  }

  remove(webContentsId: number): void {
    const state = this.stateByWebContentsId.get(webContentsId)
    if (!state) return
    state.debugger.off('message', state.listener)
    this.stateByWebContentsId.delete(webContentsId)
  }

  updateAllAccessModes(accessMode: BrowserCdpAccessMode): void {
    for (const state of this.stateByWebContentsId.values()) {
      this.updateAccessMode(state, accessMode)
    }
  }

  async sendCommand(
    webContentsId: number,
    targetDebugger: BrowserPreviewDebugger,
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    accessMode: BrowserCdpAccessMode = 'safe'
  ): Promise<unknown> {
    this.register(webContentsId, targetDebugger, accessMode)
    assertCdpCommandAllowed(accessMode, method, params, sessionId)
    if (estimateValueBytes(params, this.maxCommandInputBytes) > this.maxCommandInputBytes) {
      throw new Error('Browser CDP command parameters exceed the byte budget')
    }
    if (!targetDebugger.isAttached()) {
      try {
        targetDebugger.attach('1.3')
      } catch {
        throw new Error('Close Browser DevTools before using CDP')
      }
    }
    const response = await targetDebugger.sendCommand(method.trim(), params, sessionId)
    if (estimateValueBytes(response, this.maxCommandResponseBytes) > this.maxCommandResponseBytes) {
      throw new Error('Browser CDP response exceeds the byte budget')
    }
    return response
  }

  readEvents(
    webContentsId: number,
    options: { clear?: boolean; limit?: number } = {},
    accessMode: BrowserCdpAccessMode = 'safe'
  ): BrowserPreviewCdpEventsResult {
    const state = this.stateByWebContentsId.get(webContentsId)
    if (!state) return { events: [], buffered: 0, dropped: 0 }
    this.updateAccessMode(state, accessMode)

    const limit = options.limit ?? DEFAULT_READ_LIMIT
    const requestedStart = Math.max(0, state.events.length - limit)
    let selectedStart = state.events.length
    let selectedBytes = 0
    for (let index = state.events.length - 1; index >= requestedStart; index -= 1) {
      const eventBytes = state.eventSizes[index] ?? 0
      if (selectedBytes + eventBytes > this.maxReadBytes) break
      selectedBytes += eventBytes
      selectedStart = index
    }
    const events = state.events.slice(selectedStart)
    const result = {
      events,
      buffered: state.events.length,
      dropped: state.dropped,
      ...(selectedStart > requestedStart ? { truncated: true } : {})
    }
    if (options.clear) {
      state.events.length = 0
      state.eventSizes.length = 0
      state.bufferedBytes = 0
      state.dropped = 0
    }
    return result
  }

  private updateAccessMode(state: BrowserPreviewCdpState, accessMode: BrowserCdpAccessMode): void {
    const leavingFullAccess = state.accessMode === 'full' && accessMode !== 'full'
    const disablingAccess = state.accessMode !== 'disabled' && accessMode === 'disabled'
    state.accessMode = accessMode
    if (accessMode === 'full') return

    if ((leavingFullAccess || disablingAccess) && state.debugger.isAttached()) {
      try {
        state.debugger.detach()
      } catch {
        // Event and command filtering below still enforce the downgraded boundary.
      }
    }

    if (leavingFullAccess) {
      state.dropped += state.events.length
      state.events.length = 0
      state.eventSizes.length = 0
      state.bufferedBytes = 0
      return
    }

    const retainedEvents: BrowserPreviewCdpEvent[] = []
    const retainedSizes: number[] = []
    let retainedBytes = 0
    for (let index = 0; index < state.events.length; index += 1) {
      const event = state.events[index]!
      if (!isCdpEventAllowed(accessMode, event.method, event.sessionId)) {
        state.dropped += 1
        continue
      }
      retainedEvents.push(event)
      const eventBytes = state.eventSizes[index] ?? 0
      retainedSizes.push(eventBytes)
      retainedBytes += eventBytes
    }
    state.events = retainedEvents
    state.eventSizes = retainedSizes
    state.bufferedBytes = retainedBytes
  }
}

function assertCdpCommandAllowed(
  accessMode: BrowserCdpAccessMode,
  method: string,
  params: Record<string, unknown> | undefined,
  sessionId: string | undefined
): void {
  const normalizedMethod = method.trim()
  if (!normalizedMethod) {
    throw new Error('Invalid Browser CDP method')
  }
  if (accessMode === 'disabled') {
    throw new Error('Browser CDP is disabled in Settings')
  }
  if (accessMode === 'full') return
  if (normalizedMethod.length > MAX_CDP_METHOD_LENGTH) {
    throw new Error('Invalid Browser CDP method')
  }
  if (sessionId && sessionId.length > MAX_CDP_SESSION_ID_LENGTH) {
    throw new Error('Invalid Browser CDP session ID')
  }
  if (sessionId) {
    throw new Error('Child CDP sessions require full access in Settings')
  }
  if (!SAFE_CDP_METHODS.has(normalizedMethod)) {
    throw new Error(`Browser CDP method requires full access in Settings: ${normalizedMethod}`)
  }
  assertSafeCdpParams(normalizedMethod, params)
}

function assertSafeCdpParams(method: string, params: Record<string, unknown> | undefined): void {
  if (method === 'DOM.getDocument' || method === 'DOM.describeNode') {
    const depth = params?.depth
    if (
      depth !== undefined &&
      (!Number.isInteger(depth) || Number(depth) < 0 || Number(depth) > 2)
    ) {
      throw new Error(`${method} depth requires full access when outside 0..2`)
    }
    if (params?.pierce === true) {
      throw new Error(`${method} pierce requires full access in Settings`)
    }
  }
  if (method === 'Accessibility.getPartialAXTree' && params?.fetchRelatives === true) {
    throw new Error(
      'Accessibility.getPartialAXTree fetchRelatives requires full access in Settings'
    )
  }
}

function isCdpEventAllowed(
  accessMode: BrowserCdpAccessMode,
  method: string,
  sessionId?: string
): boolean {
  if (accessMode === 'full') return true
  if (accessMode === 'disabled') return false
  return !sessionId && SAFE_CDP_EVENT_DOMAINS.has(method.split('.', 1)[0] ?? '')
}

function estimateValueBytes(value: unknown, limit: number): number {
  const pending: unknown[] = [value]
  const seen = new WeakSet<object>()
  let bytes = 0
  const add = (amount: number): boolean => {
    bytes += amount
    return bytes <= limit
  }

  while (pending.length > 0 && bytes <= limit) {
    const item = pending.pop()
    if (typeof item === 'string') {
      add(Buffer.byteLength(item, 'utf8') + 8)
      continue
    }
    if (
      item === null ||
      item === undefined ||
      typeof item === 'number' ||
      typeof item === 'boolean'
    ) {
      add(16)
      continue
    }
    if (typeof item === 'bigint' || typeof item === 'symbol' || typeof item === 'function') {
      add(Buffer.byteLength(String(item), 'utf8') + 16)
      continue
    }
    if (seen.has(item)) {
      add(8)
      continue
    }
    seen.add(item)
    if (item instanceof ArrayBuffer) {
      add(item.byteLength + 16)
      continue
    }
    if (ArrayBuffer.isView(item)) {
      add(item.byteLength + 16)
      continue
    }
    add(16)
    for (const key in item) {
      if (!Object.hasOwn(item, key)) continue
      if (!add(Buffer.byteLength(key, 'utf8') + 8)) break
      pending.push((item as Record<string, unknown>)[key])
    }
  }
  return bytes
}
