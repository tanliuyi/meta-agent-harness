import { measureNaturalWidth, prepareWithSegments } from '@chenglou/pretext'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { measureDiffContentWidth, parseDisplayDiff } from '../diffDisplay'

vi.mock('@chenglou/pretext', () => ({
  measureNaturalWidth: vi.fn((prepared: { text: string }) => prepared.text.length * 10),
  prepareWithSegments: vi.fn((text: string) => ({ text }))
}))

describe('diffDisplay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('解析带行号的 diff 展示行', () => {
    expect(parseDisplayDiff('+  12 new line\n-  13 old line\n  14 same line\n...')).toMatchObject({
      lines: [
        { kind: 'added', lineNumber: 12, marker: '+', text: 'new line' },
        { kind: 'removed', lineNumber: 13, marker: '-', text: 'old line' },
        { kind: 'context', lineNumber: 14, marker: '', text: 'same line' },
        { kind: 'skipped', marker: '', text: '...' }
      ]
    })
  })

  it('缓存相同字体和字距下的 diff 行宽测量', async () => {
    const style = createStyle({ font: '500 12px monospace', letterSpacing: '0px' })
    const parsed = parseDisplayDiff('+  1 repeat\n-  2 repeat\n  3 longest')

    await expect(measureDiffContentWidth(parsed.lines, style)).resolves.toBe(71)
    await expect(measureDiffContentWidth(parsed.lines, style)).resolves.toBe(71)

    expect(vi.mocked(prepareWithSegments)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(measureNaturalWidth)).toHaveBeenCalledTimes(2)
  })

  it('字体或字距变化时重新测量', async () => {
    const parsed = parseDisplayDiff('+  1 same')

    await measureDiffContentWidth(parsed.lines, createStyle({ font: '400 12px monospace' }))
    await measureDiffContentWidth(parsed.lines, createStyle({ font: '700 12px monospace' }))
    await measureDiffContentWidth(parsed.lines, createStyle({ letterSpacing: '1px' }))

    expect(vi.mocked(prepareWithSegments)).toHaveBeenCalledTimes(3)
  })
})

function createStyle(overrides: Partial<CSSStyleDeclaration> = {}): CSSStyleDeclaration {
  return {
    font: '',
    fontFamily: 'monospace',
    fontSize: '12px',
    fontStyle: 'normal',
    fontVariant: 'normal',
    fontWeight: '400',
    letterSpacing: '0px',
    ...overrides
  } as CSSStyleDeclaration
}
