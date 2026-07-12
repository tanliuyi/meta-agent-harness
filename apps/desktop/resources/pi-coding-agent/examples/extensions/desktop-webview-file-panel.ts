import { fileURLToPath } from 'node:url'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const panelRoot = fileURLToPath(new URL('./desktop-webview-ui', import.meta.url))

export default function desktopWebviewFilePanelExample(pi: ExtensionAPI) {
  let pingCount = 0

  pi.on('session_start', (_event, ctx) => {
    ctx.desktop.registerWebviewPanel('desktop-webview-file-demo', {
      title: 'File Panel',
      order: 55,
      source: {
        type: 'file',
        path: 'index.html',
        basePath: panelRoot,
        localResourceRoots: [panelRoot],
        permissions: { enableScripts: true }
      }
    })
    ctx.desktop.postPanelMessage('desktop-webview-file-demo', {
      type: 'state',
      message: 'File panel registered',
      pingCount
    })
  })

  pi.on('desktop_panel_message', (event, ctx) => {
    if (event.panelId !== 'desktop-webview-file-demo') return
    const message = event.message as { type?: string }
    if (message.type !== 'ping') return

    pingCount++
    ctx.desktop.postPanelMessage('desktop-webview-file-demo', {
      type: 'pong',
      pingCount,
      receivedAt: new Date().toISOString()
    })
  })
}
