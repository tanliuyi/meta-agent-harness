/** Tests for the main-owned standard AG-UI session message projection. */

import { EventSchemas, EventType } from '@ag-ui/core'
import type { Message } from '@ag-ui/core'
import { describe, expect, it, vi } from 'vitest'
import { SessionMessageRepository } from '../session-message-repository'
import { reduceAgUiMessages } from '@shared/coding-agent/ag-ui-messages'
import type { AgentSessionIpcEvent, ThreadMessage } from '@shared/coding-agent/types'

const timestamp = Date.parse('2026-07-14T00:00:00.000Z')

function assistant(
  type: 'message_start' | 'message_update' | 'message_end',
  text: string
): AgentSessionIpcEvent {
  const message = {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text }],
    api: 'responses',
    provider: 'openai',
    model: 'gpt-5',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: 'stop' as const,
    timestamp
  }
  if (type === 'message_update') {
    return {
      type,
      threadId: 'thread-a',
      message,
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: text,
        partial: message
      }
    }
  }
  return { type, threadId: 'thread-a', message }
}

function desktopMessage(id: string, text: string): ThreadMessage {
  return { id, role: 'user', text, raw: { role: 'user', content: text } as never }
}

describe('SessionMessageRepository', () => {
  it('buffers Pi events racing initialization and returns a standard MESSAGES_SNAPSHOT', async () => {
    let release!: (messages: ThreadMessage[]) => void
    const repository = new SessionMessageRepository(
      () => new Promise<ThreadMessage[]>((resolve) => (release = resolve))
    )

    const loading = repository.get('thread-a')
    repository.record(assistant('message_start', ''))
    repository.record(assistant('message_update', 'hello'))
    repository.record(assistant('message_end', 'hello'))
    release([])

    const snapshot = await loading
    expect(snapshot).toEqual({
      type: EventType.MESSAGES_SNAPSHOT,
      messages: [{ id: `assistant-${timestamp}`, role: 'assistant', content: 'hello' }]
    })
    expect(EventSchemas.safeParse(snapshot).success).toBe(true)
  })

  it('emits schema-valid RUN, TEXT, TOOL and RAW events without desktop envelope fields', () => {
    const repository = new SessionMessageRepository(async () => [])
    const toolStartEvents = repository.record({
      type: 'tool_execution_start',
      threadId: 'thread-a',
      toolCallId: 'tool-a',
      toolName: 'read',
      args: { path: 'README.md' }
    })
    const toolResultEvents = repository.record({
      type: 'tool_execution_end',
      threadId: 'thread-a',
      toolCallId: 'tool-a',
      toolName: 'read',
      result: 'contents',
      isError: false
    })
    const events = [
      ...repository.record({ type: 'agent_start', threadId: 'thread-a' }),
      ...repository.record(assistant('message_start', 'hello')),
      ...toolStartEvents,
      ...toolResultEvents,
      ...repository.record({
        type: 'compaction_start',
        threadId: 'thread-a',
        reason: 'manual'
      })
    ]

    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT,
      EventType.RAW
    ])
    expect(toolStartEvents.map((event) => event.type)).toEqual([
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END
    ])
    expect(toolResultEvents).toEqual([
      {
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: 'tool-a',
        messageId: 'tool-result-tool-a',
        content: 'contents',
        role: 'tool',
        rawEvent: { isError: false }
      }
    ])
    expect(events.every((event) => EventSchemas.safeParse(event).success)).toBe(true)
    expect(events.every((event) => !('sessionId' in event || 'revision' in event))).toBe(true)
  })

  it('projects schema-valid successful and failed tool results with standard error state', () => {
    const repository = new SessionMessageRepository(async () => [])
    const success = repository.record({
      type: 'tool_execution_end',
      threadId: 'thread-a',
      toolCallId: 'tool-success',
      toolName: 'read',
      result: 'contents',
      isError: false
    })[0]!
    const failure = repository.record({
      type: 'tool_execution_end',
      threadId: 'thread-a',
      toolCallId: 'tool-failure',
      toolName: 'read',
      result: 'not found',
      isError: true
    })[0]!

    expect(EventSchemas.safeParse(success).success).toBe(true)
    expect(EventSchemas.safeParse(failure).success).toBe(true)
    const messages = reduceAgUiMessages(reduceAgUiMessages([], success), failure)
    expect(messages).toEqual([
      {
        id: 'tool-result-tool-success',
        role: 'tool',
        content: 'contents',
        toolCallId: 'tool-success'
      },
      {
        id: 'tool-result-tool-failure',
        role: 'tool',
        content: 'not found',
        toolCallId: 'tool-failure',
        error: 'not found'
      }
    ])
  })

  it('inserts live reasoning before its assistant to match canonical message order', () => {
    const initial: Message[] = [
      { id: 'user-a', role: 'user', content: 'question' },
      { id: 'assistant-a', role: 'assistant', content: '' }
    ]
    const result = reduceAgUiMessages(initial, {
      type: EventType.REASONING_MESSAGE_START,
      messageId: 'assistant-a-reasoning',
      role: 'reasoning'
    })

    expect(result.map((message) => message.id)).toEqual([
      'user-a',
      'assistant-a-reasoning',
      'assistant-a'
    ])
  })

  it('ends an assistant error or aborted run with RUN_ERROR only', () => {
    const repository = new SessionMessageRepository(async () => [])
    const failedMessage = assistant('message_end', 'failed')
    if (failedMessage.type !== 'message_end' || failedMessage.message.role !== 'assistant') {
      throw new Error('invalid test fixture')
    }
    failedMessage.message.stopReason = 'error'

    repository.record({ type: 'agent_start', threadId: 'thread-a' })
    repository.record(failedMessage)
    const ended = repository.record({
      type: 'agent_end',
      threadId: 'thread-a',
      messages: [failedMessage.message],
      willRetry: false
    })

    expect(ended).toEqual([{ type: EventType.RUN_ERROR, message: 'Agent run failed' }])
    expect(ended.every((event) => EventSchemas.safeParse(event).success)).toBe(true)
  })

  it('finishes the live temporary id before the canonical snapshot remaps the entry id', () => {
    const repository = new SessionMessageRepository(async () => [])
    const started = repository.record(assistant('message_start', 'hello'))
    const endedEvent = assistant('message_end', 'hello')
    endedEvent.sessionEntryId = 'entry-assistant'
    const ended = repository.record(endedEvent)

    expect(started[0]).toMatchObject({
      type: EventType.TEXT_MESSAGE_START,
      messageId: `assistant-${timestamp}`
    })
    expect(ended.at(-1)).toEqual({
      type: EventType.TEXT_MESSAGE_END,
      messageId: `assistant-${timestamp}`
    })
  })

  it('does not let a late initializer overwrite an explicit replacement', async () => {
    let release!: (messages: ThreadMessage[]) => void
    const repository = new SessionMessageRepository(
      () => new Promise<ThreadMessage[]>((resolve) => (release = resolve))
    )
    const loading = repository.get('thread-a')
    repository.replace('thread-a', [desktopMessage('replacement', 'replacement')])
    release([])

    await expect(loading).resolves.toEqual({
      type: EventType.MESSAGES_SNAPSHOT,
      messages: [{ id: 'replacement', role: 'user', content: 'replacement' }]
    })
  })

  it('normalizes historical user images to standard AG-UI multimodal content', async () => {
    const repository = new SessionMessageRepository(async () => [
      {
        id: 'legacy-id',
        sessionEntryId: 'entry-user',
        role: 'user',
        text: 'inspect this',
        raw: {
          role: 'user',
          content: [
            { type: 'text', text: 'inspect this' },
            { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }
          ]
        } as never
      }
    ])

    const snapshot = await repository.get('thread-a')

    expect(snapshot.messages).toEqual([
      {
        id: 'entry-user',
        role: 'user',
        content: [
          { type: 'text', text: 'inspect this' },
          {
            type: 'image',
            source: { type: 'data', value: 'aGVsbG8=', mimeType: 'image/png' }
          }
        ]
      }
    ])
    expect(EventSchemas.safeParse(snapshot).success).toBe(true)
  })

  it('invalidates compaction-era messages and reloads from the canonical source', async () => {
    const loadMessages = vi
      .fn<() => Promise<ThreadMessage[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([desktopMessage('compacted', 'compressed summary')])
    const repository = new SessionMessageRepository(loadMessages)

    await repository.get('thread-a')
    repository.invalidate('thread-a')

    await expect(repository.get('thread-a')).resolves.toEqual({
      type: EventType.MESSAGES_SNAPSHOT,
      messages: [{ id: 'compacted', role: 'user', content: 'compressed summary' }]
    })
    expect(loadMessages).toHaveBeenCalledTimes(2)
  })
})
