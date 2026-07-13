/**
 * useResizablePane.ts - 提供可拖拽调整面板尺寸的组合式状态。
 *
 * 支持鼠标拖拽和键盘微调，可通过 pointer 事件实时更新面板尺寸。
 */

import { onBeforeUnmount, ref, toValue } from 'vue'
import type { MaybeRefOrGetter, Ref } from 'vue'

/** 可调整的方向。 */
type ResizeAxis = 'x' | 'y'

/** 支持 Pointer Capture 的事件目标。 */
type PointerCaptureTarget = EventTarget & {
  hasPointerCapture?: (pointerId: number) => boolean
  releasePointerCapture: (pointerId: number) => void
  setPointerCapture: (pointerId: number) => void
}

/** useResizablePane 配置项。 */
type UseResizablePaneOptions = {
  /** 调整方向。 */
  axis?: ResizeAxis
  /** 拖拽时 document.body 的 cursor 样式。 */
  cursor?: string
  /** 从 PointerEvent 读取当前值的回调。 */
  getPointerValue?: (event: PointerEvent) => number
  /** 当前值的 getter（支持 ref 或 getter）。 */
  getValue: MaybeRefOrGetter<number>
  /** 键盘普通步进。 */
  keyboardStep?: number
  /** 键盘大迈步进（按住 Shift）。 */
  keyboardStepLarge?: number
  /** 设置新值的回调。 */
  setValue: (value: number) => void
}

/** useResizablePane 返回的状态。 */
type UseResizablePaneState = {
  /** 键盘事件处理器。 */
  handleResizerKeydown: (event: KeyboardEvent) => void
  /** 是否正在拖拽调整。 */
  isResizing: Ref<boolean>
  /** 开始拖拽。 */
  startResize: (event: PointerEvent) => void
  /** 停止拖拽。 */
  stopResize: () => void
}

/** 默认键盘步进。 */
const DEFAULT_KEYBOARD_STEP = 8

/** 默认键盘大迈步进。 */
const DEFAULT_KEYBOARD_STEP_LARGE = 24

/**
 * 组合式函数：创建可拖拽调整大小的面板状态。
 * @param options - 配置项。
 * @returns 拖拽状态与控制方法。
 */
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
  let activePointerId: number | null = null
  let activePointerTarget: PointerCaptureTarget | null = null
  let resizeFrame = 0
  let pendingValue = toValue(getValue)

  /**
   * 判断事件目标是否支持 Pointer Capture。
   * @param target - 待判断的事件目标。
   * @returns 是否支持 Pointer Capture。
   */
  const isPointerCaptureTarget = (target: EventTarget | null): target is PointerCaptureTarget => {
    const candidate = target as Partial<PointerCaptureTarget> | null
    return (
      typeof candidate?.setPointerCapture === 'function' &&
      typeof candidate.releasePointerCapture === 'function'
    )
  }

  /**
   * 从 pointer 事件读取当前值。
   * @param event - PointerEvent。
   * @returns 当前指针位置对应值。
   */
  const readPointerValue = (event: PointerEvent): number => {
    if (getPointerValue) {
      return getPointerValue(event)
    }

    return axis === 'x' ? event.clientX : event.clientY
  }

  /**
   * 将挂起的值写入目标。
   */
  const flushValue = (): void => {
    resizeFrame = 0
    setValue(pendingValue)
  }

  /**
   * 使用 requestAnimationFrame 批量更新值。
   * @param value - 新的挂起值。
   */
  const queueValueUpdate = (value: number): void => {
    pendingValue = value

    if (resizeFrame === 0) {
      resizeFrame = window.requestAnimationFrame(flushValue)
    }
  }

  /**
   * 重置文档在拖拽期间的样式状态。
   */
  const resetDocumentResizeState = (): void => {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  /**
   * 指针移动时的回调。
   * @param event - PointerEvent。
   */
  const handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) {
      return
    }

    queueValueUpdate(readPointerValue(event))
  }

  /**
   * 移除一次拖拽注册的全部事件监听。
   * @param pointerTarget - 本次拖拽的 Pointer Capture 目标。
   */
  const removeResizeListeners = (pointerTarget: PointerCaptureTarget | null): void => {
    pointerTarget?.removeEventListener('lostpointercapture', handleLostPointerCapture)
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerEnd)
    window.removeEventListener('pointercancel', handlePointerEnd)
    window.removeEventListener('blur', handleWindowBlur)
  }

  /**
   * 停止拖拽调整。
   */
  const stopResize = (): void => {
    if (activePointerId === null) {
      return
    }

    const pointerId = activePointerId
    const pointerTarget = activePointerTarget
    activePointerId = null
    activePointerTarget = null

    if (resizeFrame !== 0) {
      window.cancelAnimationFrame(resizeFrame)
      resizeFrame = 0
      setValue(pendingValue)
    }

    isResizing.value = false
    resetDocumentResizeState()
    removeResizeListeners(pointerTarget)

    try {
      if (pointerTarget && (pointerTarget.hasPointerCapture?.(pointerId) ?? true)) {
        pointerTarget.releasePointerCapture(pointerId)
      }
    } catch {
      // 浏览器可能已在 pointercancel 或失焦时隐式释放 capture。
    }
  }

  /**
   * 主动 pointer 正常结束或被浏览器取消时停止拖拽。
   * @param event - Pointer 结束事件。
   */
  function handlePointerEnd(event: PointerEvent): void {
    if (event.pointerId !== activePointerId) {
      return
    }

    stopResize()
  }

  /**
   * Pointer Capture 意外丢失时停止拖拽。
   * @param event - Pointer Capture 丢失事件。
   */
  function handleLostPointerCapture(event: Event): void {
    if ((event as PointerEvent).pointerId !== activePointerId) {
      return
    }

    stopResize()
  }

  /**
   * 窗口失焦时停止拖拽，避免窗口外释放后保留拖拽状态。
   */
  function handleWindowBlur(): void {
    stopResize()
  }

  /**
   * 开始拖拽调整。
   * @param event - PointerEvent。
   */
  const startResize = (event: PointerEvent): void => {
    if (activePointerId !== null) {
      return
    }

    event.preventDefault()
    activePointerId = event.pointerId
    activePointerTarget = isPointerCaptureTarget(event.currentTarget) ? event.currentTarget : null
    isResizing.value = true
    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'
    pendingValue = readPointerValue(event)
    setValue(pendingValue)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerEnd)
    window.addEventListener('pointercancel', handlePointerEnd)
    window.addEventListener('blur', handleWindowBlur)

    if (activePointerTarget) {
      activePointerTarget.addEventListener('lostpointercapture', handleLostPointerCapture)
      try {
        activePointerTarget.setPointerCapture(event.pointerId)
      } catch {
        // 不支持当前 pointer 的环境仍可依赖 window 事件与拖拽遮罩。
      }
    }
  }

  /**
   * 键盘事件处理，支持方向键微调。
   * @param event - KeyboardEvent。
   */
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
