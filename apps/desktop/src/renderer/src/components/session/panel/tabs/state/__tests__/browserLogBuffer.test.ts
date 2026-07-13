import { describe, expect, it } from 'vitest'
import {
  appendBoundedBrowserLog,
  clearBoundedBrowserLogs,
  createBrowserLogBudgetState,
  MAX_BROWSER_LOG_BUFFER_BYTES,
  MAX_BROWSER_LOG_MESSAGE_BYTES,
  MAX_BROWSER_LOG_SOURCE_BYTES,
  serializedBrowserLogBytes,
  type BrowserLogEntry
} from '../browserLogBuffer'

describe('Browser log buffer', () => {
  it('bounds individual multibyte message and source fields', () => {
    const entries: BrowserLogEntry[] = []
    const budget = createBrowserLogBudgetState()

    appendBoundedBrowserLog(entries, budget, {
      level: 'info',
      message: '\u{1F642}'.repeat(20_000),
      source: '\u{1F642}'.repeat(5_000),
      line: 10
    })

    const encoder = new TextEncoder()
    expect(encoder.encode(entries[0]!.message).byteLength).toBeLessThanOrEqual(
      MAX_BROWSER_LOG_MESSAGE_BYTES
    )
    expect(encoder.encode(entries[0]!.source!).byteLength).toBeLessThanOrEqual(
      MAX_BROWSER_LOG_SOURCE_BYTES
    )
  })

  it('evicts old entries to stay within the total byte budget', () => {
    const entries: BrowserLogEntry[] = []
    const budget = createBrowserLogBudgetState()
    for (let index = 0; index < 100; index += 1) {
      appendBoundedBrowserLog(entries, budget, {
        level: 'error',
        message: `${index}:${'x'.repeat(MAX_BROWSER_LOG_MESSAGE_BYTES)}`
      })
    }

    expect(entries.length).toBeLessThan(100)
    expect(budget.bufferedBytes).toBeLessThanOrEqual(MAX_BROWSER_LOG_BUFFER_BYTES)
    expect(serializedBrowserLogBytes(entries)).toBeLessThanOrEqual(
      MAX_BROWSER_LOG_BUFFER_BYTES + 1024
    )
    expect(entries.at(-1)?.message).toContain('99:')
  })

  it('clears entries and accounting together', () => {
    const entries: BrowserLogEntry[] = []
    const budget = createBrowserLogBudgetState()
    appendBoundedBrowserLog(entries, budget, { level: 'info', message: 'ready' })

    clearBoundedBrowserLogs(entries, budget)

    expect(entries).toEqual([])
    expect(budget).toEqual({ bufferedBytes: 0, entrySizes: [] })
  })
})
