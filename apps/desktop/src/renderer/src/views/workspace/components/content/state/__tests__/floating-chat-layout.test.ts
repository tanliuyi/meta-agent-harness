import { describe, expect, it } from 'vitest'
import {
  clampFloatingChatLayout,
  getFloatingChatResizeLimits,
  resizeFloatingChatWithKeyboard
} from '../floating-chat-layout'

describe('floating chat layout', () => {
  it('非全屏容器尺寸变化时不重算浮窗布局', () => {
    expect(
      clampFloatingChatLayout({
        container: { height: 700, width: 900 },
        fullscreen: false,
        position: { x: 240, y: 160 },
        renderedSize: { height: 700, width: 900 },
        size: null
      })
    ).toBeUndefined()
  })

  it('全屏宿主暂时隐藏为 0x0 时不覆盖已保存布局', () => {
    expect(
      clampFloatingChatLayout({
        container: { height: 0, width: 0 },
        fullscreen: true,
        position: { x: 240, y: 160 },
        renderedSize: { height: 0, width: 0 },
        size: { height: 520, width: 440 }
      })
    ).toBeUndefined()
  })

  it('全屏时把浮窗尺寸和位置限制在容器边距内', () => {
    expect(
      clampFloatingChatLayout({
        container: { height: 500, width: 600 },
        fullscreen: true,
        position: { x: 500, y: 420 },
        renderedSize: { height: 360, width: 420 },
        size: { height: 600, width: 700 }
      })
    ).toEqual({
      position: { x: 12, y: 12 },
      size: { height: 476, width: 576 }
    })
  })

  it('恢复的浮窗布局仍在容器内时保持位置和尺寸', () => {
    expect(
      clampFloatingChatLayout({
        container: { height: 700, width: 900 },
        fullscreen: true,
        position: { x: 240, y: 120 },
        renderedSize: { height: 520, width: 440 },
        size: { height: 520, width: 440 }
      })
    ).toEqual({
      position: { x: 240, y: 120 },
      size: { height: 520, width: 440 }
    })
  })

  it('根据当前位置计算 resize 的最小和最大尺寸', () => {
    expect(
      getFloatingChatResizeLimits({
        container: { height: 600, width: 800 },
        position: { x: 100, y: 50 }
      })
    ).toEqual({ maxHeight: 538, maxWidth: 688, minHeight: 320, minWidth: 340 })
  })

  it('方向键按轴调整尺寸，Shift 使用大步进并受边界约束', () => {
    const limits = { maxHeight: 500, maxWidth: 600, minHeight: 320, minWidth: 340 }

    expect(
      resizeFloatingChatWithKeyboard({
        key: 'ArrowRight',
        limits,
        shiftKey: false,
        size: { height: 400, width: 400 }
      })
    ).toEqual({ height: 400, width: 408 })
    expect(
      resizeFloatingChatWithKeyboard({
        key: 'ArrowDown',
        limits,
        shiftKey: true,
        size: { height: 490, width: 400 }
      })
    ).toEqual({ height: 500, width: 400 })
    expect(
      resizeFloatingChatWithKeyboard({
        key: 'Enter',
        limits,
        shiftKey: false,
        size: { height: 400, width: 400 }
      })
    ).toBeUndefined()
  })
})
