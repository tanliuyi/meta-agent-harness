import type { ChatMessagePart, ChatUIMessage } from './types'

export type ChatToolDisplayStatus = 'running' | 'succeeded' | 'failed'

export type ChatProjectionIssueCode =
  | 'duplicate-tool-call-id'
  | 'duplicate-tool-result'
  | 'invalid-tool-arguments'
  | 'invalid-tool-result-state'
  | 'invalid-tool-state'
  | 'missing-message-id'
  | 'missing-tool-call-id'
  | 'orphan-tool-result'

export interface ChatProjectionIssue {
  code: ChatProjectionIssueCode
  key: string
  message: string
  messageId?: string
  toolCallId?: string
  context: Record<string, unknown>
}

export interface ChatMessageDisplayItem {
  type: 'message'
  key: string
  message: ChatUIMessage
  sourceMessageId: string
  sourceHasToolCall: boolean
  partType?: ChatMessagePart['type']
}

export interface ChatDisplayToolCall {
  id: string
  name: string
  rawArguments: string
  args?: unknown
  argumentError?: string
  state: Extract<ChatMessagePart, { type: 'tool-call' }>['state']
  status: ChatToolDisplayStatus
  output?: unknown
  approval?: Extract<ChatMessagePart, { type: 'tool-call' }>['approval']
  sourceMessageId: string
}

export interface ChatToolGroupSummaryPart {
  key: string
  text: string
  status: ChatToolDisplayStatus
}

export interface ChatToolGroupDisplayItem {
  type: 'tool-group'
  key: string
  toolCallIds: string[]
  toolCalls: ChatDisplayToolCall[]
  status: ChatToolDisplayStatus
  summary: string
  summaryParts: ChatToolGroupSummaryPart[]
}

export interface ChatCollapsedHistoryDisplayItem {
  type: 'collapsed-history'
  key: string
  hiddenCount: number
  durationLabel?: string
  collapsible: boolean
}

export interface ChatProtocolErrorDisplayItem {
  type: 'protocol-error'
  key: string
  issue: ChatProjectionIssue
}

export type ChatDisplayItem =
  | ChatMessageDisplayItem
  | ChatToolGroupDisplayItem
  | ChatCollapsedHistoryDisplayItem
  | ChatProtocolErrorDisplayItem

export interface ProjectChatDisplayOptions {
  stateKey: string
  isRunning: boolean
  isHistoryOpen?: (item: ChatCollapsedHistoryDisplayItem) => boolean
}

export interface ChatDisplayProjection {
  items: ChatDisplayItem[]
  issues: ChatProjectionIssue[]
  availableToolGroupKeys: string[]
  availableHistoryKeys: string[]
}

interface ToolResultEntry {
  part: Extract<ChatMessagePart, { type: 'tool-result' }>
  messageId: string
}

interface ToolActionDescriptor {
  verb: string
  noun: string
  useUniquePath: boolean
  order: number
}

const validToolStates = new Set([
  'awaiting-input',
  'input-streaming',
  'input-complete',
  'approval-requested',
  'approval-responded',
  'complete',
  'error'
])

const validToolResultStates = new Set(['streaming', 'complete', 'error'])

const incompleteArgumentStates = new Set(['awaiting-input', 'input-streaming'])

export function projectChatDisplay(
  messages: readonly ChatUIMessage[],
  options: ProjectChatDisplayOptions
): ChatDisplayProjection {
  const issues: ChatProjectionIssue[] = []
  const baseItems = projectBaseItems(messages, issues)
  const items = applyProcessingCollapse(baseItems, options)
  return {
    items,
    issues,
    availableToolGroupKeys: baseItems
      .filter((item): item is ChatToolGroupDisplayItem => item.type === 'tool-group')
      .map((item) => item.key),
    availableHistoryKeys: items
      .filter((item): item is ChatCollapsedHistoryDisplayItem => item.type === 'collapsed-history')
      .map((item) => item.key)
  }
}

function projectBaseItems(
  messages: readonly ChatUIMessage[],
  issues: ChatProjectionIssue[]
): ChatDisplayItem[] {
  const items: ChatDisplayItem[] = []
  const toolResults = collectToolResults(messages)
  const knownToolCallIds = collectToolCallIds(messages)
  const consumedToolResultIds = new Set<string>()
  const seenToolCallIds = new Set<string>()
  const seenToolResultIds = new Set<string>()
  let pendingTools: ChatDisplayToolCall[] = []

  const flushTools = (): void => {
    if (pendingTools.length === 0) return
    items.push(createToolGroup(pendingTools))
    pendingTools = []
  }

  messages.forEach((message) => {
    const messageId = readStableId(message.id)
    if (!messageId) {
      flushTools()
      const issue = createIssue('missing-message-id', '消息缺少稳定 ID', {
        role: message.role,
        parts: message.parts.map((part) => part.type)
      })
      issues.push(issue)
      items.push(toProtocolErrorItem(issue))
      return
    }

    if (message.role !== 'assistant') {
      flushTools()
      items.push({
        type: 'message',
        key: messageId,
        message,
        sourceMessageId: messageId,
        sourceHasToolCall: message.parts.some((part) => part.type === 'tool-call')
      })
      return
    }

    const sourceHasToolCall = message.parts.some((part) => part.type === 'tool-call')
    message.parts.forEach((part, partIndex) => {
      if (part.type === 'tool-result') {
        const toolCallId = readStableId(part.toolCallId)
        if (!toolCallId) {
          flushTools()
          const issue = createIssue(
            'missing-tool-call-id',
            '工具结果缺少 toolCallId',
            { messageId, partType: part.type },
            messageId
          )
          issues.push(issue)
          items.push(toProtocolErrorItem(issue))
        } else if (!validToolResultStates.has(part.state)) {
          flushTools()
          const issue = createIssue(
            'invalid-tool-result-state',
            '工具结果包含未知状态',
            { messageId, toolCallId, state: part.state },
            messageId,
            toolCallId
          )
          issues.push(issue)
          items.push(toProtocolErrorItem(issue))
        } else if (seenToolResultIds.has(toolCallId)) {
          flushTools()
          const issue = createIssue(
            'duplicate-tool-result',
            '检测到重复的工具结果',
            { messageId, toolCallId },
            messageId,
            toolCallId
          )
          issues.push(issue)
          items.push(toProtocolErrorItem(issue))
        } else if (!knownToolCallIds.has(toolCallId)) {
          seenToolResultIds.add(toolCallId)
          flushTools()
          const issue = createIssue(
            'orphan-tool-result',
            '工具结果无法关联到工具调用',
            { messageId, toolCallId },
            messageId,
            toolCallId
          )
          issues.push(issue)
          items.push(toProtocolErrorItem(issue))
        } else {
          seenToolResultIds.add(toolCallId)
        }
        return
      }

      if (part.type !== 'tool-call') {
        flushTools()
        items.push({
          type: 'message',
          key: `${messageId}:part:${partIndex}:${part.type}`,
          message: { ...message, id: `${messageId}:part:${partIndex}`, parts: [part] },
          sourceMessageId: messageId,
          sourceHasToolCall,
          partType: part.type
        })
        return
      }

      const toolCallId = readStableId(part.id)
      if (!toolCallId) {
        flushTools()
        const issue = createIssue(
          'missing-tool-call-id',
          '工具调用缺少稳定 ID',
          { messageId, toolName: part.name },
          messageId
        )
        issues.push(issue)
        items.push(toProtocolErrorItem(issue))
        return
      }
      if (seenToolCallIds.has(toolCallId)) {
        flushTools()
        const issue = createIssue(
          'duplicate-tool-call-id',
          '检测到重复的 toolCallId',
          { messageId, toolCallId, toolName: part.name },
          messageId,
          toolCallId
        )
        issues.push(issue)
        items.push(toProtocolErrorItem(issue))
        return
      }
      seenToolCallIds.add(toolCallId)

      if (!validToolStates.has(part.state)) {
        flushTools()
        const issue = createIssue(
          'invalid-tool-state',
          '工具调用包含未知状态',
          { messageId, toolCallId, state: part.state },
          messageId,
          toolCallId
        )
        issues.push(issue)
        items.push(toProtocolErrorItem(issue))
        return
      }

      const result = toolResults.get(toolCallId)
      if (result) consumedToolResultIds.add(toolCallId)
      const parsedArguments = parseToolArguments(part.arguments, part.state)
      if (parsedArguments.error) {
        issues.push(
          createIssue(
            'invalid-tool-arguments',
            '工具参数不是有效 JSON',
            {
              messageId,
              toolCallId,
              toolName: part.name,
              rawArguments: part.arguments,
              error: parsedArguments.error
            },
            messageId,
            toolCallId
          )
        )
      }

      pendingTools.push({
        id: toolCallId,
        name: part.name,
        rawArguments: part.arguments,
        ...(parsedArguments.value !== undefined && { args: parsedArguments.value }),
        ...(parsedArguments.error && { argumentError: parsedArguments.error }),
        state: part.state,
        status: normalizeToolStatus(part.state, result?.part),
        ...(result
          ? { output: result.part.error ? { error: result.part.error } : result.part.content }
          : part.output !== undefined
            ? { output: part.output }
            : {}),
        ...(part.approval && { approval: part.approval }),
        sourceMessageId: messageId
      })
    })
  })

  flushTools()

  for (const [toolCallId, result] of toolResults) {
    if (consumedToolResultIds.has(toolCallId) || !knownToolCallIds.has(toolCallId)) continue
    const issue = createIssue(
      'orphan-tool-result',
      '工具结果未被对应调用消费',
      { messageId: result.messageId, toolCallId },
      result.messageId,
      toolCallId
    )
    issues.push(issue)
    items.push(toProtocolErrorItem(issue))
  }

  return items
}

function collectToolCallIds(messages: readonly ChatUIMessage[]): Set<string> {
  const ids = new Set<string>()
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'tool-call' && readStableId(part.id)) ids.add(part.id)
    }
  }
  return ids
}

function collectToolResults(messages: readonly ChatUIMessage[]): Map<string, ToolResultEntry> {
  const results = new Map<string, ToolResultEntry>()
  for (const message of messages) {
    const messageId = readStableId(message.id)
    for (const part of message.parts) {
      if (part.type !== 'tool-result') continue
      const toolCallId = readStableId(part.toolCallId)
      if (!messageId || !toolCallId || !validToolResultStates.has(part.state)) continue
      if (results.has(toolCallId)) continue
      results.set(toolCallId, { part, messageId })
    }
  }
  return results
}

function applyProcessingCollapse(
  baseItems: ChatDisplayItem[],
  options: ProjectChatDisplayOptions
): ChatDisplayItem[] {
  const items: ChatDisplayItem[] = []
  let cursor = 0

  for (let index = 0; index < baseItems.length; index += 1) {
    const item = baseItems[index]
    if (!isUserMessage(item)) continue

    appendRange(items, baseItems, cursor, index + 1)
    const nextUserIndex = findNextUserIndex(baseItems, index + 1)
    const segmentEnd = nextUserIndex < 0 ? baseItems.length : nextUserIndex
    const turnEnded = nextUserIndex >= 0 || !options.isRunning
    const finalReplyIndex = turnEnded ? findFinalReplyIndex(baseItems, index + 1, segmentEnd) : -1
    const processEnd = finalReplyIndex >= 0 ? finalReplyIndex : segmentEnd
    const hideableItems = baseItems
      .slice(index + 1, processEnd)
      .filter((candidate) => !isAlwaysVisibleInCollapsedRange(candidate))
    const activeSegment = nextUserIndex < 0 && !turnEnded

    if (hideableItems.length > 0 || activeSegment) {
      const collapsedItem = createCollapsedHistoryItem(
        options.stateKey,
        item,
        hideableItems.length,
        activeSegment ? false : true,
        getDurationLabel(item, finalReplyIndex >= 0 ? baseItems[finalReplyIndex] : undefined)
      )
      items.push(collapsedItem)
      const open = !collapsedItem.collapsible || options.isHistoryOpen?.(collapsedItem) === true
      if (open) {
        appendRange(items, baseItems, index + 1, processEnd)
      } else {
        for (let hiddenIndex = index + 1; hiddenIndex < processEnd; hiddenIndex += 1) {
          const candidate = baseItems[hiddenIndex]
          if (candidate && isAlwaysVisibleInCollapsedRange(candidate)) items.push(candidate)
        }
      }
    } else {
      appendRange(items, baseItems, index + 1, processEnd)
    }

    cursor = processEnd
    index = processEnd - 1
  }

  appendRange(items, baseItems, cursor, baseItems.length)
  return items
}

function createToolGroup(toolCalls: ChatDisplayToolCall[]): ChatToolGroupDisplayItem {
  const summaryParts = summarizeToolCalls(toolCalls)
  return {
    type: 'tool-group',
    key: toolCalls[0]!.id,
    toolCallIds: toolCalls.map((toolCall) => toolCall.id),
    toolCalls,
    status: getToolGroupStatus(toolCalls),
    summary: summaryParts.map((part) => part.text).join('，'),
    summaryParts
  }
}

function summarizeToolCalls(toolCalls: ChatDisplayToolCall[]): ChatToolGroupSummaryPart[] {
  const descriptors = new Map<
    string,
    {
      descriptor: ToolActionDescriptor
      status: ChatToolDisplayStatus
      calls: ChatDisplayToolCall[]
    }
  >()
  for (const toolCall of toolCalls) {
    const descriptor = getToolActionDescriptor(toolCall.name)
    const key = `${descriptor.verb}:${descriptor.noun}:${toolCall.status}`
    const entry = descriptors.get(key) ?? { descriptor, status: toolCall.status, calls: [] }
    entry.calls.push(toolCall)
    descriptors.set(key, entry)
  }
  return [...descriptors.entries()]
    .sort(([, left], [, right]) => {
      const descriptorOrder = left.descriptor.order - right.descriptor.order
      return descriptorOrder || getStatusOrder(left.status) - getStatusOrder(right.status)
    })
    .map(([key, entry]) => {
      const count = entry.descriptor.useUniquePath
        ? countUniquePathsOrCalls(entry.calls)
        : entry.calls.length
      return {
        key,
        status: entry.status,
        text: formatSummary(entry.descriptor, count, entry.status)
      }
    })
}

function getToolActionDescriptor(name: string): ToolActionDescriptor {
  switch (name) {
    case 'read':
      return { verb: '读取', noun: '文件', useUniquePath: true, order: 0 }
    case 'edit':
      return { verb: '编辑', noun: '文件', useUniquePath: true, order: 3 }
    case 'write':
      return { verb: '写入', noun: '文件', useUniquePath: true, order: 4 }
    case 'grep':
    case 'find':
      return { verb: '搜索', noun: '次', useUniquePath: false, order: 1 }
    case 'ls':
      return { verb: '列出', noun: '目录', useUniquePath: false, order: 2 }
    case 'bash':
      return { verb: '运行', noun: '命令', useUniquePath: false, order: 5 }
    default:
      return { verb: '执行', noun: '工具', useUniquePath: false, order: 6 }
  }
}

function getStatusOrder(status: ChatToolDisplayStatus): number {
  if (status === 'running') return 0
  if (status === 'succeeded') return 1
  return 2
}

function formatSummary(
  descriptor: ToolActionDescriptor,
  count: number,
  status: ChatToolDisplayStatus
): string {
  const quantity = `${count} ${descriptor.noun}`
  if (status === 'failed') return `${quantity}失败`
  if (status === 'running') return `正在${descriptor.verb} ${quantity}`
  return `已${descriptor.verb} ${quantity}`
}

function countUniquePathsOrCalls(toolCalls: ChatDisplayToolCall[]): number {
  const paths = new Set<string>()
  for (const toolCall of toolCalls) {
    const args = toRecord(toolCall.args)
    const path = args?.path ?? args?.file_path
    if (typeof path === 'string' && path) paths.add(path)
  }
  return paths.size || toolCalls.length
}

function getToolGroupStatus(toolCalls: ChatDisplayToolCall[]): ChatToolDisplayStatus {
  if (toolCalls.some((toolCall) => toolCall.status === 'failed')) return 'failed'
  if (toolCalls.some((toolCall) => toolCall.status === 'running')) return 'running'
  return 'succeeded'
}

function normalizeToolStatus(
  state: Extract<ChatMessagePart, { type: 'tool-call' }>['state'],
  result?: Extract<ChatMessagePart, { type: 'tool-result' }>
): ChatToolDisplayStatus {
  if (result) {
    if (result.state === 'error') return 'failed'
    if (result.state === 'complete') return 'succeeded'
    return 'running'
  }
  if (state === 'error') return 'failed'
  if (state === 'complete') return 'succeeded'
  return 'running'
}

function parseToolArguments(
  raw: string,
  state: Extract<ChatMessagePart, { type: 'tool-call' }>['state']
): { value?: unknown; error?: string } {
  if (incompleteArgumentStates.has(state)) return {}
  try {
    return { value: JSON.parse(raw) as unknown }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function findFinalReplyIndex(items: ChatDisplayItem[], start: number, end: number): number {
  let candidate = -1
  for (let index = start; index < end; index += 1) {
    const item = items[index]
    if (
      item?.type === 'message' &&
      item.message.role === 'assistant' &&
      item.partType === 'text' &&
      !item.sourceHasToolCall &&
      hasVisibleText(item.message)
    ) {
      candidate = index
    }
  }
  return candidate
}

function createCollapsedHistoryItem(
  stateKey: string,
  userItem: ChatMessageDisplayItem,
  hiddenCount: number,
  collapsible: boolean,
  durationLabel: string | undefined
): ChatCollapsedHistoryDisplayItem {
  return {
    type: 'collapsed-history',
    key: `${stateKey}:${userItem.sourceMessageId}`,
    hiddenCount,
    ...(durationLabel && { durationLabel }),
    collapsible
  }
}

function getDurationLabel(
  userItem: ChatMessageDisplayItem,
  finalItem: ChatDisplayItem | undefined
): string | undefined {
  const startedAt = toTimestamp(userItem.message.createdAt)
  const endedAt =
    finalItem?.type === 'message' ? toTimestamp(finalItem.message.createdAt) : undefined
  if (startedAt === undefined || endedAt === undefined || endedAt <= startedAt) return undefined
  const seconds = Math.max(1, Math.round((endedAt - startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
}

function findNextUserIndex(items: ChatDisplayItem[], start: number): number {
  for (let index = start; index < items.length; index += 1) {
    if (isUserMessage(items[index])) return index
  }
  return -1
}

function isUserMessage(item: ChatDisplayItem | undefined): item is ChatMessageDisplayItem {
  return item?.type === 'message' && item.message.role === 'user'
}

function isAlwaysVisibleInCollapsedRange(item: ChatDisplayItem): boolean {
  return (
    item.type === 'protocol-error' || (item.type === 'message' && item.message.role === 'system')
  )
}

function hasVisibleText(message: ChatUIMessage): boolean {
  return message.parts.some((part) => part.type === 'text' && part.content.trim().length > 0)
}

function appendRange(
  target: ChatDisplayItem[],
  source: ChatDisplayItem[],
  start: number,
  end: number
): void {
  for (let index = start; index < end; index += 1) {
    const item = source[index]
    if (item) target.push(item)
  }
}

function toProtocolErrorItem(issue: ChatProjectionIssue): ChatProtocolErrorDisplayItem {
  return { type: 'protocol-error', key: issue.key, issue }
}

function createIssue(
  code: ChatProjectionIssueCode,
  message: string,
  context: Record<string, unknown>,
  messageId?: string,
  toolCallId?: string
): ChatProjectionIssue {
  const fingerprint = stableHash(JSON.stringify({ code, messageId, toolCallId, context }))
  return {
    code,
    key: `protocol-error:${code}:${fingerprint}`,
    message,
    ...(messageId && { messageId }),
    ...(toolCallId && { toolCallId }),
    context
  }
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function readStableId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}

function toTimestamp(value: Date | undefined): number | undefined {
  if (!(value instanceof Date)) return undefined
  const timestamp = value.getTime()
  return Number.isFinite(timestamp) ? timestamp : undefined
}
