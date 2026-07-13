/**
 * Shared validation for URLs handed to the operating system.
 */

import type { DesktopCapabilityAccessMode } from '@shared/coding-agent/types'

const allowedExternalProtocols = new Set(['http:', 'https:', 'mailto:'])

/**
 * Normalize and validate an external URL before passing it to shell.openExternal.
 */
export function normalizeAllowedExternalUrl(
  uriInput: string,
  accessMode: DesktopCapabilityAccessMode = 'safe'
): string {
  const uri = uriInput.trim()
  if (!uri) {
    throw new Error('Invalid external URL')
  }
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    throw new Error('Invalid external URL')
  }
  if (accessMode !== 'full' && !allowedExternalProtocols.has(url.protocol)) {
    throw new Error(`External URL protocol is not allowed: ${url.protocol}`)
  }
  return url.toString()
}
