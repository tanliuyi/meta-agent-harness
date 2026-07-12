import { Type } from 'typebox'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

const PANEL_ID = 'browser-preview'
const REQUEST_TIMEOUT_MS = 30_000

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

function result(value: unknown): {
  content: Array<{ type: 'text'; text: string }>
  details: unknown
} {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return { content: [{ type: 'text' as const, text }], details: value }
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
      description: 'Browser tab ID from browser_open or browser_tabs. Defaults to the active tab.'
    })
  )

  pi.registerTool({
    name: 'browser_open',
    label: 'Open browser tab',
    description: 'Open a new independent Browser tab and return its browserId.',
    parameters: Type.Object({
      url: Type.Optional(Type.String()),
      activate: Type.Optional(
        Type.Boolean({ description: 'Activate the new tab. Defaults to true.' })
      )
    }),
    async execute(_id, input: { url?: string; activate?: boolean }) {
      return result(await request('open', input))
    }
  })

  pi.registerTool({
    name: 'browser_tabs',
    label: 'List browser tabs',
    description: 'List open Browser tabs, their browserIds, URLs, titles, and active state.',
    parameters: Type.Object({}),
    async execute() {
      return result(await request('tabs', {}))
    }
  })

  pi.registerTool({
    name: 'browser_switch',
    label: 'Switch browser tab',
    description: 'Activate an existing Browser tab by browserId.',
    parameters: Type.Object({ browserId: Type.String() }),
    async execute(_id, input: { browserId: string }) {
      return result(await request('switch', input))
    }
  })

  pi.registerTool({
    name: 'browser_close',
    label: 'Close browser tab',
    description: 'Close an existing Browser tab by browserId. The final tab remains open.',
    parameters: Type.Object({ browserId: Type.String() }),
    async execute(_id, input: { browserId: string }) {
      return result(await request('close', input))
    }
  })

  pi.registerTool({
    name: 'browser_navigate',
    label: 'Open browser page',
    description: 'Open an HTTP(S) web application in a Browser tab.',
    parameters: Type.Object({ url: Type.String(), browserId }),
    async execute(_id, input: { url: string; browserId?: string }) {
      return result(await request('navigate', input))
    }
  })

  pi.registerTool({
    name: 'browser_snapshot',
    label: 'Read browser page',
    description: 'Read a page URL, title, viewport, interactive elements, and compact DOM text.',
    parameters: Type.Object({ browserId }),
    async execute(_id, input: { browserId?: string }) {
      return result(await request('snapshot', input))
    }
  })

  pi.registerTool({
    name: 'browser_inspect',
    label: 'Inspect browser element',
    description:
      'Read DOM attributes, computed styles, bounds, and accessibility data for an element reference or CSS selector.',
    parameters: Type.Object({
      target: Type.String({
        description: 'Element reference from the picker/snapshot, or a CSS selector'
      }),
      browserId
    }),
    async execute(_id, input: { target: string; browserId?: string }) {
      return result(await request('inspect', input))
    }
  })

  pi.registerTool({
    name: 'browser_action',
    label: 'Operate browser page',
    description: 'Click, hover, focus, type into, press a key on, or scroll a page element.',
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal('click'),
        Type.Literal('hover'),
        Type.Literal('focus'),
        Type.Literal('type'),
        Type.Literal('press'),
        Type.Literal('scroll')
      ]),
      target: Type.Optional(Type.String()),
      value: Type.Optional(Type.String()),
      x: Type.Optional(Type.Number()),
      y: Type.Optional(Type.Number()),
      browserId
    }),
    async execute(_id, input) {
      return result(await request('action', input))
    }
  })

  pi.registerTool({
    name: 'browser_execute_js',
    label: 'Execute browser JavaScript',
    description: 'Execute JavaScript in a Browser tab. `$0` refers to the supplied element target.',
    parameters: Type.Object({
      expression: Type.String(),
      target: Type.Optional(Type.String()),
      browserId
    }),
    async execute(_id, input: { expression: string; target?: string; browserId?: string }) {
      return result(await request('execute-js', input))
    }
  })

  pi.registerTool({
    name: 'browser_set_viewport',
    label: 'Set browser device',
    description:
      'Switch a Browser tab between desktop, responsive, iPhone, Pixel, or iPad emulation. Custom width and height use responsive mobile emulation.',
    parameters: Type.Object({
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
      browserId
    }),
    async execute(_id, input) {
      return result(await request('set-viewport', input))
    }
  })

  pi.registerTool({
    name: 'browser_logs',
    label: 'Read browser logs',
    description: 'Read console messages and page loading errors collected from a Browser tab.',
    parameters: Type.Object({ clear: Type.Optional(Type.Boolean()), browserId }),
    async execute(_id, input: { clear?: boolean; browserId?: string }) {
      return result(await request('logs', input))
    }
  })

  pi.registerTool({
    name: 'browser_screenshot',
    label: 'Capture browser screenshot',
    description: 'Capture a Browser tab viewport as a PNG data URL.',
    parameters: Type.Object({ browserId }),
    async execute(_id, input: { browserId?: string }) {
      const value = (await request('screenshot', input)) as {
        browserId: string
        dataUrl: string
        url: string
        title: string
      }
      const match = /^data:(image\/png);base64,(.+)$/.exec(value.dataUrl)
      if (!match) throw new Error('Browser returned an invalid screenshot')
      return {
        content: [{ type: 'image' as const, data: match[2], mimeType: match[1] }],
        details: { browserId: value.browserId, url: value.url, title: value.title }
      }
    }
  })
}
