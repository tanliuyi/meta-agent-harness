import type { WebContents } from 'electron'

export interface WebContentsLifetime {
  signal: AbortSignal
  dispose: () => void
}

/**
 * 将一次 renderer 文档生命周期投影为 AbortSignal；主文档 reload/navigation 即失效。
 */
export function createWebContentsLifetime(webContents: WebContents): WebContentsLifetime {
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  const handleNavigation: Parameters<WebContents['on']>[1] = (event: unknown): void => {
    const details = event as { isMainFrame?: boolean; isSameDocument?: boolean }
    if (details.isMainFrame && !details.isSameDocument) {
      abort()
    }
  }
  const dispose = (): void => {
    webContents.off('destroyed', abort)
    webContents.off('render-process-gone', abort)
    webContents.off('did-start-navigation', handleNavigation as never)
  }

  webContents.once('destroyed', abort)
  webContents.once('render-process-gone', abort)
  webContents.on('did-start-navigation', handleNavigation as never)
  if (webContents.isDestroyed()) {
    abort()
  }
  return { signal: controller.signal, dispose }
}
