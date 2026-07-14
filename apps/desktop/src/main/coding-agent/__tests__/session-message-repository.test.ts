/** Tests for the main-owned standard AG-UI session message projection. */

import { EventSchemas, EventType } from '@ag-ui/core'
import type { Message } from '@ag-ui/core'
import { describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { SessionMessageRepository } from '../session-message-repository'
import { reduceAgUiMessages } from '@shared/coding-agent/ag-ui-messages'
import type { AgentSessionIpcEvent } from '@shared/coding-agent/types'

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

function canonicalUser(text: string, messageTimestamp = timestamp): AgentMessage {
  return { role: 'user', content: text, timestamp: messageTimestamp }
}

function canonicalAssistant(
  content: Extract<AgentMessage, { role: 'assistant' }>['content'],
  stopReason: Extract<AgentMessage, { role: 'assistant' }>['stopReason'] = 'stop'
): Extract<AgentMessage, { role: 'assistant' }> {
  return {
    role: 'assistant',
    content,
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
    stopReason,
    timestamp
  }
}

describe('SessionMessageRepository', () => {
  it('buffers Pi events racing initialization and returns a standard MESSAGES_SNAPSHOT', async () => {
    let release!: (messages: AgentMessage[]) => void
    const repository = new SessionMessageRepository(
      () => new Promise<AgentMessage[]>((resolve) => (release = resolve))
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

  it('merges client input into the main-owned snapshot for later reconnects', async () => {
    const repository = new SessionMessageRepository(async () => [])
    await repository.mergeMessages('thread-a', [
      { id: 'persisted-user', role: 'user', content: 'Existing' }
    ])

    const runSnapshot = await repository.mergeMessages('thread-a', [
      { id: 'persisted-user', role: 'user', content: 'Stale client copy' },
      { id: 'current-user', role: 'user', content: 'Current prompt' }
    ])
    const reconnectSnapshot = await repository.get('thread-a')

    expect(runSnapshot.messages).toEqual([
      { id: 'persisted-user', role: 'user', content: 'Existing' },
      { id: 'current-user', role: 'user', content: 'Current prompt' }
    ])
    expect(reconnectSnapshot).toEqual(runSnapshot)
  })

  it('does not merge client-projected assistant, reasoning, or tool history', async () => {
    const repository = new SessionMessageRepository(async () => ({
      messages: [canonicalAssistant([{ type: 'text', text: 'Canonical response' }])],
      messageEntryIds: ['canonical-assistant']
    }))

    const snapshot = await repository.mergeMessages('thread-a', [
      {
        id: 'canonical-assistant-reasoning-reasoning-client',
        role: 'reasoning',
        content: 'stale client reasoning'
      },
      { id: 'client-assistant', role: 'assistant', content: 'stale client response' },
      {
        id: 'client-tool',
        role: 'tool',
        content: 'stale tool result',
        toolCallId: 'tool-a'
      },
      { id: 'current-user', role: 'user', content: 'Current prompt' }
    ])

    expect(snapshot.messages).toEqual([
      { id: 'canonical-assistant', role: 'assistant', content: 'Canonical response' },
      { id: 'current-user', role: 'user', content: 'Current prompt' }
    ])
  })

  it('uses the AG-UI request runId for the next canonical agent run', () => {
    const repository = new SessionMessageRepository(async () => [])
    repository.prepareRun('thread-a', 'run-from-client')

    const started = repository.startPreparedRun('thread-a', 'run-from-client')
    const duplicateStart = repository.record({ type: 'agent_start', threadId: 'thread-a' })
    const finished = repository.record({
      type: 'agent_end',
      threadId: 'thread-a',
      messages: [],
      willRetry: false
    })

    expect(started).toEqual({
      type: EventType.RUN_STARTED,
      threadId: 'thread-a',
      runId: 'run-from-client'
    })
    expect(duplicateStart).toEqual([])
    expect(finished).toEqual([
      { type: EventType.RUN_FINISHED, threadId: 'thread-a', runId: 'run-from-client' }
    ])
  })

  it('rejects a second requested or active run for the same thread', () => {
    const repository = new SessionMessageRepository(async () => [])
    repository.prepareRun('thread-a', 'run-a')
    expect(() => repository.prepareRun('thread-a', 'run-b')).toThrow('already active')

    repository.startPreparedRun('thread-a', 'run-a')
    expect(() => repository.prepareRun('thread-a', 'run-c')).toThrow('already active')
  })

  it('keeps one AG-UI runId across Pi automatic retries', () => {
    const repository = new SessionMessageRepository(async () => [])
    repository.prepareRun('thread-a', 'run-a')

    const firstStart = repository.startPreparedRun('thread-a', 'run-a')
    const retryBoundary = repository.record({
      type: 'agent_end',
      threadId: 'thread-a',
      messages: [],
      willRetry: true
    })
    const retryStart = repository.record({ type: 'agent_start', threadId: 'thread-a' })
    const finalEnd = repository.record({
      type: 'agent_end',
      threadId: 'thread-a',
      messages: [],
      willRetry: false
    })

    expect(firstStart).toEqual({
      type: EventType.RUN_STARTED,
      threadId: 'thread-a',
      runId: 'run-a'
    })
    expect(retryBoundary).toEqual([])
    expect(retryStart).toEqual([])
    expect(finalEnd).toEqual([
      { type: EventType.RUN_FINISHED, threadId: 'thread-a', runId: 'run-a' }
    ])
  })

  it('cancels a prepared runId when dispatch fails', () => {
    const repository = new SessionMessageRepository(async () => [])
    repository.prepareRun('thread-a', 'cancelled-run')
    repository.cancelPreparedRun('thread-a', 'cancelled-run')

    const [started] = repository.record({ type: 'agent_start', threadId: 'thread-a' })

    expect(started).toMatchObject({ type: EventType.RUN_STARTED, threadId: 'thread-a' })
    expect(started).not.toHaveProperty('runId', 'cancelled-run')
  })

  it('cancels a run opened before prompt dispatch so the thread can run again', () => {
    const repository = new SessionMessageRepository(async () => [])
    repository.prepareRun('thread-a', 'failed-run')
    repository.startPreparedRun('thread-a', 'failed-run')
    const failed = repository.failRun('thread-a', 'worker failed', 'failed-run')
    const duplicate = repository.failRun('thread-a', 'worker failed again', 'failed-run')

    expect(failed).toEqual({ type: EventType.RUN_ERROR, message: 'worker failed' })
    expect(duplicate).toBeUndefined()
    expect(() => repository.prepareRun('thread-a', 'retry-run')).not.toThrow()
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
    expect(success).not.toHaveProperty('state')
    expect(failure).not.toHaveProperty('state')
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

  it('does not let a late initializer overwrite a canonical reload', async () => {
    const releases: Array<(messages: AgentMessage[]) => void> = []
    const repository = new SessionMessageRepository(
      () => new Promise<AgentMessage[]>((resolve) => releases.push(resolve))
    )
    const stale = repository.get('thread-a')
    repository.invalidate('thread-a')
    const current = repository.get('thread-a')
    releases[1]?.([canonicalUser('replacement')])

    await expect(current).resolves.toEqual({
      type: EventType.MESSAGES_SNAPSHOT,
      messages: [{ id: `message-${timestamp}`, role: 'user', content: 'replacement' }]
    })
    releases[0]?.([])
    await expect(stale).resolves.toEqual(await current)
  })

  it('normalizes historical user images to standard AG-UI multimodal content', async () => {
    const repository = new SessionMessageRepository(async () => ({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'inspect this' },
            { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }
          ],
          timestamp
        } as AgentMessage
      ],
      messageEntryIds: ['entry-user']
    }))

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

  it('projects canonical thinking, tool names, arguments, and results without JSON text', async () => {
    const repository = new SessionMessageRepository(async () => ({
      messages: [
        canonicalAssistant(
          [
            { type: 'thinking', thinking: 'Inspecting the project' },
            { type: 'toolCall', id: 'tool-read', name: 'read', arguments: { path: 'README.md' } },
            { type: 'toolCall', id: 'tool-bash', name: 'bash', arguments: { command: 'ls' } }
          ],
          'toolUse'
        ),
        {
          role: 'toolResult',
          toolCallId: 'tool-read',
          toolName: 'read',
          content: [{ type: 'text', text: '# Project' }],
          isError: false,
          timestamp: timestamp + 1
        } as AgentMessage,
        {
          role: 'toolResult',
          toolCallId: 'tool-bash',
          toolName: 'bash',
          content: [{ type: 'text', text: 'permission denied' }],
          isError: true,
          timestamp: timestamp + 2
        } as AgentMessage
      ],
      messageEntryIds: ['entry-assistant']
    }))

    const snapshot = await repository.get('thread-a')

    expect(snapshot.messages).toEqual([
      {
        id: 'entry-assistant-reasoning',
        role: 'reasoning',
        content: 'Inspecting the project'
      },
      {
        id: 'entry-assistant',
        role: 'assistant',
        toolCalls: [
          {
            id: 'tool-read',
            type: 'function',
            function: { name: 'read', arguments: '{"path":"README.md"}' }
          },
          {
            id: 'tool-bash',
            type: 'function',
            function: { name: 'bash', arguments: '{"command":"ls"}' }
          }
        ]
      },
      {
        id: 'tool-result-tool-read',
        role: 'tool',
        toolCallId: 'tool-read',
        content: '# Project'
      },
      {
        id: 'tool-result-tool-bash',
        role: 'tool',
        toolCallId: 'tool-bash',
        content: 'permission denied',
        error: 'permission denied'
      }
    ])
    expect(
      snapshot.messages.some(
        (message) =>
          'content' in message &&
          typeof message.content === 'string' &&
          message.content.includes('toolCall')
      )
    ).toBe(false)
    expect(EventSchemas.safeParse(snapshot).success).toBe(true)
  })

  it('invalidates compaction-era messages and reloads from the canonical source', async () => {
    const loadMessages = vi
      .fn<() => Promise<AgentMessage[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([canonicalUser('compressed summary', timestamp + 1)])
    const repository = new SessionMessageRepository(loadMessages)

    await repository.get('thread-a')
    repository.invalidate('thread-a')

    await expect(repository.get('thread-a')).resolves.toEqual({
      type: EventType.MESSAGES_SNAPSHOT,
      messages: [{ id: `message-${timestamp + 1}`, role: 'user', content: 'compressed summary' }]
    })
    expect(loadMessages).toHaveBeenCalledTimes(2)
  })
})
