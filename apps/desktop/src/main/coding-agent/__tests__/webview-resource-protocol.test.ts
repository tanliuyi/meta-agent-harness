/**
 * 本文件测试 desktop webview resource protocol 的纯解析逻辑。
 */

import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

vi.mock('electron', () => ({
  net: { fetch: vi.fn() },
  protocol: {
    handle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn()
  }
}))

import { net, protocol } from 'electron'
import {
  createWebviewResourceHeaders,
  getWebviewResourceContentType,
  getWebviewResourceToken,
  isWebviewResourceMethodAllowed,
  registerWebviewResourceProtocol
} from '../webview-resource-protocol'

describe('webview-resource-protocol', () => {
  it('从 pi-webview-resource URL 提取 opaque token', () => {
    expect(getWebviewResourceToken('pi-webview-resource://token-a')).toBe('token-a')
    expect(getWebviewResourceToken('pi-webview-resource:///token-b')).toBe('token-b')
    expect(getWebviewResourceToken('https://example.com/token')).toBeUndefined()
    expect(getWebviewResourceToken('not a url')).toBeUndefined()
  })

  it('推断资源 MIME 并设置安全响应头', () => {
    expect(getWebviewResourceContentType('/tmp/app.js')).toBe('text/javascript; charset=utf-8')
    expect(getWebviewResourceContentType('/tmp/app.js.map')).toBe('application/json; charset=utf-8')
    expect(getWebviewResourceContentType('/tmp/style.css')).toBe('text/css; charset=utf-8')
    expect(getWebviewResourceContentType('/tmp/icon.svg')).toBe('image/svg+xml')
    expect(getWebviewResourceContentType('/tmp/app.wasm')).toBe('application/wasm')
    expect(getWebviewResourceContentType('/tmp/file.unknown')).toBe('application/octet-stream')

    const headers = createWebviewResourceHeaders('/tmp/app.js')
    expect(headers.get('Content-Type')).toBe('text/javascript; charset=utf-8')
    expect(headers.get('Cache-Control')).toBe('no-store')
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('只允许 GET 和 HEAD method', () => {
    expect(isWebviewResourceMethodAllowed('GET')).toBe(true)
    expect(isWebviewResourceMethodAllowed('HEAD')).toBe(true)
    expect(isWebviewResourceMethodAllowed('POST')).toBe(false)
  })

  it('注册 handler 后按 token 返回带 MIME 的 GET/HEAD 响应', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'webview-resource-protocol-'))
    try {
      const filePath = path.join(root, 'panel.js.map')
      writeFileSync(filePath, '{"version":3}', 'utf8')
      vi.mocked(net.fetch).mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"version":3}'))
              controller.close()
            }
          })
        )
      )
      const manager = {
        resolveExtensionWebviewResource: vi
          .fn()
          .mockReturnValue({ token: 'token-a', path: filePath })
      }

      registerWebviewResourceProtocol(async () => manager as never)
      const handler = vi.mocked(protocol.handle).mock.calls.at(-1)?.[1]
      if (!handler) {
        throw new Error('protocol handler must be registered')
      }

      const getResponse = await handler(new Request('pi-webview-resource://token-a'))
      expect(getResponse.status).toBe(200)
      expect(getResponse.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
      expect(getResponse.headers.get('Cache-Control')).toBe('no-store')
      expect(getResponse.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(getResponse.headers.get('Content-Length')).toBe(String('{"version":3}'.length))
      expect(net.fetch).toHaveBeenCalledWith(pathToFileURL(filePath).toString())

      const headResponse = await handler(
        new Request('pi-webview-resource://token-a', { method: 'HEAD' })
      )
      expect(headResponse.status).toBe(200)
      expect(headResponse.headers.get('Content-Length')).toBe(String('{"version":3}'.length))
      expect(headResponse.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('注册 handler 后可返回 host inline CSS 资源', async () => {
    const manager = {
      resolveExtensionWebviewResource: vi.fn().mockReturnValue({
        token: 'host-style',
        content: ':root { --pi-panel-scrollbar-thumb: red; }',
        contentType: 'text/css; charset=utf-8',
        threadId: 'thread-a'
      })
    }

    registerWebviewResourceProtocol(async () => manager as never)
    const handler = vi.mocked(protocol.handle).mock.calls.at(-1)?.[1]
    if (!handler) {
      throw new Error('protocol handler must be registered')
    }
    vi.mocked(net.fetch).mockClear()

    const getResponse = await handler(new Request('pi-webview-resource://host-style'))
    expect(getResponse.status).toBe(200)
    expect(getResponse.headers.get('Content-Type')).toBe('text/css; charset=utf-8')
    expect(getResponse.headers.get('Cache-Control')).toBe('no-store')
    expect(getResponse.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(getResponse.headers.get('Content-Length')).toBe(
      String(new TextEncoder().encode(':root { --pi-panel-scrollbar-thumb: red; }').byteLength)
    )
    expect(await getResponse.text()).toContain('--pi-panel-scrollbar-thumb')
    expect(net.fetch).not.toHaveBeenCalled()

    const headResponse = await handler(
      new Request('pi-webview-resource://host-style', { method: 'HEAD' })
    )
    expect(headResponse.status).toBe(200)
    expect(headResponse.headers.get('Content-Length')).toBe(
      String(new TextEncoder().encode(':root { --pi-panel-scrollbar-thumb: red; }').byteLength)
    )
    expect(await headResponse.text()).toBe('')
  })

  it('资源 handler 对非法 method、token 和缺失文件返回明确状态', async () => {
    const diagnostics: unknown[] = []
    const manager = {
      getStore: vi.fn(() => ({
        recordDiagnostic: vi.fn((record: unknown) => diagnostics.push(record))
      })),
      resolveExtensionWebviewResource: vi
        .fn()
        .mockImplementation((token: string) =>
          token === 'missing'
            ? { token: 'missing', path: '/no/such/file.js', threadId: 'thread-a' }
            : undefined
        )
    }

    registerWebviewResourceProtocol(async () => manager as never)
    const handler = vi.mocked(protocol.handle).mock.calls.at(-1)?.[1]
    if (!handler) {
      throw new Error('protocol handler must be registered')
    }

    expect(
      (await handler(new Request('pi-webview-resource://token-a', { method: 'POST' }))).status
    ).toBe(405)
    expect((await handler(new Request('pi-webview-resource:///'))).status).toBe(400)
    expect((await handler(new Request('pi-webview-resource://missing'))).status).toBe(404)
    expect(diagnostics).toMatchObject([
      {
        id: 'webview-resource:method_not_allowed:global:token-a:POST',
        source: 'webview_resource',
        severity: 'warning',
        message: 'Webview resource request used an unsupported method',
        details: { status: 405, method: 'POST', reason: 'method_not_allowed', token: 'token-a' }
      },
      {
        id: 'webview-resource:invalid_url:global:no-token:GET',
        source: 'webview_resource',
        severity: 'warning',
        message: 'Webview resource request used an invalid URL',
        details: { status: 400, method: 'GET', reason: 'invalid_url' }
      },
      {
        id: 'webview-resource:file_not_found:thread-a:missing:GET',
        threadId: 'thread-a',
        source: 'webview_resource',
        severity: 'warning',
        message: 'Webview resource file is no longer available',
        details: {
          status: 404,
          method: 'GET',
          reason: 'file_not_found',
          token: 'missing',
          threadId: 'thread-a'
        }
      }
    ])
    expect(JSON.stringify(diagnostics)).not.toContain('/no/such/file.js')
  })

  it('资源 handler 对 fetch 失败返回受控错误并写入诊断', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'webview-resource-fetch-failed-'))
    try {
      const filePath = path.join(root, 'panel.js')
      writeFileSync(filePath, 'window.app = true', 'utf8')
      const diagnostics: unknown[] = []
      const manager = {
        getStore: vi.fn(() => ({
          recordDiagnostic: vi.fn((record: unknown) => diagnostics.push(record))
        })),
        resolveExtensionWebviewResource: vi.fn().mockReturnValue({
          token: 'token-a',
          path: filePath,
          threadId: 'thread-a'
        })
      }

      registerWebviewResourceProtocol(async () => manager as never)
      const handler = vi.mocked(protocol.handle).mock.calls.at(-1)?.[1]
      if (!handler) {
        throw new Error('protocol handler must be registered')
      }

      vi.mocked(net.fetch).mockResolvedValueOnce(new Response('failed', { status: 500 }))
      expect((await handler(new Request('pi-webview-resource://token-a'))).status).toBe(500)

      vi.mocked(net.fetch).mockResolvedValueOnce(new Response(null, { status: 200 }))
      expect((await handler(new Request('pi-webview-resource://token-a'))).status).toBe(502)

      vi.mocked(net.fetch).mockRejectedValueOnce(new Error('disk read failed'))
      expect((await handler(new Request('pi-webview-resource://token-a'))).status).toBe(502)

      expect(diagnostics).toMatchObject([
        {
          id: 'webview-resource:fetch_failed:thread-a:token-a:GET',
          threadId: 'thread-a',
          source: 'webview_resource',
          severity: 'error',
          message: 'Webview resource could not be loaded by the host',
          details: {
            status: 500,
            method: 'GET',
            reason: 'fetch_failed',
            token: 'token-a',
            threadId: 'thread-a'
          }
        },
        {
          id: 'webview-resource:fetch_failed:thread-a:token-a:GET',
          threadId: 'thread-a',
          source: 'webview_resource',
          severity: 'error',
          message: 'Webview resource could not be loaded by the host',
          details: {
            status: 502,
            method: 'GET',
            reason: 'fetch_failed',
            token: 'token-a',
            threadId: 'thread-a'
          }
        },
        {
          id: 'webview-resource:fetch_failed:thread-a:token-a:GET',
          threadId: 'thread-a',
          source: 'webview_resource',
          severity: 'error',
          message: 'Webview resource could not be loaded by the host',
          details: {
            status: 502,
            method: 'GET',
            reason: 'fetch_failed',
            token: 'token-a',
            threadId: 'thread-a'
          }
        }
      ])
      expect(JSON.stringify(diagnostics)).not.toContain(filePath)
      expect(JSON.stringify(diagnostics)).not.toContain('disk read failed')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
