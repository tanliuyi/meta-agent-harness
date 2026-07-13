import { describe, expect, it } from 'vitest'
import {
  browserPreviewChannels,
  browserPreviewPartition,
  validateBrowserPreviewEmulation
} from '../browser-preview'

const iphone = {
  enabled: true,
  width: 393,
  height: 852,
  deviceScaleFactor: 3,
  mobile: true,
  touch: true,
  orientation: 'portrait' as const,
  userAgent: 'Mobile Safari',
  platform: 'iPhone'
}

describe('browser preview emulation contract', () => {
  it('provides a persistent shared guest partition and tab open request channel', () => {
    expect(browserPreviewPartition).toBe('persist:browser-preview')
    expect(browserPreviewChannels.openRequested).toBe('browser-preview:open-requested')
    expect(browserPreviewChannels.sendCdpCommand).toBe('browser-preview:send-cdp-command')
    expect(browserPreviewChannels.readCdpEvents).toBe('browser-preview:read-cdp-events')
  })

  it('accepts bounded mobile device metrics', () => {
    expect(validateBrowserPreviewEmulation(iphone)).toEqual(iphone)
  })

  it.each([
    undefined,
    {},
    { ...iphone, width: 239 },
    { ...iphone, height: 2561 },
    { ...iphone, deviceScaleFactor: 0 },
    { ...iphone, orientation: 'upside-down' },
    { ...iphone, touch: 'yes' },
    { ...iphone, userAgent: 42 },
    { ...iphone, userAgent: 'x'.repeat(513) },
    { ...iphone, platform: 'x'.repeat(129) }
  ])('rejects unsafe or malformed metrics %#', (value) => {
    expect(() => validateBrowserPreviewEmulation(value)).toThrow('Invalid browser device emulation')
  })
})
