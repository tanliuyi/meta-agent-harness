import type { ThreadSnapshot } from '@shared/coding-agent/types'
import { isRecord } from '../../support/message-format'

export type ToolCall = ThreadSnapshot['toolCalls'][number]
export type GroupableToolCall = Pick<ToolCall, 'toolCallId' | 'toolName' | 'status' | 'args'>
export type ToolGroupStatus = ToolCall['status']

interface ToolGroupSummaryDescriptor {
  key: string
  verb: string
  noun: string
  count: number
  status: ToolGroupStatus
}

export interface ToolGroupSummaryPart {
  key: string
  text: string
  status: ToolGroupStatus
}

export interface ToolGroupTimelineItem {
  type: 'tool-group'
  key: string
  toolCallIds: string[]
  toolCalls: ToolCall[]
  summary: string
}

export type GroupableTimelineItem<TMessage = unknown> =
  | {
      type: 'tool'
      key: string
      toolCall: ToolCall
    }
  | {
      type: 'message'
      key: string
      message: TMessage
      toolCall?: ToolCall
    }
  | {
      type: string
      key: string
    }

export type GroupedTimelineItem<TItem> = TItem | ToolGroupTimelineItem

/**
 * 将连续工具调用合并为 timeline tool group。
 * @param items - 原始 timeline 项。
 * @returns 分组后的 timeline 项。
 */
export function groupTimelineTools<TItem extends GroupableTimelineItem>(
  items: TItem[]
): Array<GroupedTimelineItem<TItem>> {
  const result: Array<GroupedTimelineItem<TItem>> = []
  let pendingItems: TItem[] = []
  let pendingToolCalls: ToolCall[] = []

  const flushPending = (): void => {
    if (pendingItems.length === 0) {
      return
    }
    if (pendingItems.length > 1) {
      result.push(createToolGroupTimelineItem(pendingToolCalls))
    } else {
      result.push(...pendingItems)
    }
    pendingItems = []
    pendingToolCalls = []
  }

  for (const item of items) {
    const toolCall = getTimelineItemToolCall(item)
    if (!toolCall) {
      flushPending()
      result.push(item)
      continue
    }
    pendingItems.push(item)
    pendingToolCalls.push(toolCall)
  }

  flushPending()
  return result
}

/**
 * 创建通用工具组 timeline item。
 * @param toolCalls - 工具调用列表。
 * @param key - 可选稳定 key。
 * @returns 工具组 timeline item。
 */
export function createToolGroupTimelineItem(
  toolCalls: ToolCall[],
  key = `tool-group:${toolCalls[0]?.toolCallId ?? 'empty'}`
): ToolGroupTimelineItem {
  const toolCallIds = toolCalls.map((toolCall) => toolCall.toolCallId)
  return {
    type: 'tool-group',
    key,
    toolCallIds,
    toolCalls,
    summary: summarizeToolGroup(toolCalls)
  }
}

/**
 * 聚合工具组状态。
 * @param toolCalls - 工具调用列表。
 * @returns 组状态。
 */
export function getToolGroupStatus(toolCalls: ToolCall[]): ToolGroupStatus | undefined {
  if (toolCalls.some((toolCall) => toolCall.status === 'failed')) {
    return 'failed'
  }
  if (toolCalls.some((toolCall) => toolCall.status === 'running')) {
    return 'running'
  }
  if (toolCalls.some((toolCall) => toolCall.status === 'queued')) {
    return 'queued'
  }
  if (toolCalls.length > 0 && toolCalls.every((toolCall) => toolCall.status === 'succeeded')) {
    return 'succeeded'
  }
  if (toolCalls.some((toolCall) => toolCall.status === 'cancelled')) {
    return 'cancelled'
  }
  return toolCalls[0]?.status
}

/**
 * 生成通用工具组摘要。
 * @param toolCalls - 工具调用列表。
 * @returns 摘要。
 */
export function summarizeToolGroup(toolCalls: GroupableToolCall[]): string {
  return summarizeToolGroupParts(toolCalls)
    .map((part) => part.text)
    .join('，')
}

/**
 * 生成通用工具组摘要片段，保留每个片段对应的状态，便于 UI 精确展示错误。
 * @param toolCalls - 工具调用列表。
 * @returns 摘要片段。
 */
export function summarizeToolGroupParts(toolCalls: GroupableToolCall[]): ToolGroupSummaryPart[] {
  return [
    ...summarizeByStatus(toolCalls, 'read', '读取', '文件', countUniqueToolPaths),
    ...summarizeByStatus(toolCalls, ['grep', 'find'], '搜索', '次', countTools),
    ...summarizeByStatus(toolCalls, 'ls', '列出', '目录', countTools),
    ...summarizeByStatus(toolCalls, 'edit', '编辑', '文件', countUniqueToolPaths),
    ...summarizeByStatus(toolCalls, 'write', '写入', '文件', countUniqueToolPaths),
    ...summarizeByStatus(toolCalls, 'bash', '运行', '命令', countTools),
    ...summarizeGenericToolsByStatus(toolCalls)
  ]
}

/**
 * 获取工具调用文件路径。
 * @param toolCall - 工具调用。
 * @returns 文件路径。
 */
export function getToolCallPath(toolCall: GroupableToolCall): string | undefined {
  if (!isRecord(toolCall.args)) {
    return undefined
  }
  const path = toolCall.args.path ?? toolCall.args.file_path
  return typeof path === 'string' && path ? path : undefined
}

function getTimelineItemToolCall(item: GroupableTimelineItem): ToolCall | undefined {
  if (item.type === 'tool' && 'toolCall' in item) {
    return item.toolCall
  }
  if (
    item.type === 'message' &&
    'message' in item &&
    isRecord(item.message) &&
    item.message.role === 'tool' &&
    'toolCall' in item
  ) {
    return item.toolCall
  }
  return undefined
}

function summarizeByStatus(
  toolCalls: GroupableToolCall[],
  toolNames: string | string[],
  verb: string,
  noun: string,
  counter: (toolCalls: GroupableToolCall[], toolNames: string | string[]) => number
): ToolGroupSummaryPart[] {
  return createStatusDescriptors(toolCalls, toolNames, verb, noun, counter).map(
    formatStatusSummaryPart
  )
}

function summarizeGenericToolsByStatus(toolCalls: GroupableToolCall[]): ToolGroupSummaryPart[] {
  const knownToolNames = new Set(['read', 'grep', 'find', 'ls', 'edit', 'write', 'bash'])
  const genericTools = toolCalls.filter((toolCall) => !knownToolNames.has(toolCall.toolName))
  return createStatusDescriptors(
    genericTools,
    undefined,
    '执行',
    '工具',
    (items) => items.length
  ).map(formatStatusSummaryPart)
}

function createStatusDescriptors(
  toolCalls: GroupableToolCall[],
  toolNames: string | string[] | undefined,
  verb: string,
  noun: string,
  counter: (toolCalls: GroupableToolCall[], toolNames: string | string[]) => number
): ToolGroupSummaryDescriptor[] {
  const matching = toolNames === undefined ? toolCalls : filterTools(toolCalls, toolNames)
  return (['queued', 'running', 'succeeded', 'failed', 'cancelled'] as ToolGroupStatus[])
    .map((status) => {
      const statusCalls = matching.filter((toolCall) => toolCall.status === status)
      const count = toolNames === undefined ? statusCalls.length : counter(statusCalls, toolNames)
      return count > 0 ? { key: `${verb}:${status}`, verb, noun, count, status } : undefined
    })
    .filter((descriptor): descriptor is ToolGroupSummaryDescriptor => Boolean(descriptor))
}

function formatStatusSummaryPart(descriptor: ToolGroupSummaryDescriptor): ToolGroupSummaryPart {
  const quantity = `${descriptor.count} ${descriptor.noun}`
  let text: string
  switch (descriptor.status) {
    case 'queued':
      text = `正在${descriptor.verb} ${quantity}`
      break
    case 'running':
      text = `正在${quantity}${descriptor.verb}`
      break
    case 'succeeded':
      text = `已${descriptor.verb} ${quantity}`
      break
    case 'failed':
      text = `${quantity}失败`
      break
    case 'cancelled':
      text = `已取消 ${quantity}`
      break
    default:
      text = `正在${descriptor.verb} ${quantity}`
      break
  }
  return {
    key: descriptor.key,
    status: descriptor.status,
    text
  }
}

function countUniqueToolPaths(
  toolCalls: GroupableToolCall[],
  toolNames: string | string[]
): number {
  const matching = filterTools(toolCalls, toolNames)
  const paths = new Set(
    matching.map(getToolCallPath).filter((path): path is string => Boolean(path))
  )
  return paths.size > 0 ? paths.size : matching.length
}

function countTools(toolCalls: GroupableToolCall[], toolNames: string | string[]): number {
  return filterTools(toolCalls, toolNames).length
}

function filterTools(
  toolCalls: GroupableToolCall[],
  toolNames: string | string[]
): GroupableToolCall[] {
  const names = new Set(Array.isArray(toolNames) ? toolNames : [toolNames])
  return toolCalls.filter((toolCall) => names.has(toolCall.toolName))
}
