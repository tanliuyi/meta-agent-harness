import { describe, expect, it } from 'vitest'
import type { VirtualItem } from '@tanstack/vue-virtual'
import type { ThreadMessage } from '@shared/coding-agent/types'
import type { TimelineItem } from '../chatTimelineDisplay'
import {
  createVirtualTimelineRows,
  estimateTimelineItemSize,
  findDirectTimelineRow,
  resetTimelineVirtualizerForSession,
  resolveTimelineFollowState,
  shouldAdjustTimelineScrollForItemResize
} from '../chatTimelineVirtualization'

interface TestElement {
  children: TestElement[]
  getAttribute(name: string): string | null
  name: string
}

function createTestElement(name: string, index: number, children: TestElement[] = []): TestElement {
  return {
    children,
    getAttribute: (attributeName) => (attributeName === 'data-index' ? String(index) : null),
    name
  }
}

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

  it('keeps the interaction lock when a programmatic scroll reaches the bottom', () => {
    expect(
      resolveTimelineFollowState({
        distanceToBottom: 0,
        nearBottomDistance: 32,
        stickyBottomDistance: 2,
        isScrollbarDragging: false,
        isUserScrollLocked: true,
        allowBottomUnlock: false,
        isRunning: true,
        shouldFollowBottom: false
      })
    ).toEqual({
      isNearBottom: true,
      shouldFollowBottom: false,
      isUserScrollLocked: true
    })
  })

  it('restores bottom following only when user input allows unlocking', () => {
    expect(
      resolveTimelineFollowState({
        distanceToBottom: 0,
        nearBottomDistance: 32,
        stickyBottomDistance: 2,
        isScrollbarDragging: false,
        isUserScrollLocked: true,
        allowBottomUnlock: true,
        isRunning: true,
        shouldFollowBottom: false
      })
    ).toEqual({
      isNearBottom: true,
      shouldFollowBottom: true,
      isUserScrollLocked: false
    })
  })

  it('preserves the running follow decision away from the sticky bottom', () => {
    expect(
      resolveTimelineFollowState({
        distanceToBottom: 18,
        nearBottomDistance: 32,
        stickyBottomDistance: 2,
        isScrollbarDragging: false,
        isUserScrollLocked: false,
        allowBottomUnlock: false,
        isRunning: true,
        shouldFollowBottom: false
      })
    ).toEqual({
      isNearBottom: true,
      shouldFollowBottom: false,
      isUserScrollLocked: false
    })
  })

  it('uses virtualizer APIs to reset session measurements and offset', () => {
    const calls: string[] = []

    resetTimelineVirtualizerForSession({
      scrollToOffset: (offset, options) => {
        calls.push(`scroll:${offset}:${options.behavior}`)
      },
      measure: () => {
        calls.push('measure')
      }
    })

    expect(calls).toEqual(['scroll:0:auto', 'measure'])
  })

  it('selects only a direct timeline row when nested virtual content reuses the index', () => {
    const nestedRowWithTargetIndex = createTestElement('nested-markdown-row', 4)
    const earlierTimelineRow = createTestElement('earlier-timeline-row', 1, [
      nestedRowWithTargetIndex
    ])
    const targetTimelineRow = createTestElement('target-timeline-row', 4)
    const timelineWindow = {
      children: [earlierTimelineRow, targetTimelineRow]
    } as unknown as Pick<HTMLElement, 'children'>

    expect(findDirectTimelineRow(timelineWindow, 4)).toBe(targetTimelineRow)
    expect(findDirectTimelineRow(timelineWindow, 9)).toBeUndefined()
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
