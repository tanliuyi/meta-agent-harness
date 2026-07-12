# Extensions

Extensions are TypeScript modules that extend the desktop coding-agent runtime. They can subscribe to lifecycle events, register tools, add commands and shortcuts, and request structured UI interactions from the host.

The desktop renderer owns all visual components. Extensions must return structured data and use `ctx.ui` request methods; component factories, terminal renderers, custom message renderers, and tool render hooks are not part of the desktop-only runtime.

## Quick Start

```ts
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

export default function extension(pi: ExtensionAPI) {
  pi.on('session_start', async (_event, ctx) => {
    ctx.ui.notify('Extension loaded', 'info')
  })

  pi.on('tool_call', async (event, ctx) => {
    if (event.toolName === 'bash' && event.input.command?.includes('rm -rf')) {
      const ok = await ctx.ui.confirm('Dangerous command', 'Allow this command?')
      if (!ok) return { block: true, reason: 'Blocked by user' }
    }
  })

  pi.registerTool({
    name: 'greet',
    description: 'Greet someone by name',
    parameters: Type.Object({ name: Type.String() }),
    async execute(_id, input: { name: string }) {
      return {
        content: [{ type: 'text', text: `Hello, ${input.name}` }],
        details: { greeted: input.name }
      }
    }
  })
}
```

## Locations

Extensions can be discovered from global and project package/resource paths. Desktop hosts may also provide extension factories directly through the SDK runtime.

## Run Modes

`ctx.mode` is one of:

| Mode      | Meaning                            |
| --------- | ---------------------------------- |
| `desktop` | Desktop worker/runtime integration |
| `rpc`     | JSONL RPC over stdio               |
| `json`    | Structured non-interactive output  |
| `print`   | Plain non-interactive output       |

`ctx.hasUI` means dialog and fire-and-forget `ctx.ui` methods are available through the host transport.

## Extension UI

`ctx.ui` exposes structured requests only:

| Method                                              | Behavior                                   |
| --------------------------------------------------- | ------------------------------------------ |
| `select(title, options, opts?)`                     | Ask the host to show a selection dialog    |
| `confirm(title, message, opts?)`                    | Ask the host to show a confirmation dialog |
| `input(title, placeholder?, opts?)`                 | Ask the host to show a single-line input   |
| `editor(title, prefill?)`                           | Ask the host to show a multi-line editor   |
| `notify(message, type?)`                            | Send a notification request                |
| `setStatus(key, text)`                              | Set or clear status text                   |
| `setWidget(key, lines, options?)`                   | Compatibility no-op in desktop hosts       |
| `setTitle(title)`                                   | Request host title update                  |
| `pasteToEditor(text)`                               | Request paste into the host editor         |
| `setEditorText(text)`                               | Request editor text replacement            |
| `getEditorText()`                                   | Return the latest known host editor text   |
| `getToolsExpanded()` / `setToolsExpanded(expanded)` | Read or request tool expansion state       |

The core package does not expose TUI component factories in desktop hosts. Renderer-specific UI belongs in `apps/desktop/renderer`.

## Desktop Webview Panels

Desktop hosts expose `ctx.desktop` for custom extension tabs. These APIs are desktop-only; non-desktop hosts provide no-op implementations so extensions can remain portable.

Inline HTML is useful for small demos, but production panels should use `file` or `bundle` sources so the UI can be developed as a normal frontend app.

```ts
ctx.desktop.registerWebviewPanel('deploy', {
  viewType: 'example.deploy',
  title: 'Deploy',
  retainContextWhenHidden: false,
  source: {
    type: 'file',
    path: './webview-ui/index.html',
    localResourceRoots: ['./webview-ui'],
    permissions: { enableScripts: true }
  }
})

ctx.desktop.postPanelMessage('deploy', { type: 'state', status: 'running' })

pi.on('desktop_panel_message', (event, ctx) => {
  if (event.panelId === 'deploy') {
    ctx.desktop.postPanelMessage('deploy', { type: 'ack', message: event.message })
  }
})

pi.on('desktop_panel_view_state_changed', (event) => {
  if (event.panelId === 'deploy' && event.visible) {
    // Refresh data or resume extension-side work for this panel.
  }
})

pi.on('desktop_panel_disposed', (event) => {
  if (event.panelId === 'deploy') {
    // Release timers or other extension-side resources for this panel.
  }
})

pi.on('desktop_panel_restore', (event, ctx) => {
  if (event.viewType === 'example.deploy') {
    ctx.desktop.registerWebviewPanel(event.panelId, {
      viewType: event.viewType,
      title: 'Deploy',
      source: {
        type: 'file',
        path: './webview-ui/index.html',
        localResourceRoots: ['./webview-ui'],
        permissions: { enableScripts: true }
      }
    })
  }
})
```

Supported methods:

| Method                              | Behavior                                                          |
| ----------------------------------- | ----------------------------------------------------------------- |
| `registerWebviewPanel(id, options)` | Register or replace a desktop session-panel tab                   |
| `updateWebviewPanel(id, patch)`     | Update title, order, icon, or source for an existing panel        |
| `asWebviewUri(path, options)`       | Convert a local file path into a host-mediated URI for panel HTML |
| `postPanelMessage(id, message)`     | Send a JSON-serializable message to the panel iframe              |
| `removePanel(id)`                   | Remove the panel                                                  |

The desktop context also exposes `cspSource`, mirroring VS Code's `webview.cspSource`. Use it in custom CSP meta tags when inline HTML loads resources returned by `asWebviewUri()`:

```ts
const icon = ctx.desktop.asWebviewUri('./webview-ui/icon.svg', {
  localResourceRoots: ['./webview-ui']
})

ctx.desktop.registerWebviewPanel('secure-inline', {
  title: 'Secure Inline',
  source: {
    type: 'html',
    html: `
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${ctx.desktop.cspSource}; connect-src ${ctx.desktop.cspSource};">
      <img src="${icon}" alt="">
    `
  }
})
```

Panel sources are rendered in sandboxed iframes, not Electron `<webview>` tags. Supported sources:

| Source   | Use case                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------- |
| `html`   | Inline demo HTML or very small tools                                                               |
| `file`   | A local HTML file plus same-folder assets, similar to VS Code webview HTML loaded through the host |
| `bundle` | A built frontend app, for example `webview-ui/dist/index.html` from Vite                           |
| `url`    | Development server or trusted remote page                                                          |

`file` paths resolve relative to `basePath` when provided, otherwise the session cwd. Relative CSS, script, and media assets are resolved by the desktop host, restricted to `localResourceRoots`, registered as opaque `pi-webview-resource:` tokens, and rewritten in the final sandboxed HTML. Linked CSS and script files are served through the same resource protocol; CSS `url(...)` references and CSS/JS `sourceMappingURL` comments are rewritten as webview resource URIs too. Asset paths that start with `/` resolve against the panel root, which matches common Vite bundle output. `localResourceRoots: []` disables local resources. `bundle` works the same way, but defaults `html` to `index.html` and `localResourceRoots` to the bundle `root`.

By default, hidden webview panel iframes are destroyed when the user switches away from the tab. Set `retainContextWhenHidden: true` only when the panel must keep in-memory UI state while hidden; this matches VS Code's opt-in retention model and carries memory cost. Closing the extension panel tab disposes the panel projection and fires `desktop_panel_disposed` with `reason: 'userClosed'`.

Set `viewType` to a stable serializer key when a panel can be restored after a desktop worker restart. If omitted, the desktop host uses the panel id as the view type. On restart, old resource tokens are discarded and the host sends `desktop_panel_restore`; extensions should recreate the panel and any `asWebviewUri()` resources from that handler.

For inline HTML, use `asWebviewUri()` when referencing local assets. This mirrors VS Code's `webview.asWebviewUri()` boundary: the extension asks the host for a webview-safe URI instead of exposing `file:` paths directly. Desktop returns opaque `pi-webview-resource:` URIs backed by the main-process resource handler, so extensions should never parse or construct these URIs themselves.

```ts
const icon = ctx.desktop.asWebviewUri('./webview-ui/icon.svg', {
  localResourceRoots: ['./webview-ui']
})

ctx.desktop.registerWebviewPanel('usage-inline', {
  title: 'Usage Inline',
  source: {
    type: 'html',
    html: `<img src="${icon}" alt="">`,
    permissions: { enableScripts: false }
  }
})
```

`pi-webview-resource:` supports `GET` and `HEAD` only. The host serves registered files with an inferred `Content-Type`, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`. Invalid tokens return `404`, malformed resource URLs return `400`, and unsupported methods return `405`. These responses intentionally do not expose local filesystem paths to the renderer.

Script-enabled HTML, file, and bundle panels can also `fetch()` resources returned by `asWebviewUri()` because the injected CSP allows `connect-src pi-webview-resource:`. If an inline panel provides its own CSP, include `connect-src ${ctx.desktop.cspSource}` when loading local JSON or text assets from script.

Resource failures are also recorded in desktop diagnostics with `source: webview_resource`. Diagnostics include the status, method, reason, opaque token, and thread id when known, but never include local filesystem paths.

```ts
ctx.desktop.registerWebviewPanel('usage', {
  title: 'Usage',
  source: {
    type: 'bundle',
    root: './webview-ui/dist',
    permissions: { enableScripts: true }
  }
})
```

During frontend development, point a URL panel at a local dev server:

```ts
ctx.desktop.registerWebviewPanel('usage-dev', {
  title: 'Usage Dev',
  source: {
    type: 'url',
    url: 'http://localhost:5173',
    permissions: { enableScripts: true },
    portMapping: [{ webviewPort: 5173, extensionHostPort: actualDevServerPort }]
  }
})
```

`portMapping` follows VS Code's webview model for localhost development servers: `webviewPort` is the stable port used by the panel URL, and `extensionHostPort` is the actual localhost port. Port mappings only apply to `http:` and `https:` localhost URLs. They do not map websocket URLs. The desktop host applies mapping to URL panel entry URLs today; deeper transparent mapping for arbitrary runtime requests inside srcdoc HTML should be implemented through the controlled resource/proxy layer, not by exposing local files to the renderer.

URL panels are constrained to the resolved entry origin. The renderer uses that origin for `postMessage` target/accept checks, and same-origin readable navigations that leave it are blocked locally. Cross-origin iframe navigation cannot always be inspected from the parent document, so URL panels should treat navigation as external by design and open links through `openExternal()` or their own served page controls. Popups are disabled unless `permissions.popups` is set.

HTML, file, and bundle panels receive host default styles automatically. The host injects theme CSS variables and standard scrollbar styling before extension-authored head content, so panel CSS can still override them when needed. Extensions can also request the same base stylesheet explicitly through `asWebviewUri(desktopWebviewHostStylesheetPath)`, which is useful for inline HTML templates and URL/dev-server panels that want the same fixed scrollbar rules.

```ts
import { desktopWebviewHostStylesheetPath } from '@earendil-works/pi-coding-agent'

const hostCss = ctx.desktop.asWebviewUri(desktopWebviewHostStylesheetPath)
ctx.desktop.registerWebviewPanel('usage-inline', {
  title: 'Usage Inline',
  source: {
    type: 'html',
    html: `<link rel="stylesheet" href="${hostCss}"><main>...</main>`,
    permissions: { enableScripts: false }
  }
})
```

The stable Pi variables are:

| Variable                           | Meaning                 |
| ---------------------------------- | ----------------------- |
| `--pi-panel-bg`                    | Panel background        |
| `--pi-panel-fg`                    | Primary text            |
| `--pi-panel-muted`                 | Muted text              |
| `--pi-panel-border`                | Subtle border           |
| `--pi-panel-accent`                | Accent/action color     |
| `--pi-panel-focus-border`          | Focus ring/border color |
| `--pi-panel-danger`                | Error/destructive color |
| `--pi-panel-code-bg`               | Code block background   |
| `--pi-panel-scrollbar-thumb`       | Scrollbar thumb         |
| `--pi-panel-scrollbar-thumb-hover` | Hovered scrollbar thumb |

The host also provides VS Code-compatible aliases such as `--vscode-foreground`, `--vscode-editor-background`, `--vscode-panel-border`, `--vscode-focusBorder`, `--vscode-textCodeBlock-background`, `--vscode-scrollbarSlider-background`, and `--vscode-scrollbarSlider-hoverBackground`.

URL panels do not receive injected CSS because they are loaded as remote or dev-server documents. If a URL panel needs identical scrollbars or theme variables, serve or import the host stylesheet URI from that app and use the same variable names listed above. The stylesheet provides stable defaults; the URL app can override `--pi-panel-*` variables in its own CSS.

When `permissions.enableScripts` is true, the host also injects a small `window.piPanel` helper and a nonce-based Content Security Policy.

```js
window.piPanel.post({ type: 'cancel' })
window.piPanel.openExternal('https://example.com/docs')
const previousState = window.piPanel.getState() || { selectedItemId: undefined }
window.piPanel.setState({ selectedItemId: 'item-1' })
window.piPanel.onMessage((message) => render(message))
window.piPanel.offMessage(handler)
```

`openExternal(uri)` asks the desktop host to open a link outside the sandboxed iframe. The host only allows `http:`, `https:`, and `mailto:` URLs; `file:`, `command:`, and `javascript:` URLs are rejected. This keeps webview navigation and command execution under host control instead of relying on iframe defaults.

For script-enabled HTML, file, and bundle panels, the injected helper also intercepts normal `<a href>` clicks. Hash and same-document links keep their default behavior; `http:`, `https:`, and `mailto:` links are opened through `openExternal()`, and unsupported protocols are blocked.

`getState()` and `setState(state)` persist JSON-serializable panel state in the desktop host for the lifetime of the thread. The host rejects non-JSON values and very large state payloads. State is cached outside the iframe and replayed after renderer reloads while the desktop runtime is still alive. This mirrors VS Code's `acquireVsCodeApi().getState()` / `setState()` pattern and is the preferred way to restore UI after a hidden panel iframe is destroyed. Use `retainContextWhenHidden: true` only when state cannot be quickly saved and restored.

The host also posts visibility lifecycle messages to panels:

```js
window.piPanel.onMessage((message) => {
  if (message.type === 'pi:webview.visibility') {
    renderVisibility(message.visible)
  }
})
```

Extensions can subscribe to host-facing panel lifecycle events:

| Event                              | Behavior                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `desktop_panel_view_state_changed` | Fired when a registered panel tab becomes visible/active or hidden/inactive in the desktop session panel                          |
| `desktop_panel_disposed`           | Fired when the host disposes a panel projection, including user tab close; use it to release extension-side timers or caches      |
| `desktop_panel_restore`            | Fired after a worker restart for restorable panels; recreate the panel using `event.panelId`, `event.viewType`, and `event.state` |

When a recreated iframe has previously saved state, the host injects that state before extension-authored scripts run, so top-level code can synchronously call `window.piPanel.getState()`. The host may also send a restore lifecycle message; the injected helper applies it before user message handlers run:

```js
window.piPanel.onMessage((message) => {
  if (message.type === 'pi:webview.restoreState') {
    return
  }
})
```

The host posts theme lifecycle messages on iframe load and whenever the desktop theme changes. The injected helper updates the CSS variables automatically, but panels can listen when they need to update canvas charts or non-CSS state:

```js
window.piPanel.onMessage((message) => {
  if (message.type === 'pi:webview.theme') {
    redrawChart(message.theme, message.tokens)
  }
})
```

URL panels cannot receive injected styles or helpers; use `parent.postMessage(message, origin)` and `window.addEventListener('message', ...)` directly, and load any shared CSS from the served page.

Security behavior:

- The default sandbox has no optional capabilities.
- Scripts are disabled by default. Set `permissions.enableScripts: true` only for panels that need JavaScript.
- Optional source permissions are `enableScripts`, `forms`, `popups`, `downloads`, and `sameOrigin`.
- `sameOrigin` is honored only for URL panels; HTML/srcdoc panels never receive `allow-same-origin`.
- HTML/srcdoc panels with scripts enabled receive a nonce-based CSP and script nonces during host injection.
- URL panels only accept messages from the URL's origin.
- HTML/srcdoc panels accept messages only from their own iframe window.
- Local file and bundle assets must stay inside `localResourceRoots`.
- `pi:webview.*` messages are host-reserved lifecycle/state messages and are not forwarded to extension handlers.
- Extension and panel messages are `unknown`; use your own `{ type, id, payload }` envelope if you need request/response correlation.

See [`desktop-webview-panel.ts`](../examples/extensions/desktop-webview-panel.ts) for an inline HTML example, or [`desktop-webview-file-panel.ts`](../examples/extensions/desktop-webview-file-panel.ts) for a file-backed panel.

## Tools

Tools are registered with `pi.registerTool()`. A tool definition contains schema, prompt metadata, and an `execute()` function. Tool results should be structured:

```ts
return {
  content: [{ type: 'text', text: 'Done' }],
  details: { changedFiles: ['src/app.ts'] }
}
```

Renderer code decides how to present `content`, `details`, partial updates, errors, and tool call arguments.

## Events

Extensions can subscribe to lifecycle and agent events with `pi.on(event, handler)`. Important event groups include:

| Group          | Examples                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| Resources      | `resources_discover`                                                                                          |
| Session        | `session_start`, `session_before_switch`, `session_before_fork`, `session_before_compact`, `session_shutdown` |
| Agent turn     | `before_agent_start`, `agent_start`, `turn_start`, `message_update`, `message_end`, `turn_end`, `agent_end`   |
| Tools          | `tool_call`, `tool_result`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`             |
| Model/provider | `model_select`, `thinking_level_select`, `before_provider_request`, `after_provider_response`                 |
| Input          | `input`, `user_bash`                                                                                          |

Handlers can return documented result objects for events that support interception, such as blocking or rewriting a tool call.

## Commands And Shortcuts

Extensions can register commands and shortcuts:

```ts
pi.registerCommand('hello', {
  description: 'Say hello',
  handler: async (args, ctx) => ctx.ui.notify(args ? `Hello, ${args}` : 'Hello')
})

pi.registerShortcut('app.myExtension.hello', {
  description: 'Say hello',
  handler: async (ctx) => ctx.ui.notify('Hello')
})
```

Shortcut ids are strings. Built-in ids are documented in [keybindings.md](keybindings.md).

## State

Use session entries and extension state APIs for persistence. Custom entries should be structured JSON that the desktop host can inspect and project into snapshots.

## Desktop Boundary

Do not implement renderer UI in this package. The coding-agent package owns:

- sessions and event streams
- tool execution
- extension lifecycle and structured UI requests
- config/resource loading
- RPC/desktop worker protocols

The desktop app owns:

- visual layout
- components
- tool result presentation
- dialogs and editor UX
