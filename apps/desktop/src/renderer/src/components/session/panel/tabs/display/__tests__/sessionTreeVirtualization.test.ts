import { describe, expect, it } from 'vitest'
import {
  estimateSessionTreeRowSize,
  getSessionTreeVirtualItemKey,
  resolveSessionTreeEndFollowState,
  SESSION_TREE_COMPACT_ROW_SIZE_PX,
  SESSION_TREE_SUMMARY_ROW_SIZE_PX
} from '../sessionTreeVirtualization'

describe('sessionTreeVirtualization', () => {
  it('按行布局估算未测量高度', () => {
    expect(estimateSessionTreeRowSize({ id: 'entry-a' })).toBe(SESSION_TREE_COMPACT_ROW_SIZE_PX)
    expect(estimateSessionTreeRowSize({ id: 'entry-a', summary: 'summary' })).toBe(
      SESSION_TREE_SUMMARY_ROW_SIZE_PX
    )
  })

  it('按 session、entry 和尺寸类型隔离测量 key', () => {
    expect(getSessionTreeVirtualItemKey('session-a', { id: 'entry-a' }, 0)).toBe(
      'session-a:entry-a:compact'
    )
    expect(
      getSessionTreeVirtualItemKey('session-a', { id: 'entry-a', summary: 'summary' }, 0)
    ).toBe('session-a:entry-a:summary')
    expect(getSessionTreeVirtualItemKey('session-b', { id: 'entry-a' }, 0)).toBe(
      'session-b:entry-a:compact'
    )
  })

  it('在数据尚未就绪时使用稳定的 index fallback', () => {
    expect(getSessionTreeVirtualItemKey(undefined, undefined, 12)).toBe('draft:12:compact')
  })

  it('用户离开底部后保持锁定，直到真正回到底部', () => {
    expect(resolveSessionTreeEndFollowState(400, true, 32, 2)).toEqual({
      shouldFollow: false,
      userScrollLocked: true
    })
    expect(resolveSessionTreeEndFollowState(20, true, 32, 2)).toEqual({
      shouldFollow: false,
      userScrollLocked: true
    })
    expect(resolveSessionTreeEndFollowState(2, true, 32, 2)).toEqual({
      shouldFollow: true,
      userScrollLocked: false
    })
  })

  it('非用户滚动在 near-end 范围内恢复追随', () => {
    expect(resolveSessionTreeEndFollowState(20, false, 32, 2)).toEqual({
      shouldFollow: true,
      userScrollLocked: false
    })
    expect(resolveSessionTreeEndFollowState(40, false, 32, 2)).toEqual({
      shouldFollow: false,
      userScrollLocked: false
    })
  })
})
