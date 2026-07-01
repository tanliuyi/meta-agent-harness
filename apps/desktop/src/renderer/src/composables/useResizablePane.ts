/**
 * 本文件提供可拖拽调整面板尺寸的组合式状态。
 */

import { onBeforeUnmount, ref, toValue } from 'vue'
import type { MaybeRefOrGetter, Ref } from 'vue'

type ResizeAxis = 'x' | 'y'

type UseResizablePaneOptions = {
  axis?: ResizeAxis
  cursor?: string
  getPointerValue?: (event: PointerEvent) => number
  getValue: MaybeRefOrGetter<number>
  keyboardStep?: number
  keyboardStepLarge?: number
  setValue: (value: number) => void
}

type UseResizablePaneState = {
  handleResizerKeydown: (event: KeyboardEvent) => void
  isResizing: Ref<boolean>
  startResize: (event: PointerEvent) => void
  stopResize: () => void
}

const DEFAULT_KEYBOARD_STEP = 8
const DEFAULT_KEYBOARD_STEP_LARGE = 24

export const useResizablePane = ({
  axis = 'x',
  cursor = axis === 'x' ? 'col-resize' : 'row-resize',
  getPointerValue,
  getValue,
  keyboardStep = DEFAULT_KEYBOARD_STEP,
  keyboardStepLarge = DEFAULT_KEYBOARD_STEP_LARGE,
  setValue
}: UseResizablePaneOptions): UseResizablePaneState => {
  const isResizing = ref(false)
  let resizeFrame = 0
  let pendingValue = toValue(getValue)

  const readPointerValue = (event: PointerEvent): number => {
    if (getPointerValue) {
      return getPointerValue(event)
    }

    return axis === 'x' ? event.clientX : event.clientY
  }

  const flushValue = (): void => {
    resizeFrame = 0
    setValue(pendingValue)
  }

  const queueValueUpdate = (value: number): void => {
    pendingValue = value

    if (resizeFrame === 0) {
      resizeFrame = window.requestAnimationFrame(flushValue)
    }
  }

  const resetDocumentResizeState = (): void => {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  const handlePointerMove = (event: PointerEvent): void => {
    queueValueUpdate(readPointerValue(event))
  }

  const stopResize = (): void => {
    if (resizeFrame !== 0) {
      window.cancelAnimationFrame(resizeFrame)
      resizeFrame = 0
      setValue(pendingValue)
    }

    isResizing.value = false
    resetDocumentResizeState()
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', stopResize)
  }

  const startResize = (event: PointerEvent): void => {
    event.preventDefault()
    isResizing.value = true
    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'
    pendingValue = readPointerValue(event)
    setValue(pendingValue)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
  }

  const handleResizerKeydown = (event: KeyboardEvent): void => {
    const isDecreaseKey = axis === 'x' ? event.key === 'ArrowLeft' : event.key === 'ArrowUp'
    const isIncreaseKey = axis === 'x' ? event.key === 'ArrowRight' : event.key === 'ArrowDown'

    if (!isDecreaseKey && !isIncreaseKey) {
      return
    }

    const step = event.shiftKey ? keyboardStepLarge : keyboardStep
    const direction = isDecreaseKey ? -1 : 1

    event.preventDefault()
    setValue(toValue(getValue) + direction * step)
  }

  onBeforeUnmount(() => {
    stopResize()
  })

  return {
    handleResizerKeydown,
    isResizing,
    startResize,
    stopResize
  }
}
