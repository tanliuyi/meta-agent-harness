/**
 * useSelectContentWidth.test.ts - Select content width fallback tests.
 */

import { describe, expect, it } from 'vitest'
import { estimateWidestSelectTextWidth } from '../useSelectContentWidth'

describe('estimateWidestSelectTextWidth', () => {
  it('uses the widest label for fallback width', () => {
    const width = estimateWidestSelectTextWidth(['yyq', 'qicxcx', 'meta-agent-v1'], 14)

    expect(width).toBeGreaterThan(estimateWidestSelectTextWidth(['yyq', 'qicxcx'], 14))
    expect(width).toBeGreaterThan(80)
  })

  it('counts CJK text wider than narrow punctuation', () => {
    expect(estimateWidestSelectTextWidth(['项目设置'], 14)).toBeGreaterThan(
      estimateWidestSelectTextWidth(['....'], 14)
    )
  })
})
