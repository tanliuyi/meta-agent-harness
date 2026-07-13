import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const beforeUnmountHooks = vi.hoisted(() => [] as Array<() => void>)

vi.mock('vue', async (importOriginal) => {
  const vue = await importOriginal<typeof import('vue')>()
  return {
    ...vue,
    onBeforeUnmount: (hook: () => void) => beforeUnmountHooks.push(hook)
  }
})

import { useResizablePane } from '../useResizablePane'

class TestWindow extends EventTarget {
  private nextFrameId = 1

  requestAnimationFrame = vi.fn(() => this.nextFrameId++)
  cancelAnimationFrame = vi.fn(() => undefined)
}

class TestPointerTarget extends EventTarget {
  private readonly capturedPointers = new Set<number>()

  setPointerCapture = vi.fn((pointerId: number) => {
    this.capturedPointers.add(pointerId)
  })

  hasPointerCapture = vi.fn((pointerId: number) => this.capturedPointers.has(pointerId))

  releasePointerCapture = vi.fn((pointerId: number) => {
    if (!this.capturedPointers.delete(pointerId)) return
    this.dispatchEvent(createPointerEvent('lostpointercapture', pointerId))
  })

  losePointerCapture(pointerId: number): void {
    if (!this.capturedPointers.delete(pointerId)) return
    this.dispatchEvent(createPointerEvent('lostpointercapture', pointerId))
  }
}

function createPointerEvent(
  type: string,
  pointerId: number,
  coordinates: { clientX?: number; clientY?: number } = {}
): Event {
  const event = new Event(type)
  Object.defineProperties(event, {
    clientX: { value: coordinates.clientX ?? 0 },
    clientY: { value: coordinates.clientY ?? 0 },
    pointerId: { value: pointerId }
  })
  return event
}

function createStartEvent(
  target: TestPointerTarget,
  pointerId: number,
  clientX = 100
): PointerEvent {
  return {
    clientX,
    clientY: 0,
    currentTarget: target,
    pointerId,
    preventDefault: vi.fn()
  } as unknown as PointerEvent
}

describe('useResizablePane pointer lifecycle', () => {
  let testWindow: TestWindow
  let pointerTarget: TestPointerTarget
  let setValue: ReturnType<typeof vi.fn<(value: number) => void>>

  beforeEach(() => {
    beforeUnmountHooks.length = 0
    testWindow = new TestWindow()
    pointerTarget = new TestPointerTarget()
    setValue = vi.fn<(value: number) => void>()
    vi.stubGlobal('window', testWindow)
    vi.stubGlobal('document', {
      body: {
        style: {
          cursor: '',
          userSelect: ''
        }
      }
    })
  })

  afterEach(() => {
    beforeUnmountHooks.at(-1)?.()
    vi.unstubAllGlobals()
  })

  function createResizablePane(): ReturnType<typeof useResizablePane> {
    return useResizablePane({
      getValue: 100,
      setValue
    })
  }

  it('ignores move and end events from a pointer that did not start the resize', () => {
    const pane = createResizablePane()

    pane.startResize(createStartEvent(pointerTarget, 1))
    testWindow.dispatchEvent(createPointerEvent('pointermove', 2, { clientX: 240 }))
    testWindow.dispatchEvent(createPointerEvent('pointerup', 2))
    testWindow.dispatchEvent(createPointerEvent('pointercancel', 2))

    expect(pane.isResizing.value).toBe(true)
    expect(setValue).toHaveBeenCalledTimes(1)

    testWindow.dispatchEvent(createPointerEvent('pointerup', 1))

    expect(pane.isResizing.value).toBe(false)
  })

  it('stops and releases pointer capture when the window loses focus', () => {
    const pane = createResizablePane()

    pane.startResize(createStartEvent(pointerTarget, 7))
    testWindow.dispatchEvent(new Event('blur'))

    expect(pane.isResizing.value).toBe(false)
    expect(pointerTarget.releasePointerCapture).toHaveBeenCalledOnce()
    expect(pointerTarget.releasePointerCapture).toHaveBeenCalledWith(7)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })

  it('stops when pointer capture is lost unexpectedly', () => {
    const pane = createResizablePane()

    pane.startResize(createStartEvent(pointerTarget, 9))
    pointerTarget.losePointerCapture(9)
    testWindow.dispatchEvent(createPointerEvent('pointermove', 9, { clientX: 260 }))

    expect(pane.isResizing.value).toBe(false)
    expect(setValue).toHaveBeenCalledTimes(1)
    expect(pointerTarget.releasePointerCapture).not.toHaveBeenCalled()
  })

  it('flushes the active pointer value and cleans up once on pointercancel', () => {
    const pane = createResizablePane()

    pane.startResize(createStartEvent(pointerTarget, 11))
    testWindow.dispatchEvent(createPointerEvent('pointermove', 11, { clientX: 180 }))
    testWindow.dispatchEvent(createPointerEvent('pointercancel', 11))

    expect(pane.isResizing.value).toBe(false)
    expect(setValue).toHaveBeenNthCalledWith(1, 100)
    expect(setValue).toHaveBeenNthCalledWith(2, 180)
    expect(setValue).toHaveBeenCalledTimes(2)
    expect(testWindow.cancelAnimationFrame).toHaveBeenCalledOnce()
    expect(pointerTarget.releasePointerCapture).toHaveBeenCalledOnce()
  })

  it('removes active listeners and capture during component unmount', () => {
    const pane = createResizablePane()

    pane.startResize(createStartEvent(pointerTarget, 13))
    expect(beforeUnmountHooks).toHaveLength(1)
    beforeUnmountHooks[0]()
    testWindow.dispatchEvent(createPointerEvent('pointermove', 13, { clientX: 300 }))
    testWindow.dispatchEvent(createPointerEvent('pointerup', 13))

    expect(pane.isResizing.value).toBe(false)
    expect(setValue).toHaveBeenCalledTimes(1)
    expect(pointerTarget.releasePointerCapture).toHaveBeenCalledOnce()
  })
})
