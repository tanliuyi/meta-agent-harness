import { describe, expect, it } from 'vitest'
import { getSelectionToolbarPosition, type SelectionRect } from '../support/assistant-selection'

function rect(left: number, top: number, width: number, height: number): SelectionRect {
  return {
    left,
    right: left + width,
    top,
    bottom: top + height,
    width,
    height
  }
}

describe('assistant selection toolbar', () => {
  it('places the toolbar above an ordinary selection', () => {
    expect(getSelectionToolbarPosition([rect(100, 200, 80, 20)], 800, 600)).toEqual({
      left: 140,
      top: 192,
      below: false
    })
  })

  it('keeps the toolbar visible for a selection spanning the viewport', () => {
    const position = getSelectionToolbarPosition([rect(20, 0, 760, 598)], 800, 600)

    expect(position).toEqual({ left: 400, top: 560, below: true })
  })

  it('uses the space below and clamps horizontal edges when the selection is near the top', () => {
    expect(getSelectionToolbarPosition([rect(0, 2, 20, 12)], 320, 480)).toEqual({
      left: 64,
      top: 22,
      below: true
    })
  })

  it('returns undefined for an empty visual selection', () => {
    expect(getSelectionToolbarPosition([rect(10, 10, 0, 0)], 320, 480)).toBeUndefined()
  })
})
