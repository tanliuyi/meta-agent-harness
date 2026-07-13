import type { VirtualItem } from '@tanstack/vue-virtual'
import type { UiDensity } from '@shared/coding-agent/types'
import type { TimelineItem } from './chatTimelineDisplay'

const CHAT_TIMELINE_GAP_BY_DENSITY: Record<UiDensity, number> = {
  compact: 8,
  standard: 10,
  comfortable: 14
}
export const CHAT_TIMELINE_OVERSCAN = 6

export function getChatTimelineGap(density: UiDensity): number {
  return CHAT_TIMELINE_GAP_BY_DENSITY[density]
}

export interface VirtualTimelineRow<Item> {
  item: Item
  virtualItem: VirtualItem
}

export function findDirectTimelineRow(
  timelineWindow: Pick<HTMLElement, 'children'> | null,
  index: number
): HTMLElement | undefined {
  if (!timelineWindow) {
    return undefined
  }
  return Array.from(timelineWindow.children).find(
    (element) => element.getAttribute('data-index') === String(index)
  ) as HTMLElement | undefined
}

export function getVirtualTimelineRowOffset(
  virtualItem: Pick<VirtualItem, 'start'>,
  scrollMargin: number
): number {
  return virtualItem.start - scrollMargin
}

export function createVirtualTimelineRows<Item>(
  virtualItems: VirtualItem[],
  items: Item[]
): VirtualTimelineRow<Item>[] {
  const rows: VirtualTimelineRow<Item>[] = []
  for (const virtualItem of virtualItems) {
    const item = items[virtualItem.index]
    if (item) {
      rows.push({ item, virtualItem })
    }
  }
  return rows
}

export interface TimelineFollowStateInput {
  distanceToBottom: number
  nearBottomDistance: number
  stickyBottomDistance: number
  isScrollbarDragging: boolean
  isUserScrollLocked: boolean
  allowBottomUnlock: boolean
  isRunning: boolean
  shouldFollowBottom: boolean
}

export interface TimelineFollowState {
  isNearBottom: boolean
  shouldFollowBottom: boolean
  isUserScrollLocked: boolean
}

export function resolveTimelineFollowState(input: TimelineFollowStateInput): TimelineFollowState {
  const isNearBottom = input.distanceToBottom < input.nearBottomDistance
  if (input.isScrollbarDragging) {
    return {
      isNearBottom,
      shouldFollowBottom: false,
      isUserScrollLocked: input.isUserScrollLocked
    }
  }
  if (
    input.distanceToBottom <= input.stickyBottomDistance &&
    (!input.isUserScrollLocked || input.allowBottomUnlock)
  ) {
    return {
      isNearBottom: true,
      shouldFollowBottom: true,
      isUserScrollLocked: false
    }
  }
  if (input.isUserScrollLocked) {
    return {
      isNearBottom,
      shouldFollowBottom: false,
      isUserScrollLocked: true
    }
  }
  if (!input.isRunning) {
    return {
      isNearBottom,
      shouldFollowBottom: isNearBottom,
      isUserScrollLocked: false
    }
  }
  return {
    isNearBottom: input.shouldFollowBottom ? true : isNearBottom,
    shouldFollowBottom: input.shouldFollowBottom,
    isUserScrollLocked: false
  }
}

export function prepareTimelineVirtualizerForSession(
  virtualizer: Pick<
    {
      scrollToOffset(offset: number, options: { behavior: 'auto' }): void
    },
    'scrollToOffset'
  >
): void {
  virtualizer.scrollToOffset(0, { behavior: 'auto' })
}

export function estimateTimelineItemSize(item: TimelineItem | undefined): number {
  if (!item) {
    return 120
  }
  if (item.type === 'collapsed-history') {
    return 28
  }
  if (item.type === 'compaction-divider') {
    return 40
  }
  if (item.type === 'runtime-event') {
    return 56
  }
  if (item.type === 'thinking') {
    return 120
  }
  if (item.type === 'tool' || item.type === 'tool-group') {
    return 128
  }
  if (item.message.role === 'user') {
    return 88
  }
  if (item.message.role === 'system' || item.message.role === 'tool') {
    return 64
  }
  return 180
}
