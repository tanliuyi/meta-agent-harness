import { Type } from 'typebox'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

const PANEL_ID = 'browser-preview'
const REQUEST_TIMEOUT_MS = 30_000
const MAX_BROWSER_TEXT_RESULT_BYTES = 512 * 1024
const MAX_BROWSER_SCREENSHOT_RESULT_BYTES = 28 * 1024 * 1024

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type BrowserResultMessage = {
  type: 'browser.result'
  requestId: string
  ok: boolean
  value?: unknown
  error?: string
}

type BrowserTabsToolInput = {
  action: 'list' | 'open' | 'switch' | 'close'
  browserId?: string
  url?: string
  activate?: boolean
}

type BrowserPageToolInput = {
  action:
    | 'navigate'
    | 'snapshot'
    | 'inspect'
    | 'interact'
    | 'evaluate'
    | 'viewport'
    | 'logs'
    | 'screenshot'
    | 'cdp'
    | 'cdp-events'
  browserId?: string
  url?: string
  target?: string
  interaction?: 'click' | 'hover' | 'focus' | 'type' | 'press' | 'scroll'
  value?: string
  x?: number
  y?: number
  expression?: string
  preset?: 'desktop' | 'responsive' | 'iphone-se' | 'iphone-15' | 'pixel-7' | 'ipad'
  width?: number
  height?: number
  deviceScaleFactor?: number
  orientation?: 'portrait' | 'landscape'
  clear?: boolean
  method?: string
  params?: Record<string, unknown>
  sessionId?: string
  limit?: number
  offset?: number
  includeHidden?: boolean
}

export function createBrowserTextResult(value: unknown): {
  content: Array<{ type: 'text'; text: string }>
  details: unknown
} {
  if (
    estimateStructuredValueBytes(value, MAX_BROWSER_TEXT_RESULT_BYTES) >
    MAX_BROWSER_TEXT_RESULT_BYTES
  ) {
    throw new Error('Browser tool result exceeds the byte budget')
  }
  const text = typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? 'null')
  return { content: [{ type: 'text' as const, text }], details: value }
}

export function createBrowserScreenshotResult(value: unknown): {
  content: Array<{ type: 'image'; data: string; mimeType: string }>
  details: { browserId: string; url: string; title: string }
} {
  const screenshot = value as {
    browserId?: unknown
    dataUrl?: unknown
    url?: unknown
    title?: unknown
  }
  const match =
    typeof screenshot?.dataUrl === 'string' &&
    screenshot.dataUrl.length <= MAX_BROWSER_SCREENSHOT_RESULT_BYTES
      ? /^data:(image\/png);base64,(.+)$/.exec(screenshot.dataUrl)
      : null
  if (
    !match ||
    typeof screenshot.browserId !== 'string' ||
    typeof screenshot.url !== 'string' ||
    typeof screenshot.title !== 'string'
  ) {
    throw new Error('Browser returned an invalid screenshot')
  }
  return {
    content: [{ type: 'image', data: match[2], mimeType: match[1] }],
    details: {
      browserId: screenshot.browserId,
      url: screenshot.url,
      title: screenshot.title
    }
  }
}

function estimateStructuredValueBytes(value: unknown, limit: number): number {
  const pending: unknown[] = [value]
  const seen = new WeakSet<object>()
  let bytes = 0
  while (pending.length > 0 && bytes <= limit) {
    const item = pending.pop()
    if (typeof item === 'string') {
      bytes += new TextEncoder().encode(item.slice(0, limit + 1)).byteLength + 8
      continue
    }
    if (
      item === null ||
      item === undefined ||
      typeof item === 'number' ||
      typeof item === 'boolean'
    ) {
      bytes += 16
      continue
    }
    if (typeof item !== 'object') {
      bytes += 32
      continue
    }
    if (seen.has(item)) {
      bytes += 8
      continue
    }
    seen.add(item)
    if (item instanceof ArrayBuffer || ArrayBuffer.isView(item)) {
      bytes += item.byteLength + 16
      continue
    }
    bytes += 16
    for (const [key, child] of Object.entries(item)) {
      bytes += new TextEncoder().encode(key).byteLength + 8
      if (bytes > limit) break
      pending.push(child)
    }
  }
  return bytes
}

/** Built-in extension that gives the agent controlled access to the shared browser preview. */
export default function browserPreviewExtension(pi: ExtensionAPI): void {
  const pending = new Map<string, PendingRequest>()
  let desktop: ExtensionContext['desktop'] | undefined

  const registerPanel = (ctx: ExtensionContext): void => {
    desktop = ctx.desktop
    ctx.desktop.registerNativePanel(PANEL_ID, {
      viewType: 'meta.browser-preview',
      title: 'Browser',
      component: 'browser-preview',
      icon: 'globe',
      order: 15,
      retainContextWhenHidden: true
    })
  }

  const request = async (command: string, payload: unknown): Promise<unknown> => {
    if (!desktop) throw new Error('Browser preview is not available')
    const requestId = crypto.randomUUID()
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error(`Browser command timed out: ${command}`))
      }, REQUEST_TIMEOUT_MS)
      pending.set(requestId, { resolve, reject, timer })
    })
    desktop.postPanelMessage(PANEL_ID, { type: 'browser.command', requestId, command, payload })
    return response
  }

  pi.on('session_start', (_event, ctx) => registerPanel(ctx))
  pi.on('desktop_panel_restore', (event, ctx) => {
    if (event.viewType === 'meta.browser-preview') registerPanel(ctx)
  })
  pi.on('desktop_panel_message', (event) => {
    if (event.panelId !== PANEL_ID || !event.message || typeof event.message !== 'object') return
    const message = event.message as Partial<BrowserResultMessage>
    if (message.type !== 'browser.result' || typeof message.requestId !== 'string') return
    const entry = pending.get(message.requestId)
    if (!entry) return
    pending.delete(message.requestId)
    clearTimeout(entry.timer)
    if (message.ok) entry.resolve(message.value)
    else entry.reject(new Error(message.error || 'Browser command failed'))
  })
  pi.on('desktop_panel_disposed', (event) => {
    if (event.panelId !== PANEL_ID) return
    desktop = undefined
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error('Browser preview was closed'))
    }
    pending.clear()
  })

  const browserId = Type.Optional(
    Type.String({
      description: 'Browser tab ID from browser_tabs. Defaults to the active tab.'
    })
  )

  // Product requirement: keep Browser capabilities consolidated into stable domain tools so the
  // agent tool surface does not grow for every new browser operation or protocol domain.
  pi.registerTool({
    name: 'browser_tabs',
    label: 'Manage Browser tabs',
    description:
      'List, open, activate, or close Browser tabs. Prefer this tool over other browser automation only for local URLs such as localhost or 127.0.0.1.',
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal('list'),
        Type.Literal('open'),
        Type.Literal('switch'),
        Type.Literal('close')
      ]),
      browserId,
      url: Type.Optional(Type.String({ description: 'Optional HTTP(S) URL for action=open.' })),
      activate: Type.Optional(
        Type.Boolean({ description: 'For action=open, activate the new tab. Defaults to true.' })
      )
    }),
    async execute(_id, input: BrowserTabsToolInput) {
      if ((input.action === 'switch' || input.action === 'close') && !input.browserId) {
        throw new Error(`A browserId is required for action=${input.action}`)
      }
      if (input.action === 'list') return createBrowserTextResult(await request('tabs', {}))
      if (input.action === 'open') {
        return createBrowserTextResult(
          await request('open', { url: input.url, activate: input.activate })
        )
      }
      return createBrowserTextResult(await request(input.action, { browserId: input.browserId }))
    }
  })

  pi.registerTool({
    name: 'browser_page',
    label: 'Control Browser page',
    description:
      'Navigate, read a compact snapshot, inspect, interact with, capture, or run unrestricted CDP against a Browser page. Prefer this tool over other browser automation only for local URLs such as localhost or 127.0.0.1.',
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal('navigate'),
        Type.Literal('snapshot'),
        Type.Literal('inspect'),
        Type.Literal('interact'),
        Type.Literal('evaluate'),
        Type.Literal('viewport'),
        Type.Literal('logs'),
        Type.Literal('screenshot'),
        Type.Literal('cdp'),
        Type.Literal('cdp-events')
      ]),
      browserId,
      url: Type.Optional(Type.String({ description: 'HTTP(S) URL for action=navigate.' })),
      target: Type.Optional(
        Type.String({
          description: 'Element reference or CSS selector for inspect/interact/evaluate.'
        })
      ),
      interaction: Type.Optional(
        Type.Union([
          Type.Literal('click'),
          Type.Literal('hover'),
          Type.Literal('focus'),
          Type.Literal('type'),
          Type.Literal('press'),
          Type.Literal('scroll')
        ])
      ),
      value: Type.Optional(Type.String()),
      x: Type.Optional(Type.Number()),
      y: Type.Optional(Type.Number()),
      expression: Type.Optional(Type.String({ description: 'JavaScript for action=evaluate.' })),
      preset: Type.Optional(
        Type.Union([
          Type.Literal('desktop'),
          Type.Literal('responsive'),
          Type.Literal('iphone-se'),
          Type.Literal('iphone-15'),
          Type.Literal('pixel-7'),
          Type.Literal('ipad')
        ])
      ),
      width: Type.Optional(Type.Number({ minimum: 240, maximum: 2560 })),
      height: Type.Optional(Type.Number({ minimum: 240, maximum: 2560 })),
      deviceScaleFactor: Type.Optional(Type.Number({ minimum: 0.5, maximum: 4 })),
      orientation: Type.Optional(Type.Union([Type.Literal('portrait'), Type.Literal('landscape')])),
      clear: Type.Optional(Type.Boolean()),
      method: Type.Optional(
        Type.String({ description: 'Raw CDP method for action=cdp, for example Network.enable.' })
      ),
      params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      sessionId: Type.Optional(
        Type.String({
          description: 'Optional child CDP session ID returned by Target.attachToTarget.'
        })
      ),
      limit: Type.Optional(
        Type.Number({
          minimum: 1,
          maximum: 1000,
          description: 'Maximum entries for snapshot (max 200) or cdp-events (max 1000).'
        })
      ),
      offset: Type.Optional(
        Type.Number({ minimum: 0, maximum: 10000, description: 'Snapshot result offset.' })
      ),
      includeHidden: Type.Optional(
        Type.Boolean({ description: 'Include hidden elements in a snapshot. Defaults to false.' })
      )
    }),
    async execute(_id, input: BrowserPageToolInput) {
      if (input.action === 'navigate' && !input.url) {
        throw new Error('A URL is required for action=navigate')
      }
      if (input.action === 'inspect' && !input.target) {
        throw new Error('A target is required for action=inspect')
      }
      if (input.action === 'interact' && !input.interaction) {
        throw new Error('An interaction is required for action=interact')
      }
      if (input.action === 'evaluate' && input.expression === undefined) {
        throw new Error('An expression is required for action=evaluate')
      }
      if (input.action === 'cdp' && !input.method?.trim()) {
        throw new Error('A CDP method is required for action=cdp')
      }
      if (input.action === 'snapshot' && input.limit !== undefined && input.limit > 200) {
        throw new Error('Snapshot limit cannot exceed 200')
      }

      const { action, interaction, ...payload } = input
      const command = {
        navigate: 'navigate',
        snapshot: 'snapshot',
        inspect: 'inspect',
        interact: 'action',
        evaluate: 'execute-js',
        viewport: 'set-viewport',
        logs: 'logs',
        screenshot: 'screenshot',
        cdp: 'cdp',
        'cdp-events': 'cdp-events'
      }[action]
      const commandPayload = {
        ...payload,
        ...(interaction ? { action: interaction } : {})
      }
      const value = await request(command, commandPayload)
      return action === 'screenshot'
        ? createBrowserScreenshotResult(value)
        : createBrowserTextResult(value)
    }
  })
}
