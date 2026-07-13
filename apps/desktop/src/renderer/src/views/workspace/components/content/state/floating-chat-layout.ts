export interface FloatingChatPoint {
  x: number
  y: number
}

export interface FloatingChatSize {
  height: number
  width: number
}

export interface FloatingChatResizeLimits {
  maxHeight: number
  maxWidth: number
  minHeight: number
  minWidth: number
}

export const FLOATING_CHAT_MARGIN = 12
export const FLOATING_CHAT_MIN_HEIGHT = 320
export const FLOATING_CHAT_MIN_WIDTH = 340
export const FLOATING_CHAT_KEYBOARD_STEP = 8
export const FLOATING_CHAT_KEYBOARD_STEP_LARGE = 24

export function getFloatingChatResizeLimits(input: {
  container: FloatingChatSize
  position: FloatingChatPoint
}): FloatingChatResizeLimits {
  const maxWidth = Math.max(0, input.container.width - input.position.x - FLOATING_CHAT_MARGIN)
  const maxHeight = Math.max(0, input.container.height - input.position.y - FLOATING_CHAT_MARGIN)
  return {
    maxHeight,
    maxWidth,
    minHeight: Math.min(FLOATING_CHAT_MIN_HEIGHT, maxHeight),
    minWidth: Math.min(FLOATING_CHAT_MIN_WIDTH, maxWidth)
  }
}

export function clampFloatingChatSize(
  size: FloatingChatSize,
  limits: FloatingChatResizeLimits
): FloatingChatSize {
  return {
    height: Math.min(Math.max(limits.minHeight, size.height), limits.maxHeight),
    width: Math.min(Math.max(limits.minWidth, size.width), limits.maxWidth)
  }
}

export function resizeFloatingChatWithKeyboard(input: {
  key: string
  limits: FloatingChatResizeLimits
  shiftKey: boolean
  size: FloatingChatSize
}): FloatingChatSize | undefined {
  const step = input.shiftKey ? FLOATING_CHAT_KEYBOARD_STEP_LARGE : FLOATING_CHAT_KEYBOARD_STEP
  const nextSize = { ...input.size }

  switch (input.key) {
    case 'ArrowLeft':
      nextSize.width -= step
      break
    case 'ArrowRight':
      nextSize.width += step
      break
    case 'ArrowUp':
      nextSize.height -= step
      break
    case 'ArrowDown':
      nextSize.height += step
      break
    default:
      return undefined
  }

  return clampFloatingChatSize(nextSize, input.limits)
}

export function clampFloatingChatLayout(input: {
  container: FloatingChatSize
  fullscreen: boolean
  position: FloatingChatPoint | null
  renderedSize: FloatingChatSize
  size: FloatingChatSize | null
}): { position: FloatingChatPoint | null; size: FloatingChatSize | null } | undefined {
  if (!input.fullscreen) return undefined
  if (input.container.width <= 0 || input.container.height <= 0) return undefined

  const availableWidth = Math.max(0, input.container.width - FLOATING_CHAT_MARGIN * 2)
  const availableHeight = Math.max(0, input.container.height - FLOATING_CHAT_MARGIN * 2)
  const nextSize = input.size
    ? clampFloatingChatSize(input.size, {
        maxHeight: availableHeight,
        maxWidth: availableWidth,
        minHeight: Math.min(FLOATING_CHAT_MIN_HEIGHT, availableHeight),
        minWidth: Math.min(FLOATING_CHAT_MIN_WIDTH, availableWidth)
      })
    : null

  if (!input.position) {
    return { position: null, size: nextSize }
  }

  const effectiveSize = nextSize ?? input.renderedSize
  return {
    position: {
      x: Math.min(
        Math.max(FLOATING_CHAT_MARGIN, input.position.x),
        Math.max(
          FLOATING_CHAT_MARGIN,
          input.container.width - effectiveSize.width - FLOATING_CHAT_MARGIN
        )
      ),
      y: Math.min(
        Math.max(FLOATING_CHAT_MARGIN, input.position.y),
        Math.max(
          FLOATING_CHAT_MARGIN,
          input.container.height - effectiveSize.height - FLOATING_CHAT_MARGIN
        )
      )
    },
    size: nextSize
  }
}
