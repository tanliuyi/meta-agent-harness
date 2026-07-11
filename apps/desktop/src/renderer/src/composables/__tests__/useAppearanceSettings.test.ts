import { describe, expect, it } from 'vitest'
import {
  CODE_FONT_SIZE_RANGE,
  normalizeCustomFontFamily,
  normalizeFontSize,
  UI_FONT_SIZE_RANGE
} from '../useAppearanceSettings'

describe('normalizeFontSize', () => {
  it('returns default value for null, undefined or empty string', () => {
    expect(normalizeFontSize(null, UI_FONT_SIZE_RANGE)).toBe(UI_FONT_SIZE_RANGE.defaultValue)
    expect(normalizeFontSize(undefined, UI_FONT_SIZE_RANGE)).toBe(UI_FONT_SIZE_RANGE.defaultValue)
    expect(normalizeFontSize('', UI_FONT_SIZE_RANGE)).toBe(UI_FONT_SIZE_RANGE.defaultValue)
    expect(normalizeFontSize(null, CODE_FONT_SIZE_RANGE)).toBe(CODE_FONT_SIZE_RANGE.defaultValue)
    expect(normalizeFontSize(undefined, CODE_FONT_SIZE_RANGE)).toBe(
      CODE_FONT_SIZE_RANGE.defaultValue
    )
    expect(normalizeFontSize('', CODE_FONT_SIZE_RANGE)).toBe(CODE_FONT_SIZE_RANGE.defaultValue)
  })

  it('parses valid strings and numbers', () => {
    expect(normalizeFontSize('15', UI_FONT_SIZE_RANGE)).toBe(15)
    expect(normalizeFontSize(15, UI_FONT_SIZE_RANGE)).toBe(15)
    expect(normalizeFontSize('16', CODE_FONT_SIZE_RANGE)).toBe(16)
    expect(normalizeFontSize(16, CODE_FONT_SIZE_RANGE)).toBe(16)
  })

  it('clamps values below the minimum to the minimum', () => {
    expect(normalizeFontSize(0, UI_FONT_SIZE_RANGE)).toBe(11)
    expect(normalizeFontSize(8, UI_FONT_SIZE_RANGE)).toBe(11)
    expect(normalizeFontSize('0', CODE_FONT_SIZE_RANGE)).toBe(11)
  })

  it('clamps values above the maximum to the maximum', () => {
    expect(normalizeFontSize(20, UI_FONT_SIZE_RANGE)).toBe(16)
    expect(normalizeFontSize(30, CODE_FONT_SIZE_RANGE)).toBe(18)
  })

  it('rounds decimal values', () => {
    expect(normalizeFontSize(13.4, UI_FONT_SIZE_RANGE)).toBe(13)
    expect(normalizeFontSize(13.5, UI_FONT_SIZE_RANGE)).toBe(14)
  })

  it('falls back to default for non-numeric values', () => {
    expect(normalizeFontSize('abc', UI_FONT_SIZE_RANGE)).toBe(UI_FONT_SIZE_RANGE.defaultValue)
    expect(normalizeFontSize(NaN, CODE_FONT_SIZE_RANGE)).toBe(CODE_FONT_SIZE_RANGE.defaultValue)
  })
})

describe('normalizeCustomFontFamily', () => {
  it('保留合法字体栈并移除危险字符', () => {
    expect(normalizeCustomFontFamily(' Inter, "Source Han Sans SC", sans-serif ')).toBe(
      'Inter, "Source Han Sans SC", sans-serif'
    )
    expect(normalizeCustomFontFamily('Inter; color: red\n{}<>')).toBe('Inter color: red')
  })

  it('非字符串输入回退为空值', () => {
    expect(normalizeCustomFontFamily(undefined)).toBe('')
    expect(normalizeCustomFontFamily(42)).toBe('')
  })
})

describe('font size ranges', () => {
  it('has the expected default UI font size', () => {
    expect(UI_FONT_SIZE_RANGE.defaultValue).toBe(14)
  })

  it('has the expected default code font size', () => {
    expect(CODE_FONT_SIZE_RANGE.defaultValue).toBe(13)
  })
})
