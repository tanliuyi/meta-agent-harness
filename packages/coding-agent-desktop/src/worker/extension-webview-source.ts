/**
 * 解析 desktop extension webview source，并在 worker 侧完成本地资源读取。
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'

export interface DesktopWebviewPanelPermissions {
  enableScripts?: boolean
  forms?: boolean
  popups?: boolean
  downloads?: boolean
  sameOrigin?: boolean
}

export interface DesktopWebviewPortMapping {
  webviewPort: number
  extensionHostPort: number
}

export interface DesktopWebviewUriOptions {
  basePath?: string
  localResourceRoots?: string[]
}

export interface DesktopWebviewResourceRegistration {
  token: string
  path: string
}

export interface DesktopInlineWebviewResourceRegistration {
  token: string
  content: string
  contentType: string
}

export type DesktopWebviewResourceRegistrationResult =
  DesktopWebviewResourceRegistration | DesktopInlineWebviewResourceRegistration

export type DesktopWebviewResourceReference = Omit<
  DesktopWebviewResourceRegistrationResult,
  'token'
>

export type DesktopWebviewResourceUriFactory = (resource: DesktopWebviewResourceReference) => string

export const desktopWebviewHostStylesheetPath = 'pi:host/webview.css'

const desktopWebviewHostStylesheet = `
:root {
	color-scheme: light dark;
	--pi-panel-bg: #ffffff;
	--pi-panel-fg: #201f1b;
	--pi-panel-muted: #756f64;
	--pi-panel-border: rgb(32 31 27 / 11%);
	--pi-panel-accent: #c44d4d;
	--pi-panel-focus-border: rgb(196 77 77 / 34%);
	--pi-panel-danger: #8d2e2e;
	--pi-panel-code-bg: #f6f8fa;
	--pi-panel-scrollbar-size: 10px;
	--pi-panel-scrollbar-thumb: rgb(113 113 122 / 52%);
	--pi-panel-scrollbar-thumb-hover: rgb(113 113 122 / 72%);
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
`.trim()

export type DesktopWebviewPanelSource =
  | {
      type: 'url'
      url: string
      permissions?: DesktopWebviewPanelPermissions
      portMapping?: DesktopWebviewPortMapping[]
    }
  | {
      type: 'html'
      html: string
      baseUrl?: string
      permissions?: DesktopWebviewPanelPermissions
      portMapping?: DesktopWebviewPortMapping[]
    }
  | {
      type: 'file'
      path: string
      basePath?: string
      localResourceRoots?: string[]
      permissions?: DesktopWebviewPanelPermissions
      portMapping?: DesktopWebviewPortMapping[]
    }
  | {
      type: 'bundle'
      root: string
      html?: string
      basePath?: string
      localResourceRoots?: string[]
      permissions?: DesktopWebviewPanelPermissions
      portMapping?: DesktopWebviewPortMapping[]
    }

export type ResolvedDesktopWebviewPanelSource =
  | {
      type: 'url'
      url: string
      permissions?: DesktopWebviewPanelPermissions
      portMapping?: DesktopWebviewPortMapping[]
    }
  | {
      type: 'html'
      html: string
      baseUrl?: string
      permissions?: DesktopWebviewPanelPermissions
      portMapping?: DesktopWebviewPortMapping[]
    }

export interface DesktopWebviewPanelOptions {
  viewType?: string
  title: string
  icon?: string
  order?: number
  retainContextWhenHidden?: boolean
  source: DesktopWebviewPanelSource
}

export type ResolvedDesktopWebviewPanelOptions = Omit<DesktopWebviewPanelOptions, 'source'> & {
  source: ResolvedDesktopWebviewPanelSource
}

export function resolveDesktopWebviewPanelOptions(
  options: DesktopWebviewPanelOptions,
  cwd: string,
  resourceUriFactory: DesktopWebviewResourceUriFactory
): ResolvedDesktopWebviewPanelOptions {
  return {
    ...options,
    source: resolveDesktopWebviewPanelSource(options.source, cwd, resourceUriFactory)
  }
}

export function resolveDesktopWebviewPanelPatch(
  patch: Partial<DesktopWebviewPanelOptions>,
  cwd: string,
  resourceUriFactory: DesktopWebviewResourceUriFactory
): Partial<ResolvedDesktopWebviewPanelOptions> {
  if (!patch.source) {
    return patch as Partial<ResolvedDesktopWebviewPanelOptions>
  }
  return {
    ...patch,
    source: resolveDesktopWebviewPanelSource(patch.source, cwd, resourceUriFactory)
  }
}

export function asDesktopWebviewUri(
  resourcePath: string,
  options: DesktopWebviewUriOptions | undefined,
  cwd: string,
  token: string
): DesktopWebviewResourceRegistrationResult {
  if (resourcePath === desktopWebviewHostStylesheetPath) {
    return {
      token,
      content: desktopWebviewHostStylesheet,
      contentType: 'text/css; charset=utf-8'
    }
  }
  const resolved = resolvePath(resourcePath, options?.basePath, cwd)
  const roots = uniqueRoots(
    options?.localResourceRoots
      ? options.localResourceRoots.map((root) => resolvePath(root, options.basePath, cwd))
      : [cwd]
  )
  assertReadableAsset(resolved, roots)
  return { token, path: path.resolve(resolved) }
}

export function resolveDesktopWebviewPanelSource(
  source: DesktopWebviewPanelSource,
  cwd: string,
  resourceUriFactory: DesktopWebviewResourceUriFactory
): ResolvedDesktopWebviewPanelSource {
  if (source.type === 'url') {
    assertValidPanelUrl(source.url)
    assertValidPortMappings(source.portMapping)
    return source
  }
  if (source.type === 'html') {
    assertValidPortMappings(source.portMapping)
    return source
  }
  if (source.type === 'file') {
    const htmlFile = resolvePath(source.path, source.basePath, cwd)
    const roots = uniqueRoots(
      source.localResourceRoots
        ? source.localResourceRoots.map((root) => resolvePath(root, source.basePath, cwd))
        : [path.dirname(htmlFile)]
    )
    if (!existsSync(htmlFile)) {
      throw new Error(`Desktop webview HTML file not found: ${htmlFile}`)
    }
    const html = rewriteLocalResources(
      readFileSync(htmlFile, 'utf8'),
      htmlFile,
      roots,
      path.dirname(htmlFile),
      resourceUriFactory
    )
    assertValidPortMappings(source.portMapping)
    return {
      type: 'html',
      html,
      baseUrl: path.dirname(htmlFile),
      permissions: source.permissions,
      portMapping: source.portMapping
    }
  }

  const root = resolvePath(source.root, source.basePath, cwd)
  const htmlFile = path.resolve(root, source.html ?? 'index.html')
  const roots = uniqueRoots(
    source.localResourceRoots
      ? source.localResourceRoots.map((localRoot) => resolvePath(localRoot, source.basePath, cwd))
      : [root]
  )
  assertInsideRoots(htmlFile, [root])
  if (!existsSync(htmlFile)) {
    throw new Error(`Desktop webview bundle HTML not found: ${htmlFile}`)
  }
  const html = rewriteLocalResources(
    readFileSync(htmlFile, 'utf8'),
    htmlFile,
    roots,
    root,
    resourceUriFactory
  )
  assertValidPortMappings(source.portMapping)
  return {
    type: 'html',
    html,
    baseUrl: root,
    permissions: source.permissions,
    portMapping: source.portMapping
  }
}

function assertValidPanelUrl(urlText: string): void {
  try {
    const url = new URL(urlText)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol')
    }
  } catch (error) {
    throw new Error(`Invalid desktop webview panel URL: ${urlText}`)
  }
}

function assertValidPortMappings(portMapping: DesktopWebviewPortMapping[] | undefined): void {
  if (!portMapping) {
    return
  }
  for (const mapping of portMapping) {
    if (!isValidPort(mapping.webviewPort) || !isValidPort(mapping.extensionHostPort)) {
      throw new Error('Invalid desktop webview portMapping')
    }
  }
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

function resolvePath(inputPath: string, basePath: string | undefined, fallbackCwd: string): string {
  return path.resolve(basePath ?? fallbackCwd, inputPath)
}

function uniqueRoots(roots: string[]): string[] {
  return [...new Set(roots.map((root) => path.resolve(root)))]
}

function realPathIfExists(filePath: string): string {
  return existsSync(filePath) ? realpathSync(filePath) : path.resolve(filePath)
}

function isInsideRoot(filePath: string, roots: string[]): boolean {
  const resolvedFile = realPathIfExists(filePath)
  return roots.some((root) => {
    const relative = path.relative(realPathIfExists(root), resolvedFile)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  })
}

function assertInsideRoots(filePath: string, roots: string[]): void {
  if (!isInsideRoot(filePath, roots)) {
    throw new Error(`Desktop webview asset is outside localResourceRoots: ${filePath}`)
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/[&"]/g, (char) => (char === '&' ? '&amp;' : '&quot;'))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isExternalResource(value: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:)/i.test(value)
}

function assertReadableAsset(assetPath: string, roots: string[]): void {
  const resolved = path.resolve(assetPath)
  if (!existsSync(resolved)) {
    throw new Error(`Desktop webview asset not found: ${resolved}`)
  }
  assertInsideRoots(resolved, roots)
}

function splitResourceReference(value: string): { pathText: string; suffix: string } {
  const match = /[?#]/.exec(value)
  if (!match) {
    return { pathText: value, suffix: '' }
  }
  return { pathText: value.slice(0, match.index), suffix: value.slice(match.index) }
}

function resolveAssetPath(value: string, baseDir: string, resourceRoot: string): string {
  const { pathText } = splitResourceReference(value)
  const cleanValue = pathText || value
  if (cleanValue.startsWith('/')) {
    return path.resolve(resourceRoot, `.${cleanValue}`)
  }
  return path.resolve(baseDir, cleanValue)
}

function createPathResourceUri(
  assetPath: string,
  roots: string[],
  resourceUriFactory: DesktopWebviewResourceUriFactory
): string {
  const resolved = path.resolve(assetPath)
  assertReadableAsset(resolved, roots)
  return resourceUriFactory({ path: resolved })
}

function createCssResourceUri(
  cssFile: string,
  roots: string[],
  resourceRoot: string,
  resourceUriFactory: DesktopWebviewResourceUriFactory
): string {
  const resolved = path.resolve(cssFile)
  assertReadableAsset(resolved, roots)
  const css = rewriteSourceMappingUrls(
    rewriteCssResourceUrls(
      readFileSync(resolved, 'utf8'),
      resolved,
      roots,
      resourceRoot,
      resourceUriFactory
    ),
    resolved,
    roots,
    resourceRoot,
    resourceUriFactory
  )
  return resourceUriFactory({ content: css, contentType: 'text/css; charset=utf-8' })
}

function createScriptResourceUri(
  scriptFile: string,
  roots: string[],
  resourceRoot: string,
  resourceUriFactory: DesktopWebviewResourceUriFactory
): string {
  const resolved = path.resolve(scriptFile)
  assertReadableAsset(resolved, roots)
  const script = rewriteSourceMappingUrls(
    readFileSync(resolved, 'utf8'),
    resolved,
    roots,
    resourceRoot,
    resourceUriFactory
  )
  return resourceUriFactory({ content: script, contentType: 'text/javascript; charset=utf-8' })
}

function rewriteCssResourceUrls(
  css: string,
  cssFile: string,
  roots: string[],
  resourceRoot: string,
  resourceUriFactory: DesktopWebviewResourceUriFactory
): string {
  const cssBaseDir = path.dirname(cssFile)
  return css.replace(
    /url\(\s*(?:(["'])(.*?)\1|([^"')]+))\s*\)/gi,
    (match, quote, quotedValue, bareValue) => {
      const value = (quotedValue ?? bareValue ?? '').trim()
      if (!value || isExternalResource(value)) {
        return match
      }
      const { suffix } = splitResourceReference(value)
      const resourceUri = createPathResourceUri(
        resolveAssetPath(value, cssBaseDir, resourceRoot),
        roots,
        resourceUriFactory
      )
      const nextQuote = quote ?? ''
      return `url(${nextQuote}${escapeAttribute(`${resourceUri}${suffix}`)}${nextQuote})`
    }
  )
}

function replaceQuotedAttribute(
  match: string,
  attribute: string,
  currentValue: string,
  nextValue: string
): string {
  const attributePattern = new RegExp(
    `(\\b${attribute}\\s*=\\s*)(["'])${escapeRegExp(currentValue)}\\2`,
    'i'
  )
  return match.replace(
    attributePattern,
    (_attributeMatch, prefix, quote) => `${prefix}${quote}${escapeAttribute(nextValue)}${quote}`
  )
}

function rewriteSourceMappingUrls(
  content: string,
  sourceFile: string,
  roots: string[],
  resourceRoot: string,
  resourceUriFactory: DesktopWebviewResourceUriFactory
): string {
  const baseDir = path.dirname(sourceFile)
  return content.replace(/(sourceMappingURL=)([^\s*]+)/g, (match, prefix, value) => {
    const sourceMap = String(value).trim()
    if (!sourceMap || isExternalResource(sourceMap)) {
      return match
    }
    const { suffix } = splitResourceReference(sourceMap)
    const resourceUri = createPathResourceUri(
      resolveAssetPath(sourceMap, baseDir, resourceRoot),
      roots,
      resourceUriFactory
    )
    return `${prefix}${resourceUri}${suffix}`
  })
}

function rewriteStylesheet(
  match: string,
  href: string,
  baseDir: string,
  roots: string[],
  resourceRoot: string,
  resourceUriFactory: DesktopWebviewResourceUriFactory
): string {
  if (isExternalResource(href)) {
    return match
  }
  const cssFile = resolveAssetPath(href, baseDir, resourceRoot)
  const resourceUri = createCssResourceUri(cssFile, roots, resourceRoot, resourceUriFactory)
  return replaceQuotedAttribute(match, 'href', href, resourceUri)
}

function rewriteScript(
  match: string,
  src: string,
  baseDir: string,
  roots: string[],
  resourceRoot: string,
  resourceUriFactory: DesktopWebviewResourceUriFactory
): string {
  if (isExternalResource(src)) {
    return match
  }
  const { suffix } = splitResourceReference(src)
  const resourceUri = createScriptResourceUri(
    resolveAssetPath(src, baseDir, resourceRoot),
    roots,
    resourceRoot,
    resourceUriFactory
  )
  return replaceQuotedAttribute(match, 'src', src, `${resourceUri}${suffix}`)
}

function rewriteAttributeResource(
  match: string,
  attribute: string,
  value: string,
  baseDir: string,
  roots: string[],
  resourceRoot: string,
  resourceUriFactory: DesktopWebviewResourceUriFactory
): string {
  if (isExternalResource(value)) {
    return match
  }
  const { suffix } = splitResourceReference(value)
  const resourceUri = createPathResourceUri(
    resolveAssetPath(value, baseDir, resourceRoot),
    roots,
    resourceUriFactory
  )
  return replaceQuotedAttribute(match, attribute, value, `${resourceUri}${suffix}`)
}

function rewriteSrcset(
  value: string,
  baseDir: string,
  roots: string[],
  resourceRoot: string,
  resourceUriFactory: DesktopWebviewResourceUriFactory
): string {
  return value
    .split(',')
    .map((candidate) => {
      const trimmed = candidate.trim()
      if (!trimmed) {
        return trimmed
      }
      const [resource, ...descriptors] = trimmed.split(/\s+/)
      if (!resource || isExternalResource(resource)) {
        return trimmed
      }
      const { suffix } = splitResourceReference(resource)
      const resourceUri = createPathResourceUri(
        resolveAssetPath(resource, baseDir, resourceRoot),
        roots,
        resourceUriFactory
      )
      return [`${resourceUri}${suffix}`, ...descriptors].join(' ')
    })
    .join(', ')
}

function rewriteSrcsetAttribute(
  match: string,
  value: string,
  baseDir: string,
  roots: string[],
  resourceRoot: string,
  resourceUriFactory: DesktopWebviewResourceUriFactory
): string {
  const nextValue = rewriteSrcset(value, baseDir, roots, resourceRoot, resourceUriFactory)
  return replaceQuotedAttribute(match, 'srcset', value, nextValue)
}

function rewriteLocalResources(
  html: string,
  htmlFile: string,
  roots: string[],
  resourceRoot: string,
  resourceUriFactory: DesktopWebviewResourceUriFactory
): string {
  const baseDir = path.dirname(htmlFile)
  return html
    .replace(
      /<link\b(?=[^>]*\brel=["']stylesheet["'])(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>/gi,
      (match, href) =>
        rewriteStylesheet(match, href, baseDir, roots, resourceRoot, resourceUriFactory)
    )
    .replace(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (match, src) =>
      rewriteScript(match, src, baseDir, roots, resourceRoot, resourceUriFactory)
    )
    .replace(
      /<(img|source|video|audio|track|image|use)\b[^>]*\b(src|href)=["']([^"']+)["'][^>]*>/gi,
      (match, _tag, attribute, value) =>
        rewriteAttributeResource(
          match,
          attribute,
          value,
          baseDir,
          roots,
          resourceRoot,
          resourceUriFactory
        )
    )
    .replace(/<(img|source)\b[^>]*\bsrcset=["']([^"']+)["'][^>]*>/gi, (match, _tag, value) =>
      rewriteSrcsetAttribute(match, value, baseDir, roots, resourceRoot, resourceUriFactory)
    )
}
