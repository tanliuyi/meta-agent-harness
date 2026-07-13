import type {
  BrowserPreviewPermissionRequest,
  BrowserPreviewPermissionResponse
} from '@shared/browser-preview'

interface BrowserPermissionRequestHandlerOptions {
  subscribe: (
    listener: (request: BrowserPreviewPermissionRequest) => void | Promise<void>
  ) => () => void
  confirmRequest: (request: BrowserPreviewPermissionRequest) => boolean | Promise<boolean>
  respond: (response: BrowserPreviewPermissionResponse) => Promise<void>
}

export function registerBrowserPermissionRequestHandler(
  options: BrowserPermissionRequestHandlerOptions
): () => void {
  return options.subscribe(async (request) => {
    let allow = false
    try {
      allow = (await options.confirmRequest(request)) === true
    } catch {
      allow = false
    }
    await options.respond({ requestId: request.requestId, allow }).catch(() => undefined)
  })
}
