/** Standard AG-UI message conversion and incremental projection helpers. */

import { EventType } from '@ag-ui/core'
import type { AGUIEvent, Message, MessagesSnapshotEvent, ToolCall } from '@ag-ui/core'
import type { ThreadMessage } from './types'

export function toAgUiMessages(messages: readonly ThreadMessage[]): Message[] {
  return messages.flatMap((message): Message[] => {
    const id = message.sessionEntryId ?? message.id
    const content = message.text ?? ''
    if (message.role === 'user') {
      return [{ id, role: 'user', content: getUserContent(message) }]
    }
    if (message.role === 'system') {
      return [
        {
          id,
          role: 'system',
          content,
          ...(message.systemEvent?.kind ? { name: message.systemEvent.kind } : {})
        }
      ]
    }
    if (message.role === 'tool') {
      const toolCallId = getDesktopToolCallId(message)
      return toolCallId ? [{ id, role: 'tool', content, toolCallId }] : []
    }
    if (message.role !== 'assistant') return []

    const reasoning = getDesktopReasoning(message)
    const toolCalls = getDesktopToolCalls(message)
    const result: Message[] = []
    if (reasoning) {
      result.push({ id: `${id}-reasoning`, role: 'reasoning', content: reasoning })
    }
    result.push({
      id,
      role: 'assistant',
      ...(content ? { content } : {}),
      ...(toolCalls.length ? { toolCalls } : {})
    })
    return result
  })
}

export function createMessagesSnapshot(messages: readonly Message[]): MessagesSnapshotEvent {
  return { type: EventType.MESSAGES_SNAPSHOT, messages: [...messages] }
}

/** Applies only standard AG-UI message events; RAW and lifecycle events do not mutate history. */
export function reduceAgUiMessages(messages: readonly Message[], event: AGUIEvent): Message[] {
  if (event.type === EventType.MESSAGES_SNAPSHOT) return [...event.messages]
  const next = messages.map((message) => ({ ...message })) as Message[]

  if (event.type === EventType.TEXT_MESSAGE_START) {
    const message = { id: event.messageId, role: event.role, content: '' } as Message
    upsertMessage(next, message)
    return next
  }
  if (event.type === EventType.TEXT_MESSAGE_CONTENT) {
    return updateContent(next, event.messageId, event.delta)
  }
  if (event.type === EventType.TOOL_CALL_START) {
    const parentIndex = event.parentMessageId
      ? next.findIndex((message) => message.id === event.parentMessageId)
      : findLastAssistantIndex(next)
    if (parentIndex < 0) return next
    const parent = next[parentIndex]
    if (parent?.role !== 'assistant') return next
    const toolCalls = [...(parent.toolCalls ?? [])]
    const toolCall: ToolCall = {
      id: event.toolCallId,
      type: 'function',
      function: { name: event.toolCallName, arguments: '' }
    }
    const existing = toolCalls.findIndex((item) => item.id === event.toolCallId)
    if (existing >= 0) toolCalls[existing] = toolCall
    else toolCalls.push(toolCall)
    next[parentIndex] = { ...parent, toolCalls }
    return next
  }
  if (event.type === EventType.TOOL_CALL_ARGS) {
    for (let index = next.length - 1; index >= 0; index -= 1) {
      const message = next[index]
      if (message?.role !== 'assistant') continue
      const toolIndex = message.toolCalls?.findIndex((item) => item.id === event.toolCallId)
      if (toolIndex === undefined || toolIndex < 0) continue
      const toolCalls = [...(message.toolCalls ?? [])]
      const toolCall = toolCalls[toolIndex]!
      toolCalls[toolIndex] = {
        ...toolCall,
        function: {
          ...toolCall.function,
          arguments: `${toolCall.function.arguments}${event.delta}`
        }
      }
      next[index] = { ...message, toolCalls }
      return next
    }
  }
  if (event.type === EventType.TOOL_CALL_RESULT) {
    upsertMessage(next, {
      id: event.messageId,
      role: 'tool',
      content: event.content,
      toolCallId: event.toolCallId,
      ...(getRawEventIsError(event) ? { error: event.content } : {})
    })
    return next
  }
  if (event.type === EventType.REASONING_MESSAGE_START) {
    insertReasoningMessage(next, { id: event.messageId, role: 'reasoning', content: '' })
    return next
  }
  if (event.type === EventType.REASONING_MESSAGE_CONTENT) {
    return updateContent(next, event.messageId, event.delta)
  }
  return next
}

function getUserContent(message: ThreadMessage): Extract<Message, { role: 'user' }>['content'] {
  const raw = asRecord(message.raw)
  const rawContent = Array.isArray(raw?.content) ? raw.content : []
  const images = rawContent.flatMap((part) => {
    const item = asRecord(part)
    if (item?.type !== 'image' || typeof item.data !== 'string') return []
    const mimeType = item.mimeType ?? item.mediaType ?? item.mime_type
    if (typeof mimeType !== 'string') return []
    return [
      {
        type: 'image' as const,
        source: { type: 'data' as const, value: item.data, mimeType }
      }
    ]
  })
  const text = message.text ?? ''
  if (images.length === 0) return text
  return [...(text ? [{ type: 'text' as const, text }] : []), ...images]
}

function getDesktopToolCallId(message: ThreadMessage): string | undefined {
  const raw = asRecord(message.raw)
  return typeof raw?.toolCallId === 'string' && raw.toolCallId ? raw.toolCallId : undefined
}

function getDesktopReasoning(message: ThreadMessage): string {
  const raw = asRecord(message.raw)
  if (!Array.isArray(raw?.content)) return ''
  return raw.content
    .flatMap((part) => {
      const item = asRecord(part)
      return item?.type === 'thinking' && typeof item.thinking === 'string' ? [item.thinking] : []
    })
    .join('')
}

function getDesktopToolCalls(message: ThreadMessage): ToolCall[] {
  const raw = asRecord(message.raw)
  const content = Array.isArray(raw?.content) ? raw.content : []
  const byId = new Map<string, ToolCall>()
  for (const part of content) {
    const item = asRecord(part)
    if (item?.type !== 'toolCall' || typeof item.id !== 'string') continue
    byId.set(item.id, {
      id: item.id,
      type: 'function',
      function: {
        name: typeof item.name === 'string' && item.name ? item.name : 'tool',
        arguments: stringifyToolArguments(item.arguments)
      }
    })
  }
  for (const id of message.toolCallIds ?? []) {
    if (!byId.has(id)) {
      byId.set(id, { id, type: 'function', function: { name: 'tool', arguments: '' } })
    }
  }
  return [...byId.values()]
}

function updateContent(messages: Message[], messageId: string, delta: string): Message[] {
  const index = messages.findIndex((message) => message.id === messageId)
  if (index < 0) return messages
  const message = messages[index]!
  if (typeof message.content !== 'string') return messages
  messages[index] = { ...message, content: `${message.content}${delta}` } as Message
  return messages
}

function upsertMessage(messages: Message[], message: Message): void {
  const index = messages.findIndex((item) => item.id === message.id)
  if (index >= 0) messages[index] = message
  else messages.push(message)
}

function insertReasoningMessage(messages: Message[], message: Message): void {
  const existingIndex = messages.findIndex((item) => item.id === message.id)
  if (existingIndex >= 0) {
    messages[existingIndex] = message
    return
  }
  const assistantId = message.id.endsWith('-reasoning')
    ? message.id.slice(0, -'-reasoning'.length)
    : undefined
  const assistantIndex = assistantId
    ? messages.findIndex((item) => item.role === 'assistant' && item.id === assistantId)
    : -1
  const insertIndex = assistantIndex >= 0 ? assistantIndex : findLastAssistantIndex(messages)
  if (insertIndex >= 0) messages.splice(insertIndex, 0, message)
  else messages.push(message)
}

function getRawEventIsError(event: { rawEvent?: unknown }): boolean {
  return asRecord(event.rawEvent)?.isError === true
}

function findLastAssistantIndex(messages: readonly Message[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') return index
  }
  return -1
}

function stringifyToolArguments(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return String(value)
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined
}
