import { describe, expect, it } from 'vitest'
import {
  BROWSER_SNAPSHOT_CONTEXT_BUDGET_BYTES,
  browserSnapshotSerializedBytes,
  compactBrowserSnapshot,
  DEFAULT_BROWSER_SNAPSHOT_LIMIT,
  MAX_BROWSER_SNAPSHOT_LIMIT,
  resolveBrowserSnapshotOptions,
  type BrowserSnapshotElement,
  type BrowserSnapshotResult
} from '../browserSnapshot'

function element(index: number): BrowserSnapshotElement {
  return {
    ref: `ref-${index}`,
    tagName: 'button',
    text: `Button ${index} ${'x'.repeat(200)}`,
    bounds: { x: index, y: index * 2, width: 100, height: 32 },
    accessibility: { role: 'button', name: `Action ${index} ${'y'.repeat(200)}` },
    state: { disabled: false, checked: null, expanded: null },
    inViewport: index < 10
  }
}

function snapshot(count: number): BrowserSnapshotResult {
  return {
    url: 'https://example.com/',
    title: 'Example',
    viewport: { width: 1280, height: 800, dpr: 1 },
    touch: 0,
    userAgent: 'Test',
    text: 'Body '.repeat(2000),
    interactive: Array.from({ length: count }, (_, index) => element(index + 1)),
    page: {
      total: count,
      eligible: count,
      scanned: count,
      returned: count,
      offset: 0,
      truncated: false,
      hiddenExcluded: 0,
      scanTruncated: false
    },
    emulation: { enabled: false },
    preset: 'desktop'
  }
}

describe('compact Browser snapshot', () => {
  it('uses bounded defaults and accepts explicit pagination options', () => {
    expect(resolveBrowserSnapshotOptions({})).toEqual({
      limit: DEFAULT_BROWSER_SNAPSHOT_LIMIT,
      offset: 0,
      includeHidden: false
    })
    expect(resolveBrowserSnapshotOptions({ limit: 999, offset: -5, includeHidden: true })).toEqual({
      limit: MAX_BROWSER_SNAPSHOT_LIMIT,
      offset: 0,
      includeHidden: true
    })
  })

  it('keeps the final Browser identity wrapper below the context budget', () => {
    const compact = compactBrowserSnapshot(snapshot(200))
    const wrapped = { ...compact, browserId: 'tab-12345678' }

    expect(browserSnapshotSerializedBytes(wrapped)).toBeLessThanOrEqual(
      BROWSER_SNAPSHOT_CONTEXT_BUDGET_BYTES
    )
    expect(compact.text).toHaveLength(10_000)
    expect(compact.interactive.length).toBeLessThan(200)
    expect(compact.page.returned).toBe(compact.interactive.length)
    expect(compact.page.truncated).toBe(true)
    expect(compact.interactive[0].text.length).toBeLessThanOrEqual(120)
    expect(compact.interactive[0].accessibility.name.length).toBeLessThanOrEqual(120)
  })

  it('preserves pagination metadata when the result already fits', () => {
    const compact = compactBrowserSnapshot({
      ...snapshot(2),
      text: 'Short body',
      page: {
        total: 300,
        eligible: 120,
        scanned: 300,
        returned: 2,
        offset: 50,
        truncated: true,
        hiddenExcluded: 180,
        scanTruncated: false
      }
    })

    expect(compact.interactive).toHaveLength(2)
    expect(compact.page).toEqual({
      total: 300,
      eligible: 120,
      scanned: 300,
      returned: 2,
      offset: 50,
      truncated: true,
      hiddenExcluded: 180,
      scanTruncated: false
    })
  })

  it('bounds oversized emulation metadata and multibyte content under the hard budget', () => {
    const compact = compactBrowserSnapshot({
      ...snapshot(20),
      url: `https://example.com/${'\u0000'.repeat(3000)}`,
      title: '\u{1F642}'.repeat(1000),
      text: '\u0000'.repeat(4000),
      userAgent: '\u{1F642}'.repeat(2000),
      emulation: {
        enabled: true,
        width: 390,
        height: 844,
        deviceScaleFactor: 3,
        mobile: true,
        touch: true,
        orientation: 'portrait',
        userAgent: 'x'.repeat(30 * 1024),
        platform: 'y'.repeat(30 * 1024),
        ignored: 'secret'.repeat(10_000)
      },
      preset: 'z'.repeat(30 * 1024)
    })

    expect(
      browserSnapshotSerializedBytes({ ...compact, browserId: 'tab-12345678' })
    ).toBeLessThanOrEqual(BROWSER_SNAPSHOT_CONTEXT_BUDGET_BYTES)
    expect(compact.emulation).not.toHaveProperty('ignored')
    expect((compact.emulation as { userAgent: string }).userAgent.length).toBeLessThanOrEqual(512)
    expect((compact.emulation as { platform: string }).platform.length).toBeLessThanOrEqual(128)
    expect(String(compact.preset)).toHaveLength(64)
    expect(compact.page.truncated).toBe(true)
  })
})
