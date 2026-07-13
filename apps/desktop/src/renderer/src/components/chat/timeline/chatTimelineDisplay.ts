import type { DesktopToolCall } from '@coding-agent-desktop-src/protocol/tool'
import type {
  MessageRenderState,
  WorkspaceRuntimeTimelineEvent,
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
  | {
      type: 'runtime-event'
      key: string
      event: WorkspaceRuntimeTimelineEvent
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

interface ProcessingCollapseResultMetadata {
  items: TimelineItem[]
  isRunning: boolean
  activeSessionId: string | undefined
}

interface CachedMessageTimelineItem {
  revision: number
  renderState: MessageRenderState['renderState']
  item: Extract<TimelineItem, { type: 'message' }>
}

interface CachedAssistantTimelineSegments {
  revision: number
  renderState: MessageRenderState['renderState']
  hideThinkingBlock: boolean
  raw: ThreadMessage['raw']
  text: ThreadMessage['text']
  toolCallIds: ThreadMessage['toolCallIds']
  segments: AssistantTimelineSegment[]
}

export interface CreateTimelineItemsInput {
  messages: ThreadMessage[]
  toolCallStructures: WorkspaceToolCallStructure[]
  runtimeEvents?: WorkspaceRuntimeTimelineEvent[]
  getMessageRenderState: (message: ThreadMessage) => MessageRenderState
  resolveTimelineToolCall: (toolCallId: string) => DesktopToolCall | undefined
  getToolResultMessageToolCall: (message: ThreadMessage) => DesktopToolCall | undefined
  hideThinkingBlock: boolean
}

export interface TimelineProjectionCache {
  items: TimelineItem[] | undefined
  messageRefs: ThreadMessage[]
  revisions: number[]
  renderStates: MessageRenderState['renderState'][]
  rawRefs: ThreadMessage['raw'][]
  textValues: ThreadMessage['text'][]
  toolCallIdRefs: Array<ThreadMessage['toolCallIds']>
  hideThinkingBlock: boolean
  independentMessages: boolean
}

const timelineChangedStartIndexes = new WeakMap<TimelineItem[], number>()
const processingCollapseResultMetadata = new WeakMap<
  ProcessingCollapseResult,
  ProcessingCollapseResultMetadata
>()
const messageTimelineItemCache = new WeakMap<ThreadMessage, CachedMessageTimelineItem>()
const assistantTimelineSegmentsCache = new WeakMap<ThreadMessage, CachedAssistantTimelineSegments>()

export function getTimelineChangedStartIndex(items: TimelineItem[]): number {
  return timelineChangedStartIndexes.get(items) ?? 0
}

export function stabilizeTimelineItems(
  items: TimelineItem[],
  previous: TimelineItem[] | undefined
): TimelineItem[] {
  if (!previous) {
    timelineChangedStartIndexes.set(items, 0)
    return items
  }

  let changedStartIndex = Math.min(previous.length, items.length)
  let hasSameOrder = true
  const stableItems = new Array<TimelineItem>(items.length)

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const previousItem = previous[index]
    if (!item || previousItem?.key !== item.key) {
      changedStartIndex = Math.min(changedStartIndex, index)
      hasSameOrder = false
      break
    }
    if (previousItem === item || isSameTimelineItemProjection(previousItem, item)) {
      stableItems[index] = previousItem
    } else {
      stableItems[index] = item
      changedStartIndex = Math.min(changedStartIndex, index)
    }
  }

  if (!hasSameOrder) {
    const previousByKey = new Map(previous.map((item) => [item.key, item]))
    for (let index = changedStartIndex; index < items.length; index += 1) {
      const item = items[index]
      if (!item) {
        continue
      }
      const previousItem = previousByKey.get(item.key)
      stableItems[index] =
        previousItem && isSameTimelineItemProjection(previousItem, item) ? previousItem : item
    }
  }

  const hasChanged = changedStartIndex < items.length || previous.length !== items.length
  if (!hasChanged) {
    return previous
  }
  timelineChangedStartIndexes.set(stableItems, changedStartIndex)
  return stableItems
}

export function createTimelineProjectionCache(): TimelineProjectionCache {
  return {
    items: undefined,
    messageRefs: [],
    revisions: [],
    renderStates: [],
    rawRefs: [],
    textValues: [],
    toolCallIdRefs: [],
    hideThinkingBlock: true,
    independentMessages: false
  }
}

export function projectTimelineItems(
  input: CreateTimelineItemsInput,
  previous: TimelineItem[] | undefined,
  cache: TimelineProjectionCache
): TimelineItem[] {
  if (canAppendIndependentTimelineItems(input, previous, cache)) {
    const previousMessageCount = cache.messageRefs.length
    const appendedMessages = input.messages.slice(previousMessageCount)
    if (appendedMessages.length === 0) {
      return previous as TimelineItem[]
    }
    const appendedItems = createTimelineItems({ ...input, messages: appendedMessages })
    appendTimelineProjectionCache(cache, input, previousMessageCount)
    if (appendedItems.length === 0) {
      return previous as TimelineItem[]
    }
    const items = [...(previous as TimelineItem[]), ...appendedItems]
    timelineChangedStartIndexes.set(items, previous?.length ?? 0)
    cache.items = items
    return items
  }

  const items = stabilizeTimelineItems(createTimelineItems(input), previous)
  replaceTimelineProjectionCache(cache, input, items)
  return items
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
    if (isCompactionMessage(message)) {
      flushPendingToolGroup()
      items.push({
        type: 'compaction-divider',
        key: `${message.id}:compaction`,
        message
      })
      continue
    }
    const renderState = input.getMessageRenderState(message)
    if (message.role === 'assistant') {
      const assistantSegments = getCachedAssistantTimelineSegments(
        message,
        renderState,
        input.hideThinkingBlock
      )
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
    items.push(
      toolCall
        ? {
            type: 'message',
            key: message.id,
            message,
            toolCall,
            revision: renderState.revision,
            renderState: renderState.renderState
          }
        : getCachedMessageTimelineItem(message, renderState)
    )
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

  insertRuntimeTimelineEvents(items, input.runtimeEvents ?? [])

  return groupTimelineTools(items)
}

function canAppendIndependentTimelineItems(
  input: CreateTimelineItemsInput,
  previous: TimelineItem[] | undefined,
  cache: TimelineProjectionCache
): boolean {
  if (
    !previous ||
    cache.items !== previous ||
    !cache.independentMessages ||
    cache.hideThinkingBlock !== input.hideThinkingBlock ||
    input.toolCallStructures.length > 0 ||
    (input.runtimeEvents?.length ?? 0) > 0 ||
    input.messages.length < cache.messageRefs.length
  ) {
    return false
  }

  for (let index = 0; index < cache.messageRefs.length; index += 1) {
    const message = input.messages[index]
    if (
      message !== cache.messageRefs[index] ||
      message.raw !== cache.rawRefs[index] ||
      message.text !== cache.textValues[index] ||
      message.toolCallIds !== cache.toolCallIdRefs[index]
    ) {
      return false
    }
    const renderState = input.getMessageRenderState(message)
    if (
      renderState.revision !== cache.revisions[index] ||
      renderState.renderState !== cache.renderStates[index]
    ) {
      return false
    }
  }

  for (let index = cache.messageRefs.length; index < input.messages.length; index += 1) {
    const message = input.messages[index]
    if (!message || hasPotentialToolTimelineDependency(message)) {
      return false
    }
  }
  return true
}

function replaceTimelineProjectionCache(
  cache: TimelineProjectionCache,
  input: CreateTimelineItemsInput,
  items: TimelineItem[]
): void {
  cache.items = items
  cache.messageRefs = input.messages.slice()
  cache.revisions = []
  cache.renderStates = []
  cache.rawRefs = []
  cache.textValues = []
  cache.toolCallIdRefs = []
  cache.hideThinkingBlock = input.hideThinkingBlock
  cache.independentMessages =
    input.toolCallStructures.length === 0 &&
    (input.runtimeEvents?.length ?? 0) === 0 &&
    input.messages.every((message) => !hasPotentialToolTimelineDependency(message))
  appendTimelineProjectionCache(cache, input, 0)
}

function appendTimelineProjectionCache(
  cache: TimelineProjectionCache,
  input: CreateTimelineItemsInput,
  startIndex: number
): void {
  for (let index = startIndex; index < input.messages.length; index += 1) {
    const message = input.messages[index]
    if (!message) {
      continue
    }
    const renderState = input.getMessageRenderState(message)
    cache.messageRefs[index] = message
    cache.revisions[index] = renderState.revision
    cache.renderStates[index] = renderState.renderState
    cache.rawRefs[index] = message.raw
    cache.textValues[index] = message.text
    cache.toolCallIdRefs[index] = message.toolCallIds
  }
}

function hasPotentialToolTimelineDependency(message: ThreadMessage): boolean {
  if (message.role === 'tool' || (message.toolCallIds?.length ?? 0) > 0) {
    return true
  }
  const content = getMessageRawRecord(message).content
  return (
    Array.isArray(content) && content.some((part) => isRecord(part) && part.type === 'toolCall')
  )
}

function insertRuntimeTimelineEvents(
  items: TimelineItem[],
  events: WorkspaceRuntimeTimelineEvent[]
): void {
  for (const event of events) {
    const item: TimelineItem = {
      type: 'runtime-event',
      key: `runtime-event:${event.id}`,
      event,
      message: runtimeEventToSystemMessage(event)
    }
    const eventTime = parseTime(event.createdAt)
    const insertIndex =
      eventTime === undefined
        ? -1
        : items.findIndex((candidate) => {
            const candidateTime = getTimelineItemStartTime(candidate)
            return candidateTime !== undefined && candidateTime > eventTime
          })
    if (insertIndex < 0) {
      items.push(item)
    } else {
      items.splice(insertIndex, 0, item)
    }
  }
}

function isSameTimelineItemProjection(left: TimelineItem, right: TimelineItem): boolean {
  if (left.type !== right.type || left.key !== right.key) {
    return false
  }
  if (left.type === 'collapsed-history' && right.type === 'collapsed-history') {
    return (
      left.hiddenCount === right.hiddenCount &&
      left.hiddenTurnCount === right.hiddenTurnCount &&
      left.durationLabel === right.durationLabel &&
      left.collapsible === right.collapsible
    )
  }
  if (left.type === 'message' && right.type === 'message') {
    return (
      left.message === right.message &&
      left.text === right.text &&
      left.toolCall === right.toolCall &&
      left.revision === right.revision &&
      left.renderState === right.renderState
    )
  }
  if (left.type === 'thinking' && right.type === 'thinking') {
    return (
      left.message === right.message &&
      left.text === right.text &&
      left.collapseWhenResponseAppears === right.collapseWhenResponseAppears &&
      left.revision === right.revision &&
      left.renderState === right.renderState
    )
  }
  if (left.type === 'tool' && right.type === 'tool') {
    return isSameToolCallProjection(left.toolCall, right.toolCall)
  }
  if (left.type === 'tool-group' && right.type === 'tool-group') {
    return (
      left.summary === right.summary &&
      isSameStringArray(left.toolCallIds, right.toolCallIds) &&
      left.toolCalls.length === right.toolCalls.length &&
      left.toolCalls.every((toolCall, index) =>
        isSameToolCallProjection(toolCall, right.toolCalls[index])
      )
    )
  }
  if (left.type === 'compaction-divider' && right.type === 'compaction-divider') {
    return left.message === right.message
  }
  if (left.type === 'runtime-event' && right.type === 'runtime-event') {
    return left.event === right.event
  }
  return false
}

function isSameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isSameToolCallProjection(
  left: DesktopToolCall,
  right: DesktopToolCall | undefined
): boolean {
  return (
    left === right ||
    (right !== undefined &&
      left.threadId === right.threadId &&
      left.toolCallId === right.toolCallId &&
      left.toolName === right.toolName &&
      left.status === right.status &&
      left.args === right.args &&
      left.partialResult === right.partialResult &&
      left.result === right.result &&
      left.resultSummary === right.resultSummary &&
      left.startedAt === right.startedAt &&
      left.finishedAt === right.finishedAt)
  )
}

function runtimeEventToSystemMessage(event: WorkspaceRuntimeTimelineEvent): ThreadMessage {
  return {
    id: `runtime-event:${event.id}`,
    role: 'system',
    text: event.message,
    systemEvent: {
      kind: 'agentEvent',
      title: event.title,
      description: event.message,
      meta: event.meta
    },
    raw: {
      role: 'system',
      content: event.message
    } as unknown as ThreadMessage['raw'],
    createdAt: event.createdAt
  }
}

function getStableToolGroupKey(toolCallIds: string[]): string | undefined {
  return toolCallIds[0] ? `tool-group:${toolCallIds[0]}` : undefined
}

interface GetAssistantTimelineItemsOptions {
  hideThinkingBlock: boolean
}

function getCachedMessageTimelineItem(
  message: ThreadMessage,
  renderState: MessageRenderState
): Extract<TimelineItem, { type: 'message' }> {
  const cached = messageTimelineItemCache.get(message)
  if (cached?.revision === renderState.revision && cached.renderState === renderState.renderState) {
    return cached.item
  }
  const item: Extract<TimelineItem, { type: 'message' }> = {
    type: 'message',
    key: message.id,
    message,
    revision: renderState.revision,
    renderState: renderState.renderState
  }
  messageTimelineItemCache.set(message, {
    revision: renderState.revision,
    renderState: renderState.renderState,
    item
  })
  return item
}

function getCachedAssistantTimelineSegments(
  message: ThreadMessage,
  renderState: MessageRenderState,
  hideThinkingBlock: boolean
): AssistantTimelineSegment[] {
  const cached = assistantTimelineSegmentsCache.get(message)
  if (
    cached?.revision === renderState.revision &&
    cached.renderState === renderState.renderState &&
    cached.hideThinkingBlock === hideThinkingBlock &&
    cached.raw === message.raw &&
    cached.text === message.text &&
    cached.toolCallIds === message.toolCallIds
  ) {
    return cached.segments
  }
  const segments = getAssistantTimelineSegments(message, renderState, { hideThinkingBlock })
  assistantTimelineSegmentsCache.set(message, {
    revision: renderState.revision,
    renderState: renderState.renderState,
    hideThinkingBlock,
    raw: message.raw,
    text: message.text,
    toolCallIds: message.toolCallIds,
    segments
  })
  return segments
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

export function createProcessingCollapseResult(
  input: {
    items: TimelineItem[]
    isRunning: boolean
    activeSessionId: string | undefined
    now: number
  },
  previous?: ProcessingCollapseResult
): ProcessingCollapseResult {
  const { items } = input
  const previousMetadata = previous ? processingCollapseResultMetadata.get(previous) : undefined
  if (
    previous &&
    previousMetadata?.items === items &&
    previousMetadata.isRunning === input.isRunning &&
    previousMetadata.activeSessionId === input.activeSessionId
  ) {
    const activeContextIndex = previous.contexts.findIndex((context) => !context.collapsible)
    if (activeContextIndex < 0) {
      return previous
    }
    const activeContext = previous.contexts[activeContextIndex]
    if (activeContext) {
      const durationLabel = formatProcessingDuration(
        items[activeContext.boundaryIndex - 1],
        items,
        activeContext.boundaryIndex,
        activeContext.processEndIndex,
        undefined,
        input.now
      )
      if (durationLabel === activeContext.durationLabel) {
        return previous
      }
      const contexts = previous.contexts.slice()
      contexts[activeContextIndex] = { ...activeContext, durationLabel }
      const result = { contexts, finalReplyKeys: previous.finalReplyKeys }
      processingCollapseResultMetadata.set(result, {
        items,
        isRunning: input.isRunning,
        activeSessionId: input.activeSessionId
      })
      return result
    }
  }
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
    const hiddenCount = countHiddenItemsInCollapsedRange(items, boundaryIndex, processEndIndex)
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
  const result = { contexts, finalReplyKeys }
  processingCollapseResultMetadata.set(result, {
    items,
    isRunning: input.isRunning,
    activeSessionId: input.activeSessionId
  })
  return result
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
  if (item.type === 'runtime-event') {
    return [item.event.id, item.event.title, item.event.message, item.event.createdAt]
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
    if (isVisibleItemInCollapsedRange(item)) {
      target.push(item)
    }
  }
}

function countHiddenItemsInCollapsedRange(
  items: TimelineItem[],
  startIndex: number,
  endIndex: number
): number {
  let count = 0
  for (let index = startIndex; index < endIndex; index += 1) {
    if (!isVisibleItemInCollapsedRange(items[index])) {
      count += 1
    }
  }
  return count
}

function isVisibleItemInCollapsedRange(item: TimelineItem | undefined): boolean {
  return item?.type === 'compaction-divider' || item?.type === 'runtime-event'
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
    if (isUserMessageItem(items[index])) {
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
