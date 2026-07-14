import { describe, expect, it } from 'vitest'
import type { VirtualItem } from '@tanstack/vue-virtual'
import type { Message } from '@ag-ui/core'
import type { TimelineItem } from '../chatTimelineDisplay'
import {
  createVirtualTimelineRows,
  estimateTimelineItemSize,
  findDirectTimelineRow,
  getChatTimelineGap,
  getVirtualTimelineRowOffset,
  prepareTimelineVirtualizerForSession,
  resolveTimelineFollowState
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

function createMessageItem(role: 'user' | 'assistant'): TimelineItem {
  const message: Message =
    role === 'user'
      ? { id: `${role}-message`, role, content: '' }
      : { id: `${role}-message`, role, content: '' }
  return {
    type: 'message',
    key: `${role}-message`,
    message,
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

  it('keeps the virtualizer gap aligned with each density layout', () => {
    expect(getChatTimelineGap('compact')).toBe(8)
    expect(getChatTimelineGap('standard')).toBe(10)
    expect(getChatTimelineGap('comfortable')).toBe(14)
  })

  it('positions every row from its own TanStack start relative to the list margin', () => {
    const virtualItems = [createVirtualItem(3), createVirtualItem(4)]

    expect(virtualItems.map((item) => getVirtualTimelineRowOffset(item, 16))).toEqual([284, 384])
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

  it('cancels stale session scrolling without clearing keyed measurements', () => {
    const calls: string[] = []

    prepareTimelineVirtualizerForSession({
      scrollToOffset: (offset, options) => {
        calls.push(`scroll:${offset}:${options.behavior}`)
      }
    })

    expect(calls).toEqual(['scroll:0:auto'])
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
