import type { DesktopExtensionWebviewPanel } from '@shared/coding-agent/types'

export type ExtensionPanelResolvedTheme = 'light' | 'dark'

export type ExtensionPanelThemeTokens = {
  foreground: string
  background: string
  mutedForeground: string
  border: string
  accent: string
  focusBorder: string
  danger: string
  codeBackground: string
  scrollbarThumb: string
  scrollbarThumbHover: string
}

export type ExtensionPanelThemePayload = {
  type: 'pi:webview.theme'
  theme: ExtensionPanelResolvedTheme
  tokens: ExtensionPanelThemeTokens
}

export type ExtensionPanelStatePayload = {
  type: 'pi:webview.state'
  state: unknown
}

export type ExtensionPanelStateRestorePayload = {
  type: 'pi:webview.restoreState'
  state: unknown
}

export type ExtensionPanelOpenExternalPayload = {
  type: 'pi:webview.openExternal'
  uri: string
}

const MAX_EXTENSION_PANEL_STATE_BYTES = 256 * 1024

const DEFAULT_LIGHT_THEME_TOKENS: ExtensionPanelThemeTokens = {
  foreground: '#201f1b',
  background: '#ffffff',
  mutedForeground: '#756f64',
  border: 'rgb(32 31 27 / 11%)',
  accent: '#c44d4d',
  focusBorder: 'rgb(196 77 77 / 34%)',
  danger: '#8d2e2e',
  codeBackground: '#f6f8fa',
  scrollbarThumb: 'rgb(113 113 122 / 52%)',
  scrollbarThumbHover: 'rgb(113 113 122 / 72%)'
}

const DEFAULT_DARK_THEME_TOKENS: ExtensionPanelThemeTokens = {
  foreground: '#e8e6e3',
  background: '#161616',
  mutedForeground: '#a39d91',
  border: 'rgb(255 255 255 / 11%)',
  accent: '#d66868',
  focusBorder: 'rgb(214 104 104 / 34%)',
  danger: '#df6262',
  codeBackground: '#0d1117',
  scrollbarThumb: 'rgb(161 161 170 / 48%)',
  scrollbarThumbHover: 'rgb(161 161 170 / 68%)'
}

const PI_PANEL_HOST_STYLE_MARKER = 'data-pi-panel-host-style="true"'
const PI_PANEL_THEME_STYLE_ATTR = 'data-pi-panel-theme-style'
const PI_PANEL_THEME_STYLE_MARKER = 'data-pi-panel-theme-style="true"'
const PI_PANEL_THEME_TOKEN_STYLE_ID = 'pi-panel-theme-tokens'
const PI_PANEL_SCRIPT_NONCE = 'theme-init'
const PI_PANEL_HOST_STYLE = `
<style ${PI_PANEL_HOST_STYLE_MARKER}>
:root {
  color-scheme: light dark;
  --pi-panel-scrollbar-size: 10px;
}

* {
  scrollbar-width: thin;
  scrollbar-color: var(--pi-panel-scrollbar-thumb) transparent;
}

*::-webkit-scrollbar {
  width: var(--pi-panel-scrollbar-size);
  height: var(--pi-panel-scrollbar-size);
}

*::-webkit-scrollbar-track {
  background: transparent;
}

*::-webkit-scrollbar-thumb {
  background: var(--pi-panel-scrollbar-thumb);
  background-clip: content-box;
  border: 2px solid transparent;
  border-radius: 999px;
}

*::-webkit-scrollbar-thumb:hover {
  background: var(--pi-panel-scrollbar-thumb-hover);
  background-clip: content-box;
}
</style>
`
const PI_PANEL_CSP_MARKER = 'data-pi-panel-csp="true"'
const PI_PANEL_HELPER_MARKER = 'data-pi-panel-helper="true"'
function serializeForInlineScript(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    return 'undefined'
  }
  return serialized
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

const createPiPanelHelperScript = (nonce: string, initialStateJson?: string): string => `
<script nonce="${nonce}" ${PI_PANEL_HELPER_MARKER}>
;(() => {
  const themeStyleId = '${PI_PANEL_THEME_TOKEN_STYLE_ID}';
  const initialStateJson = ${serializeForInlineScript(initialStateJson)};
  const themeTokenMap = {
    foreground: ['--pi-panel-fg', '--vscode-foreground'],
    background: ['--pi-panel-bg', '--vscode-editor-background'],
    mutedForeground: ['--pi-panel-muted', '--vscode-descriptionForeground'],
    border: ['--pi-panel-border', '--vscode-panel-border'],
    accent: ['--pi-panel-accent', '--vscode-focusBorder', '--vscode-button-background'],
    focusBorder: ['--pi-panel-focus-border'],
    danger: ['--pi-panel-danger', '--vscode-errorForeground'],
    codeBackground: ['--pi-panel-code-bg', '--vscode-textCodeBlock-background'],
    scrollbarThumb: ['--pi-panel-scrollbar-thumb', '--vscode-scrollbarSlider-background'],
    scrollbarThumbHover: ['--pi-panel-scrollbar-thumb-hover', '--vscode-scrollbarSlider-hoverBackground']
  };
  const ensureThemeStyle = () => {
    let style = document.getElementById(themeStyleId);
    if (!style) {
      style = document.createElement('style');
      style.id = themeStyleId;
      style.setAttribute('${PI_PANEL_THEME_STYLE_ATTR}', 'true');
      document.head.prepend(style);
    }
    return style;
  };
  const applyTheme = (message) => {
    if (!message || message.type !== 'pi:webview.theme' || !message.tokens) return;
    const declarations = [];
    declarations.push('color-scheme: ' + (message.theme === 'light' ? 'light' : 'dark'));
    for (const [key, names] of Object.entries(themeTokenMap)) {
      const value = message.tokens[key];
      if (typeof value !== 'string' || value.trim() === '') continue;
      for (const name of names) {
        declarations.push(name + ': ' + value);
      }
    }
    ensureThemeStyle().textContent = ':root {' + declarations.join(';') + ';}';
    document.documentElement.dataset.piTheme = message.theme === 'light' ? 'light' : 'dark';
  };
  if (Object.prototype.hasOwnProperty.call(window, 'piPanel')) return;
  const handlers = new Set();
  let panelState;
  let hasPanelState = false;
  if (typeof initialStateJson === 'string') {
    try {
      panelState = JSON.parse(initialStateJson);
      hasPanelState = true;
    } catch {
      panelState = undefined;
      hasPanelState = false;
    }
  }
  const api = {
    post(message) {
      parent.postMessage(message, '*');
    },
    getState() {
      return hasPanelState ? panelState : undefined;
    },
    setState(state) {
      panelState = state;
      hasPanelState = true;
      parent.postMessage({ type: 'pi:webview.state', state }, '*');
      return state;
    },
    openExternal(uri) {
      if (typeof uri !== 'string') return;
      parent.postMessage({ type: 'pi:webview.openExternal', uri }, '*');
    },
    onMessage(handler) {
      if (typeof handler !== 'function') return () => {};
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    offMessage(handler) {
      handlers.delete(handler);
    }
  };
  Object.defineProperty(window, 'piPanel', {
    value: Object.freeze(api),
    configurable: false,
    writable: false
  });
  document.addEventListener('click', (event) => {
    const anchor = event.target && typeof event.target.closest === 'function' ? event.target.closest('a[href]') : null;
    if (!anchor) return;
    const rawHref = anchor.getAttribute('href');
    if (!rawHref || rawHref.startsWith('#')) return;
    let url;
    try {
      url = new URL(rawHref, document.baseURI);
    } catch {
      event.preventDefault();
      return;
    }
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
      event.preventDefault();
      api.openExternal(url.toString());
      return;
    }
    if (url.origin !== location.origin || url.protocol !== location.protocol) {
      event.preventDefault();
    }
  }, true);
  window.addEventListener('message', (event) => {
    applyTheme(event.data);
    if (event.data && event.data.type === 'pi:webview.restoreState') {
      panelState = event.data.state;
      hasPanelState = true;
    }
    for (const handler of Array.from(handlers)) {
      handler(event.data, event);
    }
  });
})();
</script>
`

function getDefaultThemeTokens(theme: ExtensionPanelResolvedTheme): ExtensionPanelThemeTokens {
  return theme === 'light' ? DEFAULT_LIGHT_THEME_TOKENS : DEFAULT_DARK_THEME_TOKENS
}

function normalizeCssValue(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : fallback
}

/** 判断消息是否为 host-reserved webview state 同步消息。 */
export function isExtensionPanelStatePayload(
  message: unknown
): message is ExtensionPanelStatePayload {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'pi:webview.state' &&
    Object.prototype.hasOwnProperty.call(message, 'state')
  )
}

/** 判断消息是否为 host-reserved 外链打开请求。 */
export function isExtensionPanelOpenExternalPayload(
  message: unknown
): message is ExtensionPanelOpenExternalPayload {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'pi:webview.openExternal' &&
    typeof (message as { uri?: unknown }).uri === 'string'
  )
}

/** 构造 host 向 webview 恢复持久状态的消息。 */
export function createExtensionPanelStateRestorePayload(
  state: unknown
): ExtensionPanelStateRestorePayload {
  return { type: 'pi:webview.restoreState', state }
}

/**
 * 克隆并校验 webview state，只允许 JSON 可序列化且大小受限的值进入 host runtime。
 */
export function cloneExtensionPanelStateForHost(
  state: unknown,
  maxBytes = MAX_EXTENSION_PANEL_STATE_BYTES
): { ok: true; value: unknown } | { ok: false; reason: 'not-json' | 'too-large' } {
  let serialized: string
  try {
    serialized = JSON.stringify(state)
  } catch {
    return { ok: false, reason: 'not-json' }
  }
  if (serialized === undefined) {
    return { ok: false, reason: 'not-json' }
  }
  if (new TextEncoder().encode(serialized).byteLength > maxBytes) {
    return { ok: false, reason: 'too-large' }
  }
  return { ok: true, value: JSON.parse(serialized) }
}

/** 将已保存 webview state 转为可注入 helper 的 JSON 字符串。 */
export function serializeExtensionPanelStateForInjection(state: unknown): string | undefined {
  const clone = cloneExtensionPanelStateForHost(state)
  if (!clone.ok) {
    return undefined
  }
  return JSON.stringify(clone.value)
}

/** 用给定 token 覆盖构造 webview theme payload。 */
export function createExtensionPanelThemePayload(input: {
  theme: ExtensionPanelResolvedTheme
  tokens?: Partial<ExtensionPanelThemeTokens>
}): ExtensionPanelThemePayload {
  const defaults = getDefaultThemeTokens(input.theme)
  return {
    type: 'pi:webview.theme',
    theme: input.theme,
    tokens: {
      foreground: normalizeCssValue(input.tokens?.foreground, defaults.foreground),
      background: normalizeCssValue(input.tokens?.background, defaults.background),
      mutedForeground: normalizeCssValue(input.tokens?.mutedForeground, defaults.mutedForeground),
      border: normalizeCssValue(input.tokens?.border, defaults.border),
      accent: normalizeCssValue(input.tokens?.accent, defaults.accent),
      focusBorder: normalizeCssValue(input.tokens?.focusBorder, defaults.focusBorder),
      danger: normalizeCssValue(input.tokens?.danger, defaults.danger),
      codeBackground: normalizeCssValue(input.tokens?.codeBackground, defaults.codeBackground),
      scrollbarThumb: normalizeCssValue(input.tokens?.scrollbarThumb, defaults.scrollbarThumb),
      scrollbarThumbHover: normalizeCssValue(
        input.tokens?.scrollbarThumbHover,
        defaults.scrollbarThumbHover
      )
    }
  }
}

/** 从 desktop 根节点读取 webview 可用的 host theme token。 */
export function collectExtensionPanelThemePayload(input: {
  theme: ExtensionPanelResolvedTheme
  root?: Element
}): ExtensionPanelThemePayload {
  const defaults = getDefaultThemeTokens(input.theme)
  if (typeof window === 'undefined' || !input.root) {
    return createExtensionPanelThemePayload({ theme: input.theme })
  }
  const styles = window.getComputedStyle(input.root)
  const read = (name: string, fallback: string): string =>
    normalizeCssValue(styles.getPropertyValue(name), fallback)

  return createExtensionPanelThemePayload({
    theme: input.theme,
    tokens: {
      foreground: read('--color-text', defaults.foreground),
      background: read('--color-surface', defaults.background),
      mutedForeground: read('--color-text-muted', defaults.mutedForeground),
      border: read('--color-border', defaults.border),
      accent: read('--color-accent', defaults.accent),
      focusBorder: read('--color-primary-outline', defaults.focusBorder),
      danger: read('--color-danger', defaults.danger),
      codeBackground: read('--color-code-bg', defaults.codeBackground),
      scrollbarThumb: read('--color-border-strong', defaults.scrollbarThumb),
      scrollbarThumbHover: read('--color-text-subtle', defaults.scrollbarThumbHover)
    }
  })
}

function createExtensionPanelThemeStyle(theme: ExtensionPanelThemePayload): string {
  const tokens = theme.tokens
  return `
<style id="${PI_PANEL_THEME_TOKEN_STYLE_ID}" ${PI_PANEL_THEME_STYLE_MARKER}>
:root {
  color-scheme: ${theme.theme};
  --pi-panel-bg: ${tokens.background};
  --pi-panel-fg: ${tokens.foreground};
  --pi-panel-muted: ${tokens.mutedForeground};
  --pi-panel-border: ${tokens.border};
  --pi-panel-accent: ${tokens.accent};
  --pi-panel-focus-border: ${tokens.focusBorder};
  --pi-panel-danger: ${tokens.danger};
  --pi-panel-code-bg: ${tokens.codeBackground};
  --pi-panel-scrollbar-thumb: ${tokens.scrollbarThumb};
  --pi-panel-scrollbar-thumb-hover: ${tokens.scrollbarThumbHover};
  --vscode-foreground: var(--pi-panel-fg);
  --vscode-editor-background: var(--pi-panel-bg);
  --vscode-descriptionForeground: var(--pi-panel-muted);
  --vscode-panel-border: var(--pi-panel-border);
  --vscode-focusBorder: var(--pi-panel-focus-border);
  --vscode-button-background: var(--pi-panel-accent);
  --vscode-errorForeground: var(--pi-panel-danger);
  --vscode-textCodeBlock-background: var(--pi-panel-code-bg);
  --vscode-scrollbarSlider-background: var(--pi-panel-scrollbar-thumb);
  --vscode-scrollbarSlider-hoverBackground: var(--pi-panel-scrollbar-thumb-hover);
}
</style>
`
}

/** 获取扩展内容本身的 sandbox token。 */
export function getExtensionPanelContentSandbox(
  panel: DesktopExtensionWebviewPanel | undefined
): string {
  const source = panel?.source
  if (!source || source.type === 'native') return ''
  const permissions = source.permissions
  const tokens: string[] = []
  if (permissions?.enableScripts) tokens.push('allow-scripts')
  if (permissions?.forms) tokens.push('allow-forms')
  if (permissions?.popups) tokens.push('allow-popups')
  if (permissions?.downloads) tokens.push('allow-downloads')
  if (source?.type === 'url' && permissions?.sameOrigin) tokens.push('allow-same-origin')
  return tokens.join(' ')
}

/** 获取 renderer 直接承载的 iframe sandbox token。 */
export function getExtensionPanelSandbox(panel: DesktopExtensionWebviewPanel | undefined): string {
  return getExtensionPanelSandboxForAccess(panel, false)
}

export function getExtensionPanelSandboxForAccess(
  panel: DesktopExtensionWebviewPanel | undefined,
  unrestrictedUrlAccess: boolean
): string {
  if (panel?.source.type === 'url') {
    if (unrestrictedUrlAccess) return getExtensionPanelContentSandbox(panel)
    // URL host 使用 data: opaque origin；allow-same-origin 只用于避免把限制继承给内层 URL。
    return 'allow-scripts allow-same-origin'
  }
  return getExtensionPanelContentSandbox(panel)
}

function isLocalhostHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  )
}

function defaultPortForProtocol(protocol: string): number | undefined {
  if (protocol === 'http:') {
    return 80
  }
  if (protocol === 'https:') {
    return 443
  }
  return undefined
}

/** URL panel 入口地址应用 VS Code 风格 localhost portMapping。 */
export function getExtensionPanelResolvedUrl(
  panel: DesktopExtensionWebviewPanel | undefined
): string | undefined {
  if (panel?.source.type !== 'url') {
    return undefined
  }
  try {
    return resolveExtensionPanelUrlWithPortMapping(panel, panel.source.url)
  } catch {
    return undefined
  }
}

function resolveExtensionPanelUrlWithPortMapping(
  panel: DesktopExtensionWebviewPanel,
  urlText: string
): string | undefined {
  if (panel.source.type !== 'url') return undefined
  const url = new URL(urlText)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return undefined
  }
  if (!isLocalhostHostname(url.hostname)) {
    return url.toString()
  }
  const sourcePort = url.port ? Number(url.port) : defaultPortForProtocol(url.protocol)
  const mapping = panel.source.portMapping?.find((item) => item.webviewPort === sourcePort)
  if (mapping) {
    url.port = String(mapping.extensionHostPort)
  }
  return url.toString()
}

/** URL panel 的可信消息 origin；HTML/srcdoc panel 为 opaque origin，返回 undefined。 */
export function getExtensionPanelMessageOrigin(
  panel: DesktopExtensionWebviewPanel | undefined
): string | undefined {
  if (panel?.source.type !== 'url') {
    return undefined
  }
  try {
    const resolvedUrl = getExtensionPanelResolvedUrl(panel)
    if (!resolvedUrl) {
      return undefined
    }
    const url = new URL(resolvedUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return undefined
    }
    return url.origin
  } catch {
    return undefined
  }
}

/** URL panel 允许停留的导航 origin；HTML/srcdoc panel 不允许由 host 管理 URL 导航。 */
export function getExtensionPanelAllowedNavigationOrigin(
  panel: DesktopExtensionWebviewPanel | undefined
): string | undefined {
  return getExtensionPanelMessageOrigin(panel)
}

/** 判断 URL panel 的可见导航地址是否仍在入口 resolved origin 内。 */
export function isExtensionPanelNavigationAllowed(
  panel: DesktopExtensionWebviewPanel | undefined,
  urlText: string | undefined
): boolean {
  if (!panel || panel.source.type !== 'url' || !urlText) {
    return false
  }
  const allowedOrigin = getExtensionPanelAllowedNavigationOrigin(panel)
  if (!allowedOrigin) {
    return false
  }
  try {
    const resolvedUrl = resolveExtensionPanelUrlWithPortMapping(panel, urlText)
    return resolvedUrl ? new URL(resolvedUrl).origin === allowedOrigin : false
  } catch {
    return false
  }
}

/** renderer 向 host iframe postMessage 时使用的 targetOrigin。 */
export function getExtensionPanelTargetOrigin(
  panel: DesktopExtensionWebviewPanel | undefined,
  unrestrictedUrlAccess = false
): string {
  if (unrestrictedUrlAccess && panel?.source.type === 'url') return '*'
  // HTML panel 使用 sandboxed srcdoc，URL panel host 使用 sandboxed data 文档；
  // 两者均为 opaque origin。
  return '*'
}

/** 判断来自 iframe 的 message 是否应被转发给 extension。 */
export function shouldAcceptExtensionPanelMessage(input: {
  panel: DesktopExtensionWebviewPanel | undefined
  eventOrigin: string
  eventSource: MessageEventSource | null
  frameWindow: Window | null | undefined
  unrestrictedUrlAccess?: boolean
}): boolean {
  if (!input.panel || input.eventSource !== input.frameWindow) {
    return false
  }
  if (input.unrestrictedUrlAccess && input.panel.source.type === 'url') return true
  // renderer 只和 sandboxed HTML/data host 通信。URL 内容的真实 origin 由 host 内部校验，
  // 远程页面直接向 top 投递时 event.source 不会等于 frameWindow。
  return input.eventOrigin === 'null'
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * 为 URL panel 构造受控 data host 文档内容。
 *
 * 顶层 renderer 将文档编码为 opaque-origin data URL。host 的精确 frame-src CSP
 * 会对内层 iframe 的初始请求与重定向共同生效，且消息只能经由匹配的 contentWindow 转发。
 */
export function prepareExtensionPanelUrlHost(
  panel: DesktopExtensionWebviewPanel | undefined
): string {
  if (panel?.source.type !== 'url') {
    return ''
  }
  const resolvedUrl = getExtensionPanelResolvedUrl(panel)
  const allowedOrigin = getExtensionPanelAllowedNavigationOrigin(panel)
  if (!resolvedUrl || !allowedOrigin) {
    return ''
  }

  const nonce = createPanelNonce()
  const contentSandbox = getExtensionPanelContentSandbox(panel)
  const preservesOrigin = panel.source.permissions?.sameOrigin === true
  const expectedChildOrigin = preservesOrigin ? allowedOrigin : 'null'
  const childTargetOrigin = preservesOrigin ? allowedOrigin : '*'
  const csp = [
    "default-src 'none'",
    `frame-src ${allowedOrigin}`,
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')

  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}">
  <style nonce="${nonce}">
    html, body, iframe { width: 100%; height: 100%; margin: 0; border: 0; }
    body { overflow: hidden; background: #fff; }
  </style>
</head>
<body>
  <script nonce="${nonce}">
    ;(() => {
      const childUrl = ${serializeForInlineScript(resolvedUrl)};
      const childTitle = ${serializeForInlineScript(panel.title)};
      const contentSandbox = ${serializeForInlineScript(contentSandbox)};
      const expectedChildOrigin = ${serializeForInlineScript(expectedChildOrigin)};
      const childTargetOrigin = ${serializeForInlineScript(childTargetOrigin)};
      const pendingHostMessages = [];
      let childReady = false;
      const frame = document.createElement('iframe');
      frame.id = 'pi-url-panel-content';
      frame.title = childTitle;
      frame.setAttribute('sandbox', contentSandbox);
      frame.referrerPolicy = 'no-referrer';

      const postToChild = (message) => {
        if (!frame.contentWindow) return;
        frame.contentWindow.postMessage(message, childTargetOrigin);
      };

      frame.addEventListener('load', () => {
        childReady = true;
        for (const message of pendingHostMessages.splice(0)) postToChild(message);
      });

      window.addEventListener('message', (event) => {
        if (event.source === parent) {
          if (childReady) postToChild(event.data);
          else if (pendingHostMessages.length < 32) pendingHostMessages.push(event.data);
          return;
        }
        if (event.source !== frame.contentWindow || event.origin !== expectedChildOrigin) return;
        parent.postMessage(event.data, '*');
      });

      document.body.appendChild(frame);
      frame.src = childUrl;
    })();
  </script>
</body>
</html>`
}

/** 判断 panel 隐藏后是否应保留 iframe context。 */
export function shouldRetainExtensionPanelContext(
  panel: DesktopExtensionWebviewPanel | undefined
): boolean {
  return panel?.retainContextWhenHidden === true
}

/** 给 HTML/srcdoc panel 注入 host 默认样式。 */
export function injectExtensionPanelHostStyles(
  html: string,
  theme: ExtensionPanelThemePayload = collectExtensionPanelThemePayload({ theme: 'dark' })
): string {
  if (html.includes(PI_PANEL_HOST_STYLE_MARKER)) {
    return html
  }
  const style = `${createExtensionPanelThemeStyle(theme)}${PI_PANEL_HOST_STYLE}`
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${style}`)
  }
  return `${style}${html}`
}

function createPanelNonce(): string {
  return PI_PANEL_SCRIPT_NONCE
}

function injectIntoHead(html: string, content: string): string {
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${content}`)
  }
  return `${content}${html}`
}

/** 给 HTML/srcdoc panel 注入 CSP。 */
export function injectExtensionPanelCsp(html: string, nonce: string): string {
  if (html.includes(PI_PANEL_CSP_MARKER)) {
    return html
  }
  const csp = [
    "default-src 'none'",
    'img-src pi-webview-resource: data: https: http:',
    'font-src pi-webview-resource: data:',
    "style-src 'unsafe-inline' pi-webview-resource:",
    `script-src 'nonce-${nonce}' pi-webview-resource:`,
    'connect-src pi-webview-resource: https: http:',
    'media-src pi-webview-resource: data:',
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}" ${PI_PANEL_CSP_MARKER}>`
  return injectIntoHead(html, meta)
}

/** 给 HTML/srcdoc panel 的所有 script 标签设置当前 CSP nonce。 */
export function injectExtensionPanelScriptNonces(html: string, nonce: string): string {
  return html.replace(/<script\b([^>]*)>/gi, (_match, attrs: string) => {
    const nextAttrs = attrs.replace(/\s+nonce\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '')
    return `<script nonce="${nonce}"${nextAttrs}>`
  })
}

/** 给 HTML/srcdoc panel 注入 window.piPanel helper。 */
export function injectPiPanelHelper(
  html: string,
  nonce = 'theme-init',
  initialStateJson?: string
): string {
  if (html.includes(PI_PANEL_HELPER_MARKER)) {
    return html
  }
  return injectIntoHead(html, createPiPanelHelperScript(nonce, initialStateJson))
}

/** 准备传给 iframe srcdoc 的 HTML。 */
export function prepareExtensionPanelHtml(
  panel: DesktopExtensionWebviewPanel,
  theme: ExtensionPanelThemePayload = collectExtensionPanelThemePayload({ theme: 'dark' }),
  initialState?: unknown
): string {
  if (panel.source.type !== 'html') {
    return ''
  }
  let html = injectExtensionPanelHostStyles(panel.source.html, theme)
  if (!panel.source.permissions?.enableScripts) {
    return html
  }
  const nonce = createPanelNonce()
  html = injectPiPanelHelper(html, nonce, serializeExtensionPanelStateForInjection(initialState))
  html = injectExtensionPanelScriptNonces(html, nonce)
  return injectExtensionPanelCsp(html, nonce)
}
