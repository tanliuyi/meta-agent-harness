import { fileURLToPath } from 'node:url'
import {
  desktopWebviewHostStylesheetPath,
  type ExtensionAPI
} from '@earendil-works/pi-coding-agent'

const panelRoot = fileURLToPath(new URL('./desktop-webview-ui', import.meta.url))

function createPanelHtml(iconUri: string, hostStylesheetUri: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${hostStylesheetUri}" />
    <style>
      body {
        margin: 0;
        padding: 16px;
        color: var(--pi-panel-fg, var(--vscode-foreground, #111827));
        background: var(--pi-panel-bg, var(--vscode-editor-background, #fff));
        font: 14px system-ui, sans-serif;
      }
      h1 { display: flex; align-items: center; gap: 8px; }
      button {
        padding: 6px 10px;
        color: var(--pi-panel-fg, var(--vscode-foreground, #111827));
        border: 1px solid var(--pi-panel-border, var(--vscode-panel-border, #d1d5db));
        border-radius: 6px;
        background: var(--pi-panel-bg, var(--vscode-editor-background, #fff));
      }
      pre {
        padding: 12px;
        border-radius: 6px;
        background: var(--pi-panel-code-bg, var(--vscode-textCodeBlock-background, #f3f4f6));
        overflow: auto;
      }
    </style>
  </head>
  <body>
    <h1><img src="${iconUri}" alt="" width="20" height="20" /> Desktop Webview Panel</h1>
    <button id="ping">Send ping</button>
    <pre id="state">Waiting for extension state...</pre>
    <script>
      const state = document.getElementById("state");
      const savedState = window.piPanel.getState() || { localPingCount: 0 };
      window.piPanel.onMessage((message) => {
        if (
          message.type === "pi:webview.theme" ||
          message.type === "pi:webview.visibility" ||
          message.type === "pi:webview.restoreState"
        ) return;
        state.textContent = JSON.stringify({ ...message, localPingCount: savedState.localPingCount }, null, 2);
      });
      document.getElementById("ping").addEventListener("click", () => {
        savedState.localPingCount += 1;
        window.piPanel.setState(savedState);
        window.piPanel.post({ type: "ping", sentAt: new Date().toISOString() });
      });
    </script>
  </body>
</html>`
}

export default function desktopWebviewPanelExample(pi: ExtensionAPI) {
  let pingCount = 0

  pi.on('session_start', (_event, ctx) => {
    const iconUri = ctx.desktop.asWebviewUri('icon.svg', {
      basePath: panelRoot,
      localResourceRoots: [panelRoot]
    })
    const hostStylesheetUri = ctx.desktop.asWebviewUri(desktopWebviewHostStylesheetPath)
    ctx.desktop.registerWebviewPanel('desktop-webview-demo', {
      viewType: 'demo.webview',
      title: 'Webview Demo',
      order: 50,
      source: {
        type: 'html',
        html: createPanelHtml(iconUri, hostStylesheetUri),
        permissions: { enableScripts: true }
      }
    })
    ctx.desktop.postPanelMessage('desktop-webview-demo', {
      type: 'state',
      message: 'Panel registered',
      pingCount
    })
  })

  pi.on('desktop_panel_restore', (event, ctx) => {
    if (event.viewType !== 'demo.webview') return
    const iconUri = ctx.desktop.asWebviewUri('icon.svg', {
      basePath: panelRoot,
      localResourceRoots: [panelRoot]
    })
    const hostStylesheetUri = ctx.desktop.asWebviewUri(desktopWebviewHostStylesheetPath)
    ctx.desktop.registerWebviewPanel(event.panelId, {
      viewType: event.viewType,
      title: 'Webview Demo',
      order: 50,
      source: {
        type: 'html',
        html: createPanelHtml(iconUri, hostStylesheetUri),
        permissions: { enableScripts: true }
      }
    })
    ctx.desktop.postPanelMessage(event.panelId, {
      type: 'state',
      message: 'Panel restored',
      state: event.state
    })
  })

  pi.on('desktop_panel_message', (event, ctx) => {
    if (event.panelId !== 'desktop-webview-demo') return
    const message = event.message as { type?: string }
    if (message.type !== 'ping') return

    pingCount++
    ctx.desktop.postPanelMessage('desktop-webview-demo', {
      type: 'pong',
      pingCount,
      receivedAt: new Date().toISOString()
    })
  })

  pi.on('desktop_panel_view_state_changed', (event, ctx) => {
    if (event.panelId !== 'desktop-webview-demo' || !event.visible) return
    ctx.desktop.postPanelMessage('desktop-webview-demo', {
      type: 'state',
      message: 'Panel visible',
      pingCount
    })
  })
}
