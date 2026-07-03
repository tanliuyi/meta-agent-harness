import type { ThreadSnapshot } from '@shared/coding-agent/types'
import { isRecord } from '../message-format'

export type ToolCall = ThreadSnapshot['toolCalls'][number]
export type GroupableToolCall = Pick<ToolCall, 'toolCallId' | 'toolName' | 'args'>
export type ToolGroupKind = 'mutation' | 'explore'
export type ToolGroupStatus = ToolCall['status']

export interface ToolGroupTimelineItem {
  type: 'tool-group'
  key: string
  groupKind: ToolGroupKind
  toolCallIds: string[]
  summary: string
}

export type GroupableTimelineItem<TMessage = unknown> =
  | {
      type: 'tool'
      key: string
      toolCall: GroupableToolCall
    }
  | {
      type: 'message'
      key: string
      message: TMessage
      toolCall?: GroupableToolCall
    }
  | {
      type: string
      key: string
    }

export type GroupedTimelineItem<TItem> = TItem | ToolGroupTimelineItem

const MUTATION_TOOL_NAMES = new Set(['edit', 'write'])
const EXPLORE_TOOL_NAMES = new Set(['read', 'grep', 'find', 'ls'])

/**
 * 获取工具调用对应的分组类型。
 * @param toolCall - 工具调用。
 * @returns 分组类型。
 */
export function getToolGroupKind(toolCall: Pick<ToolCall, 'toolName'>): ToolGroupKind | undefined {
  if (MUTATION_TOOL_NAMES.has(toolCall.toolName)) {
    return 'mutation'
  }
  if (EXPLORE_TOOL_NAMES.has(toolCall.toolName)) {
    return 'explore'
  }
  return undefined
}

/**
 * 将连续同类工具调用合并为 timeline tool group。
 * @param items - 原始 timeline 项。
 * @returns 分组后的 timeline 项。
 */
export function groupTimelineTools<TItem extends GroupableTimelineItem>(
  items: TItem[]
): Array<GroupedTimelineItem<TItem>> {
  const result: Array<GroupedTimelineItem<TItem>> = []
  let pendingKind: ToolGroupKind | undefined
  let pendingItems: TItem[] = []
  let pendingToolCalls: GroupableToolCall[] = []

  const flushPending = (): void => {
    if (pendingItems.length === 0) {
      return
    }
    if (pendingKind && pendingItems.length > 1) {
      result.push(createToolGroupItem(pendingKind, pendingToolCalls))
    } else {
      result.push(...pendingItems)
    }
    pendingKind = undefined
    pendingItems = []
    pendingToolCalls = []
  }

  for (const item of items) {
    const toolCall = getTimelineItemToolCall(item)
    const kind = toolCall ? getToolGroupKind(toolCall) : undefined
    if (!toolCall || !kind) {
      flushPending()
      result.push(item)
      continue
    }
    if (pendingKind && pendingKind !== kind) {
      flushPending()
    }
    pendingKind = kind
    pendingItems.push(item)
    pendingToolCalls.push(toolCall)
  }

  flushPending()
  return result
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
 * 生成修改工具组摘要。
 * @param toolCalls - 工具调用列表。
 * @returns 摘要。
 */
export function summarizeMutationToolGroup(toolCalls: GroupableToolCall[]): string {
  const editCount = countUniqueToolPaths(toolCalls, 'edit')
  const writeCount = countUniqueToolPaths(toolCalls, 'write')
  return joinSummaryParts([
    editCount > 0 ? `编辑 ${editCount} 文件` : undefined,
    writeCount > 0 ? `写入 ${writeCount} 文件` : undefined
  ])
}

/**
 * 生成探索工具组摘要。
 * @param toolCalls - 工具调用列表。
 * @returns 摘要。
 */
export function summarizeExploreToolGroup(toolCalls: GroupableToolCall[]): string {
  const readCount = countUniqueToolPaths(toolCalls, 'read')
  const searchCount = toolCalls.filter(
    (toolCall) => toolCall.toolName === 'grep' || toolCall.toolName === 'find'
  ).length
  const lsCount = toolCalls.filter((toolCall) => toolCall.toolName === 'ls').length
  const summary = joinSummaryParts([
    readCount > 0 ? `查看 ${readCount} 文件` : undefined,
    searchCount > 0 ? `搜索 ${searchCount} 次` : undefined,
    lsCount > 0 ? `列出 ${lsCount} 目录` : undefined
  ])
  return summary || `探索 ${toolCalls.length} 项`
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

function createToolGroupItem(
  kind: ToolGroupKind,
  toolCalls: GroupableToolCall[]
): ToolGroupTimelineItem {
  const toolCallIds = toolCalls.map((toolCall) => toolCall.toolCallId)
  return {
    type: 'tool-group',
    key: `tool-group:${kind}:${toolCallIds[0] ?? 'empty'}`,
    groupKind: kind,
    toolCallIds,
    summary:
      kind === 'mutation'
        ? summarizeMutationToolGroup(toolCalls)
        : summarizeExploreToolGroup(toolCalls)
  }
}

function getTimelineItemToolCall(item: GroupableTimelineItem): GroupableToolCall | undefined {
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

function countUniqueToolPaths(toolCalls: GroupableToolCall[], toolName: string): number {
  const matching = toolCalls.filter((toolCall) => toolCall.toolName === toolName)
  const paths = new Set(matching.map(getToolCallPath).filter((path): path is string => Boolean(path)))
  return paths.size > 0 ? paths.size : matching.length
}

function joinSummaryParts(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join('，')
}
