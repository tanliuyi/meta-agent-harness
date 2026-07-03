import type { ThreadSnapshot } from '@shared/coding-agent/types'
import type { RenderableThreadMessage } from '../renderable-message'
import { formatUnknown, getMessageRawRecord, getMessageText, isRecord } from '../message-format'

export type ToolCall = ThreadSnapshot['toolCalls'][number]

export interface ToolComponentProps {
  message?: RenderableThreadMessage
  toolCall?: ToolCall
}

/**
 * 获取工具调用参数对象。
 * @param toolCall - 工具调用。
 * @returns 参数对象。
 */
export function getToolArgs(toolCall: ToolCall | undefined): Record<string, unknown> {
  return isRecord(toolCall?.args) ? toolCall.args : {}
}

/**
 * 获取工具结果详情对象。
 * @param toolCall - 工具调用。
 * @returns 详情对象。
 */
export function getToolDetails(toolCall: ToolCall | undefined): Record<string, unknown> {
  const result = toolCall?.result
  return isRecord(result) && isRecord(result.details) ? result.details : {}
}

/**
 * 获取工具结果展示文本。
 * @param message - 当前消息。
 * @param toolCall - 工具调用。
 * @returns 展示文本。
 */
export function getToolResultText(
  message: RenderableThreadMessage | undefined,
  toolCall: ToolCall | undefined
): string | undefined {
  return (
    extractContentText(toolCall?.result) ??
    extractContentText(toolCall?.partialResult) ??
    (message ? getMessageText(message) : undefined) ??
    (message ? extractContentText(getMessageRawRecord(message).content) : undefined) ??
    formatUnknown(toolCall?.result)
  )
}

/**
 * 判断工具结果是否错误。
 * @param message - 当前消息。
 * @param toolCall - 工具调用。
 * @returns 是否错误。
 */
export function isToolError(
  message: RenderableThreadMessage | undefined,
  toolCall: ToolCall | undefined
): boolean {
  return (
    (message ? getMessageRawRecord(message).isError === true : false) ||
    toolCall?.status === 'failed'
  )
}

/**
 * 获取字符串参数。
 * @param args - 参数对象。
 * @param key - 字段名。
 * @returns 字符串。
 */
export function getStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * 获取数字参数。
 * @param args - 参数对象。
 * @param key - 字段名。
 * @returns 数字。
 */
export function getNumberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key]
  return typeof value === 'number' ? value : undefined
}

/**
 * 获取布尔参数展示。
 * @param args - 参数对象。
 * @param key - 字段名。
 * @returns 布尔展示文本。
 */
export function getBooleanArgLabel(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'boolean' ? `${key}=${value}` : undefined
}

/**
 * 拼接非空参数摘要。
 * @param parts - 摘要片段。
 * @returns 摘要文本。
 */
export function joinSummary(parts: Array<string | undefined>): string | undefined {
  const summary = parts.filter(Boolean).join(' ')
  return summary || undefined
}

/**
 * 提取工具返回内容里的文本。
 * @param value - 未知内容。
 * @returns 文本。
 */
function extractContentText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return extractTextParts(value)
  }
  if (!isRecord(value)) {
    return undefined
  }
  if ('content' in value) {
    return extractContentText(value.content)
  }
  if (typeof value.text === 'string') {
    return value.text
  }
  return undefined
}

/**
 * 从内容数组提取文本片段。
 * @param parts - 内容片段。
 * @returns 文本。
 */
function extractTextParts(parts: unknown[]): string | undefined {
  const text = parts
    .map((part) => {
      if (typeof part === 'string') return part
      if (isRecord(part) && typeof part.text === 'string') return part.text
      return undefined
    })
    .filter((part): part is string => typeof part === 'string')
    .join('')
  return text || undefined
}
