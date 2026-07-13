/**
 * 定义 Pi AgentMessage 到 desktop message 的纯转换逻辑。
 */

import type { CustomMessage } from '@earendil-works/pi-coding-agent'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { DesktopMessage } from './snapshot.ts'
import {
  createDesktopFileChangeFromEditResult,
  mergeDesktopFileChanges,
  type DesktopFileChange,
  type DesktopToolCall
} from './tool.ts'
import type { ThreadId } from './identity.ts'

export type _DesktopMessageProtocolAugmentation = CustomMessage

/** 不含 ID 的 desktop message 内容。 */
export type DesktopMessageContent = Omit<DesktopMessage, 'id'>

/**
 * 将 AgentMessage 转换为不含 ID 的 DesktopMessage 内容。
 * @param message - 原始 agent 消息。
 * @returns Desktop 消息内容；不应展示的消息返回 undefined。
 */
export function toDesktopMessageContent(message: AgentMessage): DesktopMessageContent | undefined {
  const assistantErrorText = extractAssistantErrorText(message)
  const role = assistantErrorText ? 'system' : mapRole(message.role)
  if (!role) {
    return undefined
  }
  const systemEvent = getSystemEvent(message)
  const text =
    getSystemEventText(message) ??
    assistantErrorText ??
    (hasContent(message) ? extractText(message.content) : undefined)
  if (role === 'assistant' && !text?.trim() && !hasAssistantBlockContent(message)) {
    return undefined
  }
  const content: DesktopMessageContent = {
    role,
    text,
    raw: toDesktopMessageRaw(message),
    toolCallIds: assistantErrorText ? undefined : getAssistantToolCallIds(message),
    createdAt: hasTimestamp(message) ? normalizeTimestamp(message.timestamp) : undefined
  }
  if (systemEvent) {
    content.systemEvent = systemEvent
  }
  return content
}

/**
 * 判断 AgentMessage 是否会渲染成可操作的 user/assistant desktop message。
 * @param message - 原始 agent 消息。
 * @returns 是否应分配 session entry ID。
 */
export function isRenderableConversationMessage(message: AgentMessage): boolean {
  const content = toDesktopMessageContent(message)
  return content?.role === 'user' || content?.role === 'assistant'
}

/**
 * 将 AgentMessage 转换为 DesktopMessage。
 * @param message - 原始 agent 消息。
 * @param id - desktop message ID。
 * @returns Desktop 消息；不应展示的消息返回 undefined。
 */
export function toDesktopMessage(
  message: AgentMessage,
  id: string,
  sessionEntryId?: string
): DesktopMessage | undefined {
  const content = toDesktopMessageContent(message)
  return content ? { id, ...content, ...(sessionEntryId ? { sessionEntryId } : {}) } : undefined
}

/**
 * 将 AgentMessage 列表转换为 DesktopMessage 列表。
 * @param messages - Pi live/context messages。
 * @returns desktop messages。
 */
export function toDesktopMessages(
  messages: AgentMessage[],
  sessionEntryIds: string[] = []
): DesktopMessage[] {
  let sessionEntryIndex = 0
  return messages.flatMap((message, index) => {
    const item = toDesktopMessage(message, `message-${index}`)
    if (!item) {
      return []
    }
    if (item.role === 'user' || item.role === 'assistant') {
      const sessionEntryId = sessionEntryIds[sessionEntryIndex++]
      return [{ ...item, ...(sessionEntryId ? { sessionEntryId } : {}) }]
    }
    return [item]
  })
}

/**
 * 从 AgentMessage 列表派生 Desktop 工具调用。
 * @param messages - Pi live/context messages。
 * @param threadId - 关联线程 ID。
 * @returns desktop 工具调用列表。
 */
export function toDesktopToolCalls(
  messages: AgentMessage[],
  threadId: ThreadId
): DesktopToolCall[] {
  const toolCalls = new Map<string, DesktopToolCall>()
  for (const message of messages) {
    if (isAssistantErrorMessage(message)) {
      continue
    }
    if (message.role === 'assistant' && hasContent(message) && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!isRecord(block) || block.type !== 'toolCall' || typeof block.id !== 'string') {
          continue
        }
        const existing = toolCalls.get(block.id)
        toolCalls.set(block.id, {
          ...existing,
          threadId,
          toolCallId: block.id,
          toolName: hasDisplayToolName(block.name) ? block.name : (existing?.toolName ?? 'tool'),
          status: existing?.status ?? 'queued',
          args: 'arguments' in block ? block.arguments : existing?.args
        })
      }
      continue
    }
    if (message.role === 'toolResult' && typeof message.toolCallId === 'string') {
      const existing = toolCalls.get(message.toolCallId)
      if (!existing) {
        continue
      }
      toolCalls.set(message.toolCallId, {
        ...existing,
        threadId,
        toolCallId: message.toolCallId,
        toolName: hasDisplayToolName(message.toolName)
          ? message.toolName
          : (existing?.toolName ?? 'tool'),
        status: message.isError ? 'failed' : 'succeeded',
        args: existing?.args,
        result: { content: message.content, details: readMessageDetails(message) },
        resultSummary: extractText(message.content),
        finishedAt: hasTimestamp(message)
          ? normalizeTimestamp(message.timestamp)
          : existing?.finishedAt
      })
    }
  }
  return [...toolCalls.values()]
}

/**
 * 从 AgentMessage 列表派生 Desktop 文件变更。
 * @param messages - Pi live/context messages。
 * @param threadId - 关联线程 ID。
 * @param cwd - edit 工具运行目录。
 * @returns desktop 文件变更列表。
 */
export function toDesktopFileChanges(
  messages: AgentMessage[],
  threadId: ThreadId,
  cwd?: string
): DesktopFileChange[] {
  const toolCalls = new Map<string, { toolName: string; args: unknown }>()
  const changes: DesktopFileChange[] = []
  for (const message of messages) {
    if (isAssistantErrorMessage(message)) {
      continue
    }
    if (message.role === 'assistant' && hasContent(message) && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!isRecord(block) || block.type !== 'toolCall' || typeof block.id !== 'string') {
          continue
        }
        const existing = toolCalls.get(block.id)
        toolCalls.set(block.id, {
          toolName: hasDisplayToolName(block.name) ? block.name : (existing?.toolName ?? 'tool'),
          args: Object.prototype.hasOwnProperty.call(block, 'arguments')
            ? block['arguments']
            : existing?.args
        })
      }
      continue
    }
    if (message.role !== 'toolResult' || typeof message.toolCallId !== 'string') {
      continue
    }
    const toolCall = toolCalls.get(message.toolCallId)
    const change = createDesktopFileChangeFromEditResult({
      threadId,
      cwd,
      toolCallId: message.toolCallId,
      toolName: hasDisplayToolName(message.toolName)
        ? message.toolName
        : (toolCall?.toolName ?? 'tool'),
      args: toolCall?.args,
      result: {
        content: hasContent(message) ? message.content : undefined,
        details: readMessageDetails(message)
      },
      isError: Boolean(message.isError),
      createdAt: hasTimestamp(message) ? normalizeTimestamp(message.timestamp) : undefined
    })
    if (change) {
      changes.push(change)
    }
  }
  return mergeDesktopFileChanges(changes)
}

/**
 * 映射消息角色到 desktop 消息角色。
 * @param role - 原始角色。
 * @returns Desktop 消息角色。
 */
function mapRole(role: AgentMessage['role']): DesktopMessage['role'] | undefined {
  switch (role) {
    case 'user':
    case 'assistant':
      return role
    case 'toolResult':
      return undefined
    case 'bashExecution':
    case 'custom':
    case 'branchSummary':
    case 'compactionSummary':
      return 'system'
    default:
      return undefined
  }
}

/**
 * 获取系统消息产品语义。
 * @param message - 原始消息。
 * @returns 系统事件语义。
 */
function getSystemEvent(message: AgentMessage): DesktopMessageContent['systemEvent'] | undefined {
  if (isAssistantErrorMessage(message)) {
    return {
      kind: 'agentEvent',
      title: '模型请求失败',
      description: '后端模型请求返回错误，当前响应已中止。',
      meta: getAssistantErrorMeta(message)
    }
  }
  switch (message.role) {
    case 'compactionSummary':
      return {
        kind: 'compaction',
        title: '上下文已压缩',
        description: '之前的对话历史已压缩为摘要，并保留在当前 session 中。',
        meta: [`压缩前 ${message.tokensBefore.toLocaleString()} tokens`]
      }
    case 'branchSummary':
      return {
        kind: 'branchSummary',
        title: '分支摘要',
        description: '从其他分支返回时保留的上下文摘要。',
        meta: [`from ${message.fromId}`]
      }
    case 'bashExecution':
      return {
        kind: 'bashExecution',
        title: 'Shell 命令记录',
        description: message.cancelled ? '命令已取消' : '通过 shell 运行的持久化命令输出。',
        meta: [
          `exit ${message.exitCode ?? 'unknown'}`,
          ...(message.truncated ? ['output truncated'] : [])
        ]
      }
    case 'custom':
      return {
        kind: 'custom',
        title: `Extension: ${message.customType}`,
        description: 'Extension 写入的上下文消息。'
      }
    default:
      return undefined
  }
}

/**
 * 获取系统消息正文。
 * @param message - 原始消息。
 * @returns 系统消息正文。
 */
function getSystemEventText(message: AgentMessage): string | undefined {
  const assistantErrorText = extractAssistantErrorText(message)
  if (assistantErrorText) {
    return assistantErrorText
  }
  switch (message.role) {
    case 'compactionSummary':
    case 'branchSummary':
      return message.summary
    case 'bashExecution':
      return message.output
    case 'custom':
      return hasContent(message) ? extractText(message.content) : undefined
    default:
      return undefined
  }
}

/**
 * 判断消息是否包含 content 字段。
 * @param message - 原始消息。
 * @returns 是否包含 content。
 */
function hasContent(message: AgentMessage): message is AgentMessage & { content: unknown } {
  return 'content' in message
}

/**
 * 判断消息是否包含 timestamp 字段。
 * @param message - 原始消息。
 * @returns 是否包含 timestamp。
 */
function hasTimestamp(message: AgentMessage): message is AgentMessage & { timestamp: unknown } {
  return 'timestamp' in message
}

/**
 * 判断工具名是否可展示。
 * @param value - 原始工具名。
 * @returns 是否非空字符串。
 */
function hasDisplayToolName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * 生成 renderer 展示用 raw message。
 * 工具调用由 DesktopToolCall projection 展示，assistant raw 中不再重复暴露 toolCall block。
 * @param message - 原始 agent message。
 * @returns 展示用 raw message。
 */
function toDesktopMessageRaw(message: AgentMessage): AgentMessage {
  if (message.role !== 'assistant' || !hasContent(message) || !Array.isArray(message.content)) {
    return message
  }
  const content = message.content.filter((part) => !isRecord(part) || part.type !== 'toolCall')
  return { ...message, content } as AgentMessage
}

/**
 * 获取 assistant message 发起的工具调用 ID。
 * @param message - 原始 agent message。
 * @returns 工具调用 ID 列表；非 assistant 或无工具调用时返回 undefined。
 */
function getAssistantToolCallIds(message: AgentMessage): string[] | undefined {
  if (message.role !== 'assistant' || !hasContent(message) || !Array.isArray(message.content)) {
    return undefined
  }
  const ids = message.content.flatMap((part) =>
    isRecord(part) && part.type === 'toolCall' && typeof part.id === 'string' ? [part.id] : []
  )
  return ids.length > 0 ? ids : undefined
}

function readMessageDetails(message: AgentMessage): unknown {
  return isRecord(message) ? message.details : undefined
}

/**
 * 判断 assistant 消息是否包含可单独渲染的结构块。
 * @param message - 原始消息。
 * @returns 是否包含 thinking 或 toolCall 内容。
 */
function hasAssistantBlockContent(message: AgentMessage): boolean {
  if (!hasContent(message) || !Array.isArray(message.content)) {
    return false
  }
  return message.content.some(
    (part) =>
      isRecord(part) &&
      ((part.type === 'thinking' && typeof part.thinking === 'string') ||
        (part.type === 'toolCall' && typeof part.id === 'string'))
  )
}

/**
 * 判断普通对象。
 * @param value - 值。
 * @returns 是否普通对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 从消息内容中提取文本。
 * @param content - 消息内容。
 * @returns 提取的文本字符串，若不存在则返回 undefined。
 */
function extractText(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return undefined
  }
  const text = content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        part.type === 'text' && typeof part.text === 'string'
    )
    .map((part) => part.text)
    .join('')
  return text || undefined
}

/**
 * 从 assistant 失败消息中提取可展示错误文本。
 * @param message - 原始 agent 消息。
 * @returns 错误文本，若不是模型请求失败则返回 undefined。
 */
function extractAssistantErrorText(message: AgentMessage): string | undefined {
  if (!isAssistantErrorMessage(message)) {
    return undefined
  }
  const errorMessage = typeof message.errorMessage === 'string' ? message.errorMessage.trim() : ''
  return errorMessage ? `模型请求失败：${errorMessage}` : '模型请求失败'
}

/**
 * 判断是否为 assistant 模型请求失败消息。
 * @param message - 原始 agent 消息。
 * @returns 是否为 assistant error。
 */
function isAssistantErrorMessage(
  message: AgentMessage
): message is AgentMessage & Record<string, unknown> {
  return message.role === 'assistant' && isRecord(message) && message.stopReason === 'error'
}

/**
 * 提取 assistant error 的短元信息。
 * @param message - 原始 agent 消息。
 * @returns 系统消息标签。
 */
function getAssistantErrorMeta(
  message: AgentMessage & Record<string, unknown>
): string[] | undefined {
  const meta = [
    typeof message.provider === 'string' && message.provider.trim()
      ? `provider ${message.provider.trim()}`
      : undefined,
    typeof message.model === 'string' && message.model.trim()
      ? `model ${message.model.trim()}`
      : undefined
  ].filter((item): item is string => Boolean(item))
  return meta.length > 0 ? meta : undefined
}

/**
 * 归一化 timestamp。
 * @param value - timestamp。
 * @returns ISO 字符串。
 */
function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    return new Date(value).toISOString()
  }
  return undefined
}
