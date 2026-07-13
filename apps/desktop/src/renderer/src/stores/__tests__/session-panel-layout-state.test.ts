import { describe, expect, it } from 'vitest'
import { createSessionPanelLayoutState } from '../session-panel-layout-state'

describe('session panel layout state', () => {
  it('按 session key 隔离全屏状态', () => {
    const state = createSessionPanelLayoutState()

    state.setFullscreen('thread-a', true)

    expect(state.isFullscreen('thread-a')).toBe(true)
    expect(state.isFullscreen('thread-b')).toBe(false)
  })

  it('仅在显式 transfer 时把 orphan 全屏状态迁移到新 thread', () => {
    const state = createSessionPanelLayoutState()
    state.setFullscreen('__orphan__.main.1', true)

    expect(state.isFullscreen('existing-thread')).toBe(false)

    state.transfer('__orphan__.main.1', 'new-thread')

    expect(state.isFullscreen('__orphan__.main.1')).toBe(false)
    expect(state.isFullscreen('new-thread')).toBe(true)
    expect(state.isFullscreen('existing-thread')).toBe(false)
  })

  it('按 session key 保留浮窗位置、尺寸和折叠状态', () => {
    const state = createSessionPanelLayoutState()

    state.setFloatingChatLayout('thread-a', {
      open: false,
      position: { x: 180, y: 96 },
      size: { height: 480, width: 420 }
    })

    expect(state.getFloatingChatLayout('thread-a')).toEqual({
      open: false,
      position: { x: 180, y: 96 },
      size: { height: 480, width: 420 }
    })
    expect(state.getFloatingChatLayout('thread-b')).toEqual({
      open: true,
      position: null,
      size: null
    })
  })

  it('创建 thread 时与全屏状态一起迁移浮窗布局', () => {
    const state = createSessionPanelLayoutState()
    const orphanKey = '__orphan__.main.1'
    state.setFullscreen(orphanKey, true)
    state.setFloatingChatLayout(orphanKey, {
      open: false,
      position: { x: 240, y: 120 },
      size: { height: 520, width: 440 }
    })

    state.transfer(orphanKey, 'new-thread')

    expect(state.isFullscreen(orphanKey)).toBe(false)
    expect(state.getFloatingChatLayout(orphanKey)).toEqual({
      open: true,
      position: null,
      size: null
    })
    expect(state.isFullscreen('new-thread')).toBe(true)
    expect(state.getFloatingChatLayout('new-thread')).toEqual({
      open: false,
      position: { x: 240, y: 120 },
      size: { height: 520, width: 440 }
    })
  })

  it('关闭状态不会覆盖目标 session 已有的全屏状态', () => {
    const state = createSessionPanelLayoutState()
    state.setFullscreen('thread-target', true)

    state.transfer('__orphan__.main.1', 'thread-target')

    expect(state.isFullscreen('thread-target')).toBe(true)
  })
})
