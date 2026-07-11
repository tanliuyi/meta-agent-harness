import type { VirtualItem } from '@tanstack/vue-virtual'
import type { TimelineItem } from './chatTimelineDisplay'

export const CHAT_TIMELINE_GAP = 12
export const CHAT_TIMELINE_OVERSCAN = 6

export interface VirtualTimelineRow<Item> {
  item: Item
  virtualItem: VirtualItem
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

export function shouldAdjustTimelineScrollForItemResize(
  item: VirtualItem,
  scrollOffset: number
): boolean {
  return item.end <= scrollOffset
}

export function resetTimelineVirtualizerForSession(
  viewport: Pick<HTMLElement, 'scrollTop'> | null,
  virtualizer: Pick<{ measure(): void }, 'measure'>
): void {
  if (viewport) {
    viewport.scrollTop = 0
  }
  virtualizer.measure()
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
