import { describe, expect, it, vi } from 'vitest'
import type { BrowserPreviewPermissionRequest } from '@shared/browser-preview'
import { registerBrowserPermissionRequestHandler } from '../browserPermissionRequestHandler'

describe('Browser permission request handler', () => {
  it.each([
    { confirmed: true, allow: true },
    { confirmed: false, allow: false }
  ])('把应用内确认结果回传给 main: $confirmed', async ({ confirmed, allow }) => {
    let listener: ((request: BrowserPreviewPermissionRequest) => Promise<void>) | undefined
    const unsubscribe = vi.fn()
    const respond = vi.fn(async () => undefined)
    const stop = registerBrowserPermissionRequestHandler({
      subscribe: (nextListener) => {
        listener = nextListener as (request: BrowserPreviewPermissionRequest) => Promise<void>
        return unsubscribe
      },
      confirmRequest: vi.fn(async () => confirmed),
      respond
    })

    await listener?.(createRequest())

    expect(respond).toHaveBeenCalledWith({ requestId: 'permission-1', allow })
    stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('应用内确认异常时 fail closed，响应 IPC 失败不产生未处理拒绝', async () => {
    let listener: ((request: BrowserPreviewPermissionRequest) => Promise<void>) | undefined
    const respond = vi.fn(async () => {
      throw new Error('request expired')
    })
    registerBrowserPermissionRequestHandler({
      subscribe: (nextListener) => {
        listener = nextListener as (request: BrowserPreviewPermissionRequest) => Promise<void>
        return vi.fn()
      },
      confirmRequest: vi.fn(async () => {
        throw new Error('dialog closed')
      }),
      respond
    })

    await expect(listener?.(createRequest())).resolves.toBeUndefined()
    expect(respond).toHaveBeenCalledWith({ requestId: 'permission-1', allow: false })
  })
})

function createRequest(): BrowserPreviewPermissionRequest {
  return {
    requestId: 'permission-1',
    origin: 'https://example.com',
    permission: 'media'
  }
}
