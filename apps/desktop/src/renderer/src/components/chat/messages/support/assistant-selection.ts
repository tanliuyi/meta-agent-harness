export interface SelectionRect {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

export interface SelectionToolbarPosition {
  left: number
  top: number
  below: boolean
}

const toolbarWidth = 112
const toolbarHeight = 32
const viewportMargin = 8
const selectionGap = 8

/** 计算选区工具条位置，并保证工具条完整留在视口内。 */
export function getSelectionToolbarPosition(
  rects: readonly SelectionRect[],
  viewportWidth: number,
  viewportHeight: number
): SelectionToolbarPosition | undefined {
  const visibleRects = rects.filter((rect) => rect.width > 0 && rect.height > 0)
  if (visibleRects.length === 0) return undefined

  const selectedWidth = visibleRects.reduce((total, rect) => total + rect.width, 0)
  const selectedCenter =
    visibleRects.reduce((total, rect) => total + (rect.left + rect.width / 2) * rect.width, 0) /
    selectedWidth
  const selectionTop = Math.min(...visibleRects.map((rect) => rect.top))
  const selectionBottom = Math.max(...visibleRects.map((rect) => rect.bottom))
  const spaceAbove = selectionTop - viewportMargin
  const spaceBelow = viewportHeight - selectionBottom - viewportMargin
  const below = spaceAbove < toolbarHeight && spaceBelow >= spaceAbove
  const rawTop = below ? selectionBottom + selectionGap : selectionTop - selectionGap
  const minTop = below ? viewportMargin : toolbarHeight + viewportMargin
  const maxTop = below
    ? Math.max(minTop, viewportHeight - toolbarHeight - viewportMargin)
    : Math.max(minTop, viewportHeight - viewportMargin)

  return {
    left: clamp(
      selectedCenter,
      toolbarWidth / 2 + viewportMargin,
      Math.max(toolbarWidth / 2 + viewportMargin, viewportWidth - toolbarWidth / 2 - viewportMargin)
    ),
    top: clamp(rawTop, minTop, maxTop),
    below
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}
