import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  configureBrowserPreviewPermissions,
  reloadBrowserPreviewPermissionGuests,
  type BrowserPreviewPermissionController,
  type BrowserPreviewPermissionModeChange,
  type ConfirmBrowserPreviewPermission
} from '../browser-preview-permissions'
import type { BrowserWebPermissionMode } from '../../shared/coding-agent/types'

type PermissionRequestHandler = (
  webContents: unknown,
  permission: string,
  callback: (granted: boolean) => void,
  details: { requestingUrl?: string }
) => void
type PermissionCheckHandler = (
  webContents: unknown,
  permission: string,
  requestingOrigin: string,
  details: unknown
) => boolean

interface PolicyHarness {
  confirmPermission: Mock<ConfirmBrowserPreviewPermission>
  controller: BrowserPreviewPermissionController
  onModeChanged: Mock<(change: BrowserPreviewPermissionModeChange) => void>
  requestHandler: PermissionRequestHandler
  checkHandler: PermissionCheckHandler
}

function createPolicy(
  initialMode: BrowserWebPermissionMode,
  confirmPermission: Mock<ConfirmBrowserPreviewPermission> = vi.fn(async () => false),
  onModeChanged: Mock<(change: BrowserPreviewPermissionModeChange) => void> = vi.fn()
): PolicyHarness {
  const setPermissionRequestHandler = vi.fn()
  const setPermissionCheckHandler = vi.fn()

  const controller = configureBrowserPreviewPermissions(
    {
      setPermissionRequestHandler,
      setPermissionCheckHandler
    } as never,
    initialMode,
    confirmPermission,
    onModeChanged
  )

  return {
    confirmPermission,
    controller,
    onModeChanged,
    requestHandler: setPermissionRequestHandler.mock.calls[0]?.[0] as PermissionRequestHandler,
    checkHandler: setPermissionCheckHandler.mock.calls[0]?.[0] as PermissionCheckHandler
  }
}

function requestDetails(requestingUrl: string): { isMainFrame: boolean; requestingUrl: string } {
  return { isMainFrame: true, requestingUrl }
}

describe('Browser Preview permission policy', () => {
  it('权限降级只重载目标 partition 的存活 Browser webview', () => {
    const targetSession = {}
    const targetReload = vi.fn()
    const laterTargetReload = vi.fn()
    const reloadError = new Error('reload failed')
    const onReloadError = vi.fn()
    const contents = [
      createWebContents('webview', targetSession, false, targetReload),
      createWebContents('window', targetSession, false, vi.fn()),
      createWebContents('webview', {}, false, vi.fn()),
      createWebContents('webview', targetSession, true, vi.fn()),
      createWebContents('webview', targetSession, false, () => {
        throw reloadError
      }),
      createWebContents('webview', targetSession, false, laterTargetReload)
    ]

    reloadBrowserPreviewPermissionGuests(contents as never[], targetSession as never, onReloadError)

    expect(targetReload).toHaveBeenCalledTimes(1)
    expect(laterTargetReload).toHaveBeenCalledTimes(1)
    expect(onReloadError).toHaveBeenCalledWith(reloadError)
  })

  it('disabled 模式拒绝请求与检查且不弹窗', () => {
    const policy = createPolicy('disabled')
    const callback = vi.fn()

    policy.requestHandler(
      undefined,
      'media',
      callback,
      requestDetails('https://example.com/camera')
    )
    expect(callback).toHaveBeenCalledWith(false)
    expect(policy.checkHandler(undefined, 'geolocation', 'https://example.com', {})).toBe(false)
    expect(policy.confirmPermission).not.toHaveBeenCalled()
  })

  it('full 模式对合法来源的全部权限请求与检查直接放行', () => {
    const policy = createPolicy('full')
    const callback = vi.fn()

    policy.requestHandler(undefined, 'unknown', callback, requestDetails('https://example.com/app'))

    expect(callback).toHaveBeenCalledWith(true)
    expect(policy.checkHandler(undefined, 'fileSystem', 'http://localhost:5173', {})).toBe(true)
    expect(policy.confirmPermission).not.toHaveBeenCalled()
  })

  it('disabled 切换到 prompt 后重新询问网页权限', async () => {
    const policy = createPolicy(
      'disabled',
      vi.fn(async () => true)
    )
    const disabledCallback = vi.fn()

    policy.requestHandler(
      undefined,
      'media',
      disabledCallback,
      requestDetails('https://example.com/camera')
    )
    expect(disabledCallback).toHaveBeenCalledWith(false)
    expect(policy.confirmPermission).not.toHaveBeenCalled()

    policy.controller.updateMode('prompt')
    const promptCallback = vi.fn()
    policy.requestHandler(
      undefined,
      'media',
      promptCallback,
      requestDetails('https://example.com/camera')
    )

    await vi.waitFor(() => expect(promptCallback).toHaveBeenCalledWith(true))
    expect(policy.confirmPermission).toHaveBeenCalledTimes(1)
  })

  it('prompt 模式合并同源同权限的并发确认并共享 grant 决策', async () => {
    let resolveConfirmation: (decision: boolean) => void = () => undefined
    const confirmPermission = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirmation = resolve
        })
    )
    const policy = createPolicy('prompt', confirmPermission)
    const firstCallback = vi.fn()
    const secondCallback = vi.fn()

    policy.requestHandler(
      undefined,
      'media',
      firstCallback,
      requestDetails('https://example.com/first')
    )
    policy.requestHandler(
      undefined,
      'media',
      secondCallback,
      requestDetails('https://example.com/second')
    )

    await Promise.resolve()
    expect(confirmPermission).toHaveBeenCalledTimes(1)
    expect(confirmPermission).toHaveBeenCalledWith({
      origin: 'https://example.com',
      permission: 'media'
    })
    expect(policy.checkHandler(undefined, 'media', 'https://example.com', {})).toBe(false)

    resolveConfirmation(true)
    await Promise.resolve()
    await Promise.resolve()

    expect(firstCallback).toHaveBeenCalledWith(true)
    expect(secondCallback).toHaveBeenCalledWith(true)
    expect(policy.checkHandler(undefined, 'media', 'https://example.com', {})).toBe(true)

    const rememberedCallback = vi.fn()
    policy.requestHandler(
      undefined,
      'media',
      rememberedCallback,
      requestDetails('https://example.com/later')
    )
    await Promise.resolve()
    expect(rememberedCallback).toHaveBeenCalledWith(true)
    expect(confirmPermission).toHaveBeenCalledTimes(1)
  })

  it('prompt 模式按 origin 与 permission 分别记忆 deny 决策', async () => {
    const confirmPermission = vi.fn(async () => false)
    const policy = createPolicy('prompt', confirmPermission)
    const firstCallback = vi.fn()

    policy.requestHandler(
      undefined,
      'geolocation',
      firstCallback,
      requestDetails('https://example.com/location')
    )
    await vi.waitFor(() => expect(firstCallback).toHaveBeenCalledWith(false))

    const rememberedCallback = vi.fn()
    policy.requestHandler(
      undefined,
      'geolocation',
      rememberedCallback,
      requestDetails('https://example.com/again')
    )
    await vi.waitFor(() => expect(rememberedCallback).toHaveBeenCalledWith(false))
    expect(policy.checkHandler(undefined, 'geolocation', 'https://example.com', {})).toBe(false)
    expect(confirmPermission).toHaveBeenCalledTimes(1)

    const notificationsCallback = vi.fn()
    const otherOriginCallback = vi.fn()
    policy.requestHandler(
      undefined,
      'notifications',
      notificationsCallback,
      requestDetails('https://example.com/notifications')
    )
    policy.requestHandler(
      undefined,
      'geolocation',
      otherOriginCallback,
      requestDetails('https://other.example/location')
    )
    await vi.waitFor(() => expect(confirmPermission).toHaveBeenCalledTimes(3))
    await vi.waitFor(() => expect(notificationsCallback).toHaveBeenCalledWith(false))
    expect(otherOriginCallback).toHaveBeenCalledWith(false)
  })

  it('prompt 切换到 disabled 再恢复后清除旧决定并重新询问', async () => {
    const policy = createPolicy(
      'prompt',
      vi.fn(async () => true)
    )
    const firstCallback = vi.fn()

    policy.requestHandler(
      undefined,
      'geolocation',
      firstCallback,
      requestDetails('https://example.com/location')
    )
    await vi.waitFor(() => expect(firstCallback).toHaveBeenCalledWith(true))
    expect(policy.checkHandler(undefined, 'geolocation', 'https://example.com', {})).toBe(true)

    policy.controller.updateMode('disabled')
    expect(policy.checkHandler(undefined, 'geolocation', 'https://example.com', {})).toBe(false)
    policy.controller.updateMode('prompt')
    expect(policy.checkHandler(undefined, 'geolocation', 'https://example.com', {})).toBe(false)

    const secondCallback = vi.fn()
    policy.requestHandler(
      undefined,
      'geolocation',
      secondCallback,
      requestDetails('https://example.com/location')
    )
    await vi.waitFor(() => expect(secondCallback).toHaveBeenCalledWith(true))
    expect(policy.confirmPermission).toHaveBeenCalledTimes(2)
  })

  it('prompt 模式串行显示不同权限的应用内确认', async () => {
    const confirmationResolvers: Array<(decision: boolean) => void> = []
    const confirmPermission = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          confirmationResolvers.push(resolve)
        })
    )
    const policy = createPolicy('prompt', confirmPermission)
    const mediaCallback = vi.fn()
    const geolocationCallback = vi.fn()

    policy.requestHandler(
      undefined,
      'media',
      mediaCallback,
      requestDetails('https://example.com/camera')
    )
    policy.requestHandler(
      undefined,
      'geolocation',
      geolocationCallback,
      requestDetails('https://example.com/location')
    )

    await Promise.resolve()
    expect(confirmPermission).toHaveBeenCalledTimes(1)
    confirmationResolvers[0]?.(true)
    await vi.waitFor(() => expect(confirmPermission).toHaveBeenCalledTimes(2))
    confirmationResolvers[1]?.(false)
    await vi.waitFor(() => expect(mediaCallback).toHaveBeenCalledWith(true))
    await vi.waitFor(() => expect(geolocationCallback).toHaveBeenCalledWith(false))
  })

  it('等待确认期间切换模式会立即 fail closed，旧确认不能恢复授权', async () => {
    let resolveConfirmation: (decision: boolean) => void = () => undefined
    const policy = createPolicy(
      'prompt',
      vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveConfirmation = resolve
          })
      )
    )
    const callback = vi.fn()

    policy.requestHandler(
      undefined,
      'media',
      callback,
      requestDetails('https://example.com/camera')
    )
    await Promise.resolve()
    policy.controller.updateMode('full')
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(false))
    resolveConfirmation(true)
    await Promise.resolve()
    await Promise.resolve()

    expect(policy.checkHandler(undefined, 'media', 'https://example.com', {})).toBe(true)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('权限降级触发 guest reload，升级与相同模式更新不触发', () => {
    const guest = { reload: vi.fn() }
    const onModeChanged = vi.fn((change: BrowserPreviewPermissionModeChange) => {
      if (change.downgraded) guest.reload()
    })
    const policy = createPolicy(
      'disabled',
      vi.fn(async () => false),
      onModeChanged
    )

    policy.controller.updateMode('prompt')
    policy.controller.updateMode('full')
    expect(guest.reload).not.toHaveBeenCalled()

    policy.controller.updateMode('prompt')
    policy.controller.updateMode('disabled')
    expect(guest.reload).toHaveBeenCalledTimes(2)
    expect(onModeChanged).toHaveBeenNthCalledWith(3, {
      previousMode: 'full',
      mode: 'prompt',
      downgraded: true
    })
    expect(onModeChanged).toHaveBeenNthCalledWith(4, {
      previousMode: 'prompt',
      mode: 'disabled',
      downgraded: true
    })

    policy.controller.updateMode('disabled')
    expect(onModeChanged).toHaveBeenCalledTimes(4)
    expect(guest.reload).toHaveBeenCalledTimes(2)

    policy.controller.updateMode('full')
    policy.controller.updateMode('disabled')
    expect(guest.reload).toHaveBeenCalledTimes(3)
    expect(onModeChanged).toHaveBeenLastCalledWith({
      previousMode: 'full',
      mode: 'disabled',
      downgraded: true
    })
  })

  it('所有模式都拒绝非法 URL、origin 与 permission 输入', () => {
    const policy = createPolicy('full')
    const invalidUrlCallback = vi.fn()
    const credentialUrlCallback = vi.fn()
    const invalidPermissionCallback = vi.fn()

    policy.requestHandler(
      undefined,
      'media',
      invalidUrlCallback,
      requestDetails('file:///tmp/page.html')
    )
    policy.requestHandler(
      undefined,
      'media',
      credentialUrlCallback,
      requestDetails('https://user:pass@example.com/')
    )
    policy.requestHandler(
      undefined,
      'media\nnotifications',
      invalidPermissionCallback,
      requestDetails('https://example.com/')
    )

    expect(invalidUrlCallback).toHaveBeenCalledWith(false)
    expect(credentialUrlCallback).toHaveBeenCalledWith(false)
    expect(invalidPermissionCallback).toHaveBeenCalledWith(false)
    expect(policy.checkHandler(undefined, 'media', 'not-a-url', {})).toBe(false)
    expect(policy.checkHandler(undefined, 'media', 'https://example.com/path', {})).toBe(false)
    expect(policy.checkHandler(undefined, 'media', 'https://example.com/?query=1', {})).toBe(false)
    expect(policy.checkHandler(undefined, '', 'https://example.com', {})).toBe(false)
    expect(policy.confirmPermission).not.toHaveBeenCalled()
  })

  it('应用内确认异常按 deny 记忆且不会产生未处理拒绝', async () => {
    const confirmPermission = vi.fn(async () => {
      throw new Error('dialog unavailable')
    })
    const policy = createPolicy('prompt', confirmPermission)
    const callback = vi.fn()

    policy.requestHandler(
      undefined,
      'notifications',
      callback,
      requestDetails('https://example.com/')
    )
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(false))
    expect(policy.checkHandler(undefined, 'notifications', 'https://example.com', {})).toBe(false)

    policy.requestHandler(
      undefined,
      'notifications',
      vi.fn(),
      requestDetails('https://example.com/again')
    )
    await Promise.resolve()
    expect(confirmPermission).toHaveBeenCalledTimes(1)
  })
})

function createWebContents(
  type: string,
  targetSession: object,
  destroyed: boolean,
  reload: () => void
): { getType: () => string; isDestroyed: () => boolean; reload: () => void; session: object } {
  return {
    getType: () => type,
    isDestroyed: () => destroyed,
    reload,
    session: targetSession
  }
}
