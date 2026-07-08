import type { DesktopToolCall } from '@coding-agent-desktop-src/protocol/tool'
import type {
  MessageRenderState,
  WorkspaceToolCallStructure
} from '@renderer/stores/workspace-session'
import type { ThreadMessage } from '@shared/coding-agent/types'
import {
  createToolGroupTimelineItem,
  getToolGroupStatus,
  groupTimelineTools,
  type ToolGroupStatus,
  type ToolGroupTimelineItem
} from '../messages/tools/support/tool-group'
import { getMessageRawRecord, getMessageText, isRecord } from '../messages/support/message-format'

export type TimelineItem =
  | {
      type: 'collapsed-history'
      key: string
      hiddenCount: number
      hiddenTurnCount: number
      durationLabel?: string
      collapsible: boolean
    }
  | {
      type: 'message'
      key: string
      message: ThreadMessage
      text?: string
      toolCall?: DesktopToolCall
      revision: number
      renderState: MessageRenderState['renderState']
    }
  | {
      type: 'thinking'
      key: string
      message: ThreadMessage
      text: string
      collapseWhenResponseAppears: boolean
      revision: number
      renderState: MessageRenderState['renderState']
    }
  | {
      type: 'tool'
      key: string
      toolCall: DesktopToolCall
    }
  | {
      type: 'compaction-divider'
      key: string
      message: ThreadMessage
    }
  | ToolGroupTimelineItem

export type UngroupedTimelineItem = Exclude<TimelineItem, ToolGroupTimelineItem>
export type CollapsedHistoryTimelineItem = Extract<TimelineItem, { type: 'collapsed-history' }>

type AssistantTimelineSegment =
  | UngroupedTimelineItem
  | {
      type: 'assistant-tool-call'
      toolCallId: string
    }

export type ProcessingCollapseContext = {
  key: string
  boundaryIndex: number
  processEndIndex: number
  hiddenCount: number
  hiddenTurnCount: number
  durationLabel?: string
  collapsible: boolean
}

export interface ProcessingCollapseResult {
  contexts: ProcessingCollapseContext[]
  finalReplyKeys: Set<string>
}

export interface CreateTimelineItemsInput {
  messages: ThreadMessage[]
  toolCallStructures: WorkspaceToolCallStructure[]
  getMessageRenderState: (message: ThreadMessage) => MessageRenderState
  resolveTimelineToolCall: (toolCallId: string) => DesktopToolCall | undefined
  getToolResultMessageToolCall: (message: ThreadMessage) => DesktopToolCall | undefined
  hideThinkingBlock: boolean
}

export function createTimelineItems(input: CreateTimelineItemsInput): TimelineItem[] {
  const consumedToolCallIds = new Set<string>()
  const items: TimelineItem[] = []
  let pendingToolGroupKey: string | undefined
  let pendingToolCalls: DesktopToolCall[] = []

  const flushPendingToolGroup = (): void => {
    if (pendingToolCalls.length === 0) {
      return
    }
    items.push(createToolGroupTimelineItem(pendingToolCalls, pendingToolGroupKey))
    pendingToolGroupKey = undefined
    pendingToolCalls = []
  }

  for (const message of input.messages) {
    const renderState = input.getMessageRenderState(message)
    if (isCompactionMessage(message)) {
      flushPendingToolGroup()
      items.push({
        type: 'compaction-divider',
        key: `${message.id}:compaction`,
        message
      })
      continue
    }
    if (message.role === 'assistant') {
      const assistantSegments = getAssistantTimelineSegments(message, renderState, {
        hideThinkingBlock: input.hideThinkingBlock
      })
      for (const segment of assistantSegments) {
        if (segment.type !== 'assistant-tool-call') {
          flushPendingToolGroup()
          items.push(segment)
          continue
        }
        const toolCall = input.resolveTimelineToolCall(segment.toolCallId)
        if (!toolCall) {
          continue
        }
        consumedToolCallIds.add(toolCall.toolCallId)
        pendingToolGroupKey ??= getStableToolGroupKey([toolCall.toolCallId])
        pendingToolCalls.push(toolCall)
      }
      continue
    }

    flushPendingToolGroup()
    const toolCall =
      message.role === 'tool' ? input.getToolResultMessageToolCall(message) : undefined
    if (toolCall) {
      consumedToolCallIds.add(toolCall.toolCallId)
    }
    items.push({
      type: 'message',
      key: message.id,
      message,
      toolCall,
      revision: renderState.revision,
      renderState: renderState.renderState
    })
  }

  flushPendingToolGroup()

  for (const toolCall of input.toolCallStructures) {
    if (consumedToolCallIds.has(toolCall.toolCallId)) {
      continue
    }
    const resolvedToolCall = input.resolveTimelineToolCall(toolCall.toolCallId)
    if (!resolvedToolCall) {
      continue
    }
    items.push({
      type: 'tool',
      key: `tool-${resolvedToolCall.toolCallId}`,
      toolCall: resolvedToolCall
    })
  }

  return groupTimelineTools(items)
}

function getStableToolGroupKey(toolCallIds: string[]): string | undefined {
  return toolCallIds[0] ? `tool-group:${toolCallIds[0]}` : undefined
}

interface GetAssistantTimelineItemsOptions {
  hideThinkingBlock: boolean
}

export function getAssistantTimelineItems(
  message: ThreadMessage,
  renderState: MessageRenderState,
  options: GetAssistantTimelineItemsOptions
): UngroupedTimelineItem[] {
  return getAssistantTimelineSegments(message, renderState, options).filter(
    (item): item is UngroupedTimelineItem => item.type !== 'assistant-tool-call'
  )
}

function getAssistantTimelineSegments(
  message: ThreadMessage,
  renderState: MessageRenderState,
  options: GetAssistantTimelineItemsOptions
): AssistantTimelineSegment[] {
  const content = getMessageRawRecord(message).content
  if (!Array.isArray(content)) {
    const text = getMessageText(message)
    const items: AssistantTimelineSegment[] = text
      ? [
          {
            type: 'message',
            key: `${message.id}:text`,
            message,
            text,
            revision: renderState.revision,
            renderState: renderState.renderState
          }
        ]
      : []
    appendMissingAssistantToolCallSegments(items, message.toolCallIds, new Set())
    return items
  }

  const items: AssistantTimelineSegment[] = []
  const rawToolCallIds = new Set<string>()
  content.forEach((part, index) => {
    if (!isRecord(part) || typeof part.type !== 'string') {
      return
    }
    if (
      part.type === 'thinking' &&
      typeof part.thinking === 'string' &&
      part.thinking &&
      !options.hideThinkingBlock
    ) {
      items.push({
        type: 'thinking',
        key: `${message.id}:thinking:${index}`,
        message,
        text: part.thinking,
        collapseWhenResponseAppears: hasFollowingResponseContent(
          content,
          index,
          Boolean(message.toolCallIds?.length)
        ),
        revision: renderState.revision,
        renderState: renderState.renderState
      })
      return
    }
    if (part.type === 'text' && typeof part.text === 'string' && part.text) {
      items.push({
        type: 'message',
        key: `${message.id}:text:${index}`,
        message,
        text: part.text,
        revision: renderState.revision,
        renderState: renderState.renderState
      })
      return
    }
    if (part.type === 'toolCall' && typeof part.id === 'string') {
      rawToolCallIds.add(part.id)
      items.push({ type: 'assistant-tool-call', toolCallId: part.id })
    }
  })

  appendMissingAssistantToolCallSegments(items, message.toolCallIds, rawToolCallIds)
  return items
}

function appendMissingAssistantToolCallSegments(
  items: AssistantTimelineSegment[],
  toolCallIds: string[] | undefined,
  seenToolCallIds: Set<string>
): void {
  for (const toolCallId of toolCallIds ?? []) {
    if (seenToolCallIds.has(toolCallId)) {
      continue
    }
    seenToolCallIds.add(toolCallId)
    items.push({ type: 'assistant-tool-call', toolCallId })
  }
}

export function createProcessingCollapseResult(input: {
  items: TimelineItem[]
  isRunning: boolean
  activeSessionId: string | undefined
  now: number
}): ProcessingCollapseResult {
  const { items } = input
  const contexts: ProcessingCollapseContext[] = []
  const finalReplyKeys = new Set<string>()
  for (let index = 0; index < items.length; index += 1) {
    if (!isUserMessageItem(items[index])) {
      continue
    }
    const boundaryIndex = index + 1
    const segmentEndIndex = findNextProcessingSegmentBoundaryIndex(items, boundaryIndex)
    const endIndex = segmentEndIndex < 0 ? items.length : segmentEndIndex
    const finalReplyIndex = findFinalReplyIndexInRange(items, boundaryIndex, endIndex)
    const hasFinalReply = finalReplyIndex >= boundaryIndex
    const processEndIndex = hasFinalReply ? finalReplyIndex : endIndex
    const hiddenCount = Math.max(0, processEndIndex - boundaryIndex)
    const isActiveSegment = segmentEndIndex < 0 && !hasFinalReply && input.isRunning
    if (hasFinalReply) {
      finalReplyKeys.add(items[finalReplyIndex].key)
    }
    if (hiddenCount === 0 && !isActiveSegment) {
      continue
    }
    contexts.push({
      key: `${input.activeSessionId ?? 'session'}:${items[index].key}`,
      boundaryIndex,
      processEndIndex,
      hiddenCount,
      hiddenTurnCount: countTurnsInRange(items, boundaryIndex, processEndIndex),
      durationLabel: formatProcessingDuration(
        items[index],
        items,
        boundaryIndex,
        processEndIndex,
        hasFinalReply
          ? items[finalReplyIndex]
          : segmentEndIndex >= 0
            ? items[segmentEndIndex]
            : undefined,
        input.now
      ),
      collapsible: hasFinalReply || segmentEndIndex >= 0
    })
  }
  return { contexts, finalReplyKeys }
}

export function createDisplayTimelineItems(input: {
  timelineItems: TimelineItem[]
  contexts: ProcessingCollapseContext[]
  isCollapsedHistoryOpen: (item: CollapsedHistoryTimelineItem) => boolean
}): TimelineItem[] {
  if (input.contexts.length === 0) {
    return input.timelineItems
  }
  const items: TimelineItem[] = []
  let cursor = 0
  for (const context of input.contexts) {
    appendTimelineRange(items, input.timelineItems, cursor, context.boundaryIndex)
    const collapsedItem: TimelineItem = {
      type: 'collapsed-history',
      key: `collapsed-history:${context.key}`,
      hiddenCount: context.hiddenCount,
      hiddenTurnCount: context.hiddenTurnCount,
      durationLabel: context.durationLabel,
      collapsible: context.collapsible
    }
    items.push(collapsedItem)
    if (input.isCollapsedHistoryOpen(collapsedItem)) {
      appendTimelineRange(
        items,
        input.timelineItems,
        context.boundaryIndex,
        context.processEndIndex
      )
    } else {
      appendVisibleItemsInCollapsedRange(
        items,
        input.timelineItems,
        context.boundaryIndex,
        context.processEndIndex
      )
    }
    cursor = context.processEndIndex
  }
  appendTimelineRange(items, input.timelineItems, cursor, input.timelineItems.length)
  return items
}

export function isCollapsedHistoryItem(item: TimelineItem): item is CollapsedHistoryTimelineItem {
  return item.type === 'collapsed-history'
}

export function getTimelineItemToolGroupStatus(item: TimelineItem): ToolGroupStatus | undefined {
  return item.type === 'tool-group' ? getToolGroupStatus(item.toolCalls) : undefined
}

export function findToolCallStructureById(
  toolCallStructures: WorkspaceToolCallStructure[],
  toolCallId: string
): WorkspaceToolCallStructure | undefined {
  return toolCallStructures.find((toolCall) => toolCall.toolCallId === toolCallId)
}

export function resolveTimelineToolCall(input: {
  toolCallId: string
  toolCallsById: Record<string, DesktopToolCall | undefined>
  toolCallStructures: WorkspaceToolCallStructure[]
}): DesktopToolCall | undefined {
  const full = input.toolCallsById[input.toolCallId]
  const structure = findToolCallStructureById(input.toolCallStructures, input.toolCallId)
  if (!full) {
    if (!structure) {
      return undefined
    }
    return {
      threadId: structure.threadId,
      toolCallId: structure.toolCallId,
      toolName: structure.toolName,
      status: 'queued',
      args: structure.args,
      startedAt: structure.startedAt,
      finishedAt: structure.finishedAt
    }
  }
  if (!structure || !isGenericToolName(full.toolName)) {
    return full
  }
  return {
    ...full,
    toolName: structure.toolName,
    args: full.args ?? structure.args,
    startedAt: full.startedAt ?? structure.startedAt,
    finishedAt: full.finishedAt ?? structure.finishedAt
  }
}

export function getTimelineItemRevision(item: TimelineItem | undefined): unknown[] {
  if (!item) {
    return []
  }
  if (item.type === 'collapsed-history') {
    return [item.hiddenCount, item.hiddenTurnCount, item.durationLabel, item.collapsible]
  }
  if (item.type === 'message') {
    return [item.revision, ...getToolCallRevision(item.toolCall)]
  }
  if (item.type === 'thinking') {
    return [item.revision, item.text, item.collapseWhenResponseAppears]
  }
  if (item.type === 'compaction-divider') {
    return [item.message.id, item.message.createdAt]
  }
  if (item.type === 'tool-group') {
    return [
      item.summary,
      getTimelineItemToolGroupStatus(item),
      ...item.toolCalls.flatMap((toolCall) => [
        toolCall.toolCallId,
        toolCall.toolName,
        toolCall.status,
        toolCall.args,
        toolCall.partialResult,
        toolCall.result,
        toolCall.startedAt,
        toolCall.finishedAt
      ])
    ]
  }
  return [
    item.toolCall.toolCallId,
    item.toolCall.toolName,
    item.toolCall.args,
    item.toolCall.startedAt,
    item.toolCall.finishedAt
  ]
}

export function getToolResultMessageToolCall(
  message: ThreadMessage,
  toolCallsById: Record<string, DesktopToolCall | undefined>
): DesktopToolCall | undefined {
  const raw = getMessageRawRecord(message)
  return typeof raw.toolCallId === 'string' ? toolCallsById[raw.toolCallId] : undefined
}

function appendTimelineRange(
  target: TimelineItem[],
  source: TimelineItem[],
  startIndex: number,
  endIndex: number
): void {
  for (let index = startIndex; index < endIndex; index += 1) {
    const item = source[index]
    if (item) {
      target.push(item)
    }
  }
}

function appendVisibleItemsInCollapsedRange(
  target: TimelineItem[],
  source: TimelineItem[],
  startIndex: number,
  endIndex: number
): void {
  for (let index = startIndex; index < endIndex; index += 1) {
    const item = source[index]
    if (item?.type === 'compaction-divider') {
      target.push(item)
    }
  }
}

function findFinalReplyIndexInRange(
  items: TimelineItem[],
  startIndex: number,
  endIndex: number
): number {
  let candidateIndex = -1
  for (let index = startIndex; index < endIndex; index += 1) {
    const item = items[index]
    if (
      item.type === 'message' &&
      item.message.role === 'assistant' &&
      Boolean(item.text) &&
      item.renderState === 'complete' &&
      !hasAssistantToolCall(item.message)
    ) {
      candidateIndex = index
    }
  }
  return candidateIndex
}

function findNextProcessingSegmentBoundaryIndex(items: TimelineItem[], startIndex: number): number {
  for (let index = startIndex; index < items.length; index += 1) {
    if (isUserMessageItem(items[index]) || items[index]?.type === 'compaction-divider') {
      return index
    }
  }
  return -1
}

function isUserMessageItem(item: TimelineItem | undefined): boolean {
  return item?.type === 'message' && item.message.role === 'user'
}

function hasAssistantToolCall(message: ThreadMessage): boolean {
  return Boolean(message.toolCallIds?.length)
}

function countTurnsInRange(items: TimelineItem[], startIndex: number, endIndex: number): number {
  let userMessageCount = 0
  for (let index = startIndex; index < endIndex; index += 1) {
    if (isUserMessageItem(items[index])) {
      userMessageCount += 1
    }
  }
  return Math.max(1, userMessageCount)
}

function formatProcessingDuration(
  promptItem: TimelineItem,
  items: TimelineItem[],
  hiddenStartIndex: number,
  hiddenEndIndex: number,
  finalReplyItem: TimelineItem | undefined,
  now: number
): string | undefined {
  const startedAt =
    getTimelineItemStartTime(promptItem) ??
    findTimelineStartTimeInRange(items, hiddenStartIndex, hiddenEndIndex)
  const endedAt = getTimelineItemEndTime(finalReplyItem) ?? now
  if (startedAt === undefined || endedAt <= startedAt) {
    return undefined
  }
  const seconds = Math.max(1, Math.round((endedAt - startedAt) / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
}

function findTimelineStartTimeInRange(
  items: TimelineItem[],
  startIndex: number,
  endIndex: number
): number | undefined {
  for (let index = startIndex; index < endIndex; index += 1) {
    const time = getTimelineItemStartTime(items[index])
    if (time !== undefined) {
      return time
    }
  }
  return undefined
}

function getTimelineItemStartTime(item: TimelineItem | undefined): number | undefined {
  if (!item || item.type === 'collapsed-history') {
    return undefined
  }
  if (item.type === 'tool') {
    return parseTime(item.toolCall.startedAt)
  }
  if (item.type === 'tool-group') {
    for (const toolCall of item.toolCalls) {
      const time = parseTime(toolCall.startedAt)
      if (time !== undefined) {
        return time
      }
    }
    return undefined
  }
  if (item.type === 'compaction-divider') {
    return parseTime(item.message.createdAt)
  }
  return parseTime(item.message.createdAt)
}

function getTimelineItemEndTime(item: TimelineItem | undefined): number | undefined {
  if (!item || item.type === 'collapsed-history') {
    return undefined
  }
  if (item.type === 'tool') {
    return parseTime(item.toolCall.finishedAt ?? item.toolCall.startedAt)
  }
  if (item.type === 'tool-group') {
    for (let index = item.toolCalls.length - 1; index >= 0; index -= 1) {
      const toolCall = item.toolCalls[index]
      const time = parseTime(toolCall.finishedAt ?? toolCall.startedAt)
      if (time !== undefined) {
        return time
      }
    }
    return undefined
  }
  if (item.type === 'compaction-divider') {
    return parseTime(item.message.createdAt)
  }
  return parseTime(item.message.createdAt)
}

function hasFollowingResponseContent(
  content: unknown[],
  index: number,
  hasToolCalls: boolean
): boolean {
  if (hasToolCalls) {
    return true
  }
  for (let nextIndex = index + 1; nextIndex < content.length; nextIndex += 1) {
    const part = content[nextIndex]
    if (
      isRecord(part) &&
      part.type === 'text' &&
      typeof part.text === 'string' &&
      Boolean(part.text)
    ) {
      return true
    }
  }
  return false
}

function isCompactionMessage(message: ThreadMessage): boolean {
  return message.role === 'system' && message.systemEvent?.kind === 'compaction'
}

function isGenericToolName(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '' || value === 'tool'
}

function parseTime(value: string | undefined): number | undefined {
  if (!value) {
    return undefined
  }
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? undefined : time
}

function getToolCallRevision(toolCall: DesktopToolCall | undefined): unknown[] {
  if (!toolCall) {
    return []
  }
  return [
    toolCall.toolCallId,
    toolCall.toolName,
    toolCall.status,
    toolCall.args,
    toolCall.partialResult,
    toolCall.result,
    toolCall.startedAt,
    toolCall.finishedAt
  ]
}
