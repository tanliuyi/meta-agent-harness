import { describe, expect, it } from 'vitest'
import {
  assertBrowserCommandResultBudget,
  estimateStructuredValueBytes
} from '../browserCommandBudget'

describe('Browser command result budget', () => {
  it('accepts normal structured results and rejects oversized evaluation values', () => {
    expect(() =>
      assertBrowserCommandResultBudget('execute-js', { value: 'ready', nested: [1, 2, 3] })
    ).not.toThrow()
    expect(() =>
      assertBrowserCommandResultBudget('execute-js', { value: 'x'.repeat(600 * 1024) })
    ).toThrow('result exceeds the byte budget')
  })

  it('uses a larger bounded envelope for screenshots', () => {
    expect(() =>
      assertBrowserCommandResultBudget('screenshot', {
        dataUrl: `data:image/png;base64,${'a'.repeat(1024 * 1024)}`
      })
    ).not.toThrow()
    expect(() =>
      assertBrowserCommandResultBudget('screenshot', {
        dataUrl: `data:image/png;base64,${'a'.repeat(29 * 1024 * 1024)}`
      })
    ).toThrow('result exceeds the byte budget')
  })

  it('handles cycles without recursing indefinitely', () => {
    const value: Record<string, unknown> = {}
    value.self = value
    expect(estimateStructuredValueBytes(value, 1024)).toBeLessThan(1024)
  })
})
