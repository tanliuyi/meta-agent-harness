/**
 * 本文件注册 desktop extension webview 的受控资源协议。
 */

import { net, protocol } from 'electron'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CodingThreadManager } from './thread-manager'
import type { DiagnosticRecord } from './thread-store'

export const webviewResourceScheme = 'pi-webview-resource'
const webviewResourceCacheControl = 'no-store'
type WebviewResourceFailureReason =
  'method_not_allowed' | 'invalid_url' | 'token_not_found' | 'file_not_found' | 'fetch_failed'

/**
 * 从 pi-webview-resource URL 提取 opaque token。
 * @param urlText - 请求 URL。
 * @returns token，非法 URL 返回 undefined。
 */
export function getWebviewResourceToken(urlText: string): string | undefined {
  try {
    const url = new URL(urlText)
    if (url.protocol !== `${webviewResourceScheme}:`) {
      return undefined
    }
    const token = url.hostname || url.pathname.replace(/^\/+/, '')
    return token || undefined
  } catch {
    return undefined
  }
}

/**
 * 判断资源协议支持的 HTTP method。
 * @param method - request method。
 * @returns 是否允许。
 */
export function isWebviewResourceMethodAllowed(method: string): boolean {
  return method === 'GET' || method === 'HEAD'
}

/**
 * 根据本地资源路径推断 webview resource MIME。
 * @param filePath - 本地资源路径。
 * @returns MIME。
 */
export function getWebviewResourceContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.avif':
      return 'image/avif'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8'
    case '.map':
    case '.json':
      return 'application/json; charset=utf-8'
    case '.html':
    case '.htm':
      return 'text/html; charset=utf-8'
    case '.wasm':
      return 'application/wasm'
    case '.woff':
      return 'font/woff'
    case '.woff2':
      return 'font/woff2'
    case '.ttf':
      return 'font/ttf'
    case '.otf':
      return 'font/otf'
    case '.mp4':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    default:
      return 'application/octet-stream'
  }
}

/**
 * 构造 webview resource 统一响应头。
 * @param filePath - 本地资源路径。
 * @returns headers。
 */
export function createWebviewResourceHeaders(filePath: string): Headers {
  return new Headers({
    'Cache-Control': webviewResourceCacheControl,
    'Content-Type': getWebviewResourceContentType(filePath),
    'X-Content-Type-Options': 'nosniff'
  })
}

function createInlineWebviewResourceHeaders(contentType: string, contentLength?: number): Headers {
  const headers = new Headers({
    'Cache-Control': webviewResourceCacheControl,
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff'
  })
  if (contentLength !== undefined) {
    headers.set('Content-Length', String(contentLength))
  }
  return headers
}

function createTextResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      'Cache-Control': webviewResourceCacheControl,
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    }
  })
}

function recordWebviewResourceDiagnostic(input: {
  manager: CodingThreadManager | undefined
  reason: WebviewResourceFailureReason
  status: number
  method: string
  token?: string
  threadId?: string
}): void {
  try {
    const record: DiagnosticRecord = {
      id: [
        'webview-resource',
        input.reason,
        input.threadId ?? 'global',
        input.token ?? 'no-token',
        input.method
      ].join(':'),
      threadId: input.threadId,
      source: 'webview_resource',
      severity: input.status >= 500 ? 'error' : 'warning',
      message: createWebviewResourceDiagnosticMessage(input.reason),
      details: {
        status: input.status,
        method: input.method,
        reason: input.reason,
        token: input.token,
        threadId: input.threadId
      }
    }
    input.manager?.getStore()?.recordDiagnostic(record)
  } catch {
    // 诊断写入失败不能影响资源协议响应。
  }
}

function createWebviewResourceDiagnosticMessage(reason: WebviewResourceFailureReason): string {
  switch (reason) {
    case 'method_not_allowed':
      return 'Webview resource request used an unsupported method'
    case 'invalid_url':
      return 'Webview resource request used an invalid URL'
    case 'token_not_found':
      return 'Webview resource token was not registered or has expired'
    case 'file_not_found':
      return 'Webview resource file is no longer available'
    case 'fetch_failed':
      return 'Webview resource could not be loaded by the host'
  }
}

/**
 * 注册 privileged scheme。必须在 app ready 前调用。
 */
export function registerWebviewResourceScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: webviewResourceScheme,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true
      }
    }
  ])
}

/**
 * 注册资源请求 handler。
 * @param getManager - 返回当前已加载的 coding agent manager。
 */
export function registerWebviewResourceProtocol(
  getManager: () => Promise<CodingThreadManager | undefined> | undefined
): void {
  protocol.handle(webviewResourceScheme, async (request) => {
    const manager = await getManager()
    if (!isWebviewResourceMethodAllowed(request.method)) {
      recordWebviewResourceDiagnostic({
        manager,
        reason: 'method_not_allowed',
        status: 405,
        method: request.method,
        token: getWebviewResourceToken(request.url)
      })
      return createTextResponse('Method not allowed', 405)
    }
    const token = getWebviewResourceToken(request.url)
    if (!token) {
      recordWebviewResourceDiagnostic({
        manager,
        reason: 'invalid_url',
        status: 400,
        method: request.method
      })
      return createTextResponse('Invalid webview resource URL', 400)
    }
    const resource = manager?.resolveExtensionWebviewResource(token)
    if (!resource) {
      recordWebviewResourceDiagnostic({
        manager,
        reason: 'token_not_found',
        status: 404,
        method: request.method,
        token
      })
      return createTextResponse('Webview resource not found', 404)
    }
    if (typeof resource.content === 'string') {
      const contentLength = new TextEncoder().encode(resource.content).byteLength
      const headers = createInlineWebviewResourceHeaders(
        resource.contentType ?? 'text/plain; charset=utf-8',
        contentLength
      )
      return new Response(request.method === 'HEAD' ? undefined : resource.content, {
        status: 200,
        headers
      })
    }
    if (!resource.path) {
      recordWebviewResourceDiagnostic({
        manager,
        reason: 'file_not_found',
        status: 404,
        method: request.method,
        token,
        threadId: resource.threadId
      })
      return createTextResponse('Webview resource not found', 404)
    }
    const stats = await stat(resource.path).catch(() => undefined)
    if (!stats?.isFile()) {
      recordWebviewResourceDiagnostic({
        manager,
        reason: 'file_not_found',
        status: 404,
        method: request.method,
        token,
        threadId: resource.threadId
      })
      return createTextResponse('Webview resource not found', 404)
    }
    const headers = createWebviewResourceHeaders(resource.path)
    headers.set('Content-Length', String(stats.size))
    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers })
    }
    const fileResponse = await net
      .fetch(pathToFileURL(resource.path).toString())
      .catch(() => undefined)
    if (!fileResponse?.ok || !fileResponse.body) {
      const status = fileResponse && !fileResponse.ok ? fileResponse.status || 502 : 502
      recordWebviewResourceDiagnostic({
        manager,
        reason: 'fetch_failed',
        status,
        method: request.method,
        token,
        threadId: resource.threadId
      })
      return createTextResponse('Webview resource not available', status)
    }
    return new Response(fileResponse.body, {
      status: 200,
      headers
    })
  })
}
