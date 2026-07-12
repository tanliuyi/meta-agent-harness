/**
 * Main BrowserWindow navigation policy helpers.
 */

import { pathToFileURL } from 'node:url'

type MainWindowNavigationTarget =
  { type: 'origin'; origin: string } | { type: 'file'; hrefWithoutHash: string }

/**
 * Build the only allowed top-level navigation target for the main renderer window.
 */
export function createMainWindowNavigationTarget(input: {
  devRendererUrl?: string
  rendererIndexPath: string
}): MainWindowNavigationTarget {
  if (input.devRendererUrl) {
    const url = new URL(input.devRendererUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Invalid dev renderer URL protocol: ${url.protocol}`)
    }
    return { type: 'origin', origin: url.origin }
  }
  return {
    type: 'file',
    hrefWithoutHash: stripHash(pathToFileURL(input.rendererIndexPath).toString())
  }
}

/**
 * Check whether a top-level main-window navigation should keep preload access.
 */
export function isMainWindowNavigationAllowed(
  urlText: string,
  target: MainWindowNavigationTarget
): boolean {
  let url: URL
  try {
    url = new URL(urlText)
  } catch {
    return false
  }
  if (target.type === 'origin') {
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === target.origin
  }
  return url.protocol === 'file:' && stripHash(url.toString()) === target.hrefWithoutHash
}

/** Allow browser previews to navigate to uncredentialed web URLs only. */
export function isBrowserPreviewUrlAllowed(urlText: string): boolean {
  try {
    const url = new URL(urlText)
    if (url.username || url.password) return false
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function stripHash(urlText: string): string {
  const url = new URL(urlText)
  url.hash = ''
  return url.toString()
}
