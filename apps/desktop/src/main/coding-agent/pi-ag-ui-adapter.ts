/** Stateful Pi canonical event to standard AG-UI event adapter. */

import { EventType } from '@ag-ui/core'
import type { AGUIEvent } from '@ag-ui/core'
import type { AgentSessionIpcEvent } from '@shared/coding-agent/types'

type PiMessageEvent = Extract<
  AgentSessionIpcEvent,
  { type: 'message_start' | 'message_update' | 'message_end' }
>

interface ThreadAdapterState {
  sequence: number
  runId?: string
  runErrorMessage?: string
  messageId?: string
  lastAssistantMessageId?: string
  reasoningId?: string
  text: string
  reasoning: string
}

export class PiAgUiAdapter {
  private readonly states = new Map<string, ThreadAdapterState>()

  adapt(event: AgentSessionIpcEvent): AGUIEvent[] {
    const state = this.state(event.threadId)
    switch (event.type) {
      case 'agent_start': {
        const runId = `${event.threadId}-run-${++state.sequence}`
        state.runId = runId
        state.runErrorMessage = undefined
        return [{ type: EventType.RUN_STARTED, threadId: event.threadId, runId }]
      }
      case 'agent_end': {
        const runId = state.runId ?? `${event.threadId}-run-${++state.sequence}`
        const errorMessage = state.runErrorMessage ?? getRunErrorMessage(event.messages)
        state.runId = undefined
        state.runErrorMessage = undefined
        return errorMessage
          ? [{ type: EventType.RUN_ERROR, message: errorMessage }]
          : [{ type: EventType.RUN_FINISHED, threadId: event.threadId, runId }]
      }
      case 'turn_start':
        return [{ type: EventType.STEP_STARTED, stepName: 'turn' }]
      case 'turn_end':
        return [{ type: EventType.STEP_FINISHED, stepName: 'turn' }]
      case 'message_start':
        return this.startMessage(event, state)
      case 'message_update':
        return this.updateMessage(event, state)
      case 'message_end':
        return this.endMessage(event, state)
      case 'tool_execution_start':
        return [
          {
            type: EventType.TOOL_CALL_START,
            toolCallId: event.toolCallId,
            toolCallName: event.toolName,
            ...(state.messageId || state.lastAssistantMessageId
              ? { parentMessageId: state.messageId ?? state.lastAssistantMessageId }
              : {})
          },
          {
            type: EventType.TOOL_CALL_ARGS,
            toolCallId: event.toolCallId,
            delta: stringify(event.args)
          },
          { type: EventType.TOOL_CALL_END, toolCallId: event.toolCallId }
        ]
      case 'tool_execution_end':
        return [
          {
            type: EventType.TOOL_CALL_RESULT,
            toolCallId: event.toolCallId,
            messageId: `tool-result-${event.toolCallId}`,
            content: stringify(event.result),
            role: 'tool',
            rawEvent: { isError: event.isError }
          }
        ]
      default:
        return this.raw(event)
    }
  }

  private startMessage(
    event: Extract<AgentSessionIpcEvent, { type: 'message_start' }>,
    state: ThreadAdapterState
  ): AGUIEvent[] {
    if (event.message.role !== 'assistant') return this.nonAssistantMessage(event)
    const messageId =
      event.sessionEntryId ?? stableMessageId(event.threadId, event.message, ++state.sequence)
    state.messageId = messageId
    state.lastAssistantMessageId = messageId
    state.reasoningId = `${messageId}-reasoning`
    state.text = ''
    state.reasoning = ''
    const events: AGUIEvent[] = [
      { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' }
    ]
    this.appendMessageDeltas(events, event.message, state)
    return events
  }

  private updateMessage(
    event: Extract<AgentSessionIpcEvent, { type: 'message_update' }>,
    state: ThreadAdapterState
  ): AGUIEvent[] {
    if (event.message.role !== 'assistant') return this.nonAssistantMessage(event)
    const events: AGUIEvent[] = []
    if (!state.messageId) {
      events.push(...this.startMessage({ ...event, type: 'message_start' }, state))
    } else {
      this.appendMessageDeltas(events, event.message, state)
    }
    return events
  }

  private endMessage(
    event: Extract<AgentSessionIpcEvent, { type: 'message_end' }>,
    state: ThreadAdapterState
  ): AGUIEvent[] {
    if (event.message.role !== 'assistant') return this.nonAssistantMessage(event)
    const events: AGUIEvent[] = []
    if (!state.messageId) {
      events.push(...this.startMessage({ ...event, type: 'message_start' }, state))
    } else {
      this.appendMessageDeltas(events, event.message, state)
    }
    if (state.reasoning) {
      events.push({ type: EventType.REASONING_MESSAGE_END, messageId: state.reasoningId! })
    }
    events.push({ type: EventType.TEXT_MESSAGE_END, messageId: state.messageId! })
    state.runErrorMessage = getMessageErrorMessage(event.message) ?? state.runErrorMessage
    state.messageId = undefined
    state.reasoningId = undefined
    state.text = ''
    state.reasoning = ''
    return events
  }

  private appendMessageDeltas(
    events: AGUIEvent[],
    message: Extract<AgentSessionIpcEvent, { type: 'message_start' }>['message'],
    state: ThreadAdapterState
  ): void {
    const text = contentText(message, 'text')
    const reasoning = contentText(message, 'thinking')
    const textDelta = cumulativeDelta(state.text, text)
    if (textDelta) {
      events.push({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: state.messageId!,
        delta: textDelta
      })
      state.text = text
    }
    const reasoningDelta = cumulativeDelta(state.reasoning, reasoning)
    if (reasoningDelta) {
      if (!state.reasoning) {
        events.push({
          type: EventType.REASONING_MESSAGE_START,
          messageId: state.reasoningId!,
          role: 'reasoning'
        })
      }
      events.push({
        type: EventType.REASONING_MESSAGE_CONTENT,
        messageId: state.reasoningId!,
        delta: reasoningDelta
      })
      state.reasoning = reasoning
    }
  }

  private nonAssistantMessage(event: PiMessageEvent): AGUIEvent[] {
    // User messages are resynchronized from canonical history as MESSAGES_SNAPSHOT. Other Pi
    // message roles retain their semantics through RAW without emitting invalid TEXT roles.
    return event.message.role === 'user' ? [] : this.raw(event)
  }

  private raw(event: AgentSessionIpcEvent): AGUIEvent[] {
    return [{ type: EventType.RAW, event, source: 'pi-coding-agent' }]
  }

  private state(threadId: string): ThreadAdapterState {
    let state = this.states.get(threadId)
    if (!state) {
      state = { sequence: 0, text: '', reasoning: '' }
      this.states.set(threadId, state)
    }
    return state
  }
}

function stableMessageId(
  threadId: string,
  message: Extract<AgentSessionIpcEvent, { type: 'message_start' }>['message'],
  sequence: number
): string {
  const timestamp = 'timestamp' in message ? message.timestamp : undefined
  return typeof timestamp === 'number'
    ? `${message.role}-${timestamp}`
    : `${threadId}-message-${sequence}`
}

function contentText(
  message: Extract<AgentSessionIpcEvent, { type: 'message_start' }>['message'],
  type: 'text' | 'thinking'
): string {
  const content = 'content' in message ? message.content : undefined
  if (typeof content === 'string') return type === 'text' ? content : ''
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((part) => {
      if (!part || typeof part !== 'object') return []
      const candidate = part as { type?: unknown; text?: unknown; thinking?: unknown }
      if (candidate.type !== type) return []
      const value = type === 'thinking' ? (candidate.thinking ?? candidate.text) : candidate.text
      return typeof value === 'string' ? [value] : []
    })
    .join('')
}

function cumulativeDelta(previous: string, next: string): string {
  return next.startsWith(previous) ? next.slice(previous.length) : next
}

function getRunErrorMessage(
  messages: Extract<AgentSessionIpcEvent, { type: 'agent_end' }>['messages']
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'assistant') return getMessageErrorMessage(message)
  }
  return undefined
}

function getMessageErrorMessage(message: PiMessageEvent['message']): string | undefined {
  if (message.role !== 'assistant' || !('stopReason' in message)) return undefined
  if (message.stopReason !== 'error' && message.stopReason !== 'aborted') return undefined
  const errorMessage = 'errorMessage' in message ? message.errorMessage : undefined
  if (typeof errorMessage === 'string' && errorMessage) return errorMessage
  return message.stopReason === 'aborted' ? 'Agent run aborted' : 'Agent run failed'
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
