import { describe, expect, it } from 'vitest'
import type { VirtualItem } from '@tanstack/vue-virtual'
import type { ThreadMessage } from '@shared/coding-agent/types'
import type { TimelineItem } from '../chatTimelineDisplay'
import {
  createVirtualTimelineRows,
  estimateTimelineItemSize,
  resetTimelineVirtualizerForSession,
  shouldAdjustTimelineScrollForItemResize
} from '../chatTimelineVirtualization'

function createVirtualItem(index: number): VirtualItem {
  return { index, key: index, start: index * 100, size: 100, end: (index + 1) * 100, lane: 0 }
}

function createMessageItem(role: ThreadMessage['role']): TimelineItem {
  return {
    type: 'message',
    key: `${role}-message`,
    message: { id: `${role}-message`, role, content: [] } as unknown as ThreadMessage,
    text: '',
    renderState: 'complete',
    revision: 1
  }
}

describe('chat timeline virtualization', () => {
  it('projects only virtual indexes that still exist', () => {
    const rows = createVirtualTimelineRows(
      [createVirtualItem(1), createVirtualItem(3)],
      ['first', 'second', 'third']
    )

    expect(rows.map((row) => row.item)).toEqual(['second'])
    expect(rows.map((row) => row.virtualItem.index)).toEqual([1])
  })

  it('adjusts size changes only for rows entirely above the viewport', () => {
    const aboveViewport = createVirtualItem(1)
    const containingViewport = { ...createVirtualItem(1), end: 900 }

    expect(shouldAdjustTimelineScrollForItemResize(aboveViewport, 250)).toBe(true)
    expect(shouldAdjustTimelineScrollForItemResize(containingViewport, 250)).toBe(false)
    expect(shouldAdjustTimelineScrollForItemResize(createVirtualItem(3), 250)).toBe(false)
  })

  it('clears the previous session scroll offset before resetting measurements', () => {
    const viewport = { scrollTop: 2400 }
    let scrollTopWhenMeasured = -1

    resetTimelineVirtualizerForSession(viewport, {
      measure: () => {
        scrollTopWhenMeasured = viewport.scrollTop
      }
    })

    expect(viewport.scrollTop).toBe(0)
    expect(scrollTopWhenMeasured).toBe(0)
  })

  it('uses compact estimates for short rows and larger estimates for assistant content', () => {
    expect(estimateTimelineItemSize(createMessageItem('user'))).toBe(88)
    expect(estimateTimelineItemSize(createMessageItem('assistant'))).toBe(180)
    expect(
      estimateTimelineItemSize({
        type: 'collapsed-history',
        key: 'collapsed',
        label: 'done',
        collapsible: true,
        items: []
      } as unknown as TimelineItem)
    ).toBe(28)
  })
})
