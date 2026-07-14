/** Tests for the active-only renderer AG-UI message feed. */

import { EventSchemas, EventType } from '@ag-ui/core'
import type { AGUIEvent, Message, MessagesSnapshotEvent } from '@ag-ui/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import useWorkspaceSessionStore, { type WorkspaceSession } from '../workspace-session'
import type { ThreadMessage, ThreadSnapshot } from '@shared/coding-agent/types'

vi.mock('@renderer/composables/useToast', () => ({
  useToast: () => ({ error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() })
}))
vi.mock('@renderer/router', () => ({ default: { push: vi.fn() } }))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

function message(id: string, content: string): Message {
  return { id, role: 'user', content }
}

function snapshot(threadId: string, messages: ThreadMessage[] = []): ThreadSnapshot {
  return {
    threadId,
    projectId: 'project-a',
    cwd: '/tmp/project-a',
    status: 'idle',
    thinkingLevel: 'off',
    messages,
    toolCalls: [],
    fileChanges: [],
    approvals: [],
    extensionDialogs: [],
    queue: { steering: [], followUp: [] },
    diagnostics: []
  }
}

function session(threadId: string, messages: ThreadMessage[] = []): WorkspaceSession {
  return {
    threadId,
    projectId: 'project-a',
    status: 'idle',
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    snapshot: snapshot(threadId, messages)
  }
}

function installFeedApi(
  openSessionMessageFeed: (input: { sessionId: string }) => Promise<MessagesSnapshotEvent>
): {
  emit: (event: AGUIEvent) => void
  closeSessionMessageFeed: ReturnType<typeof vi.fn>
} {
  const listeners = new Set<(event: AGUIEvent) => void>()
  const closeSessionMessageFeed = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('window', {
    localStorage: createStorage(),
    sessionStorage: createStorage(),
    api: {
      codingAgent: {
        getSnapshot: vi.fn((threadId: string) => Promise.resolve(snapshot(threadId))),
        openSessionMessageFeed,
        closeSessionMessageFeed,
        onSessionAgentEvent: vi.fn((listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        }),
        onEvent: vi.fn(() => vi.fn())
      }
    }
  })
  return {
    emit: (event) => listeners.forEach((listener) => listener(event)),
    closeSessionMessageFeed
  }
}

function messagesSnapshot(messages: Message[]): MessagesSnapshotEvent {
  return { type: EventType.MESSAGES_SNAPSHOT, messages }
}

describe('workspace session AG-UI message feed', () => {
  it('keeps AG-UI messages only in active state and leaves every ThreadSnapshot empty', async () => {
    installFeedApi(async ({ sessionId }) =>
      messagesSnapshot([message(`${sessionId}-message`, sessionId)])
    )
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = session('thread-a')
    store.sessions['thread-b'] = session('thread-b')

    await store.setActiveSessionId('thread-a')
    await vi.waitFor(() => expect(store.activeSessionMessages[0]?.content).toBe('thread-a'))
    await store.setActiveSessionId('thread-b')
    await vi.waitFor(() => expect(store.activeSessionMessages[0]?.content).toBe('thread-b'))

    expect(store.sessions['thread-a']?.snapshot?.messages).toEqual([])
    expect(store.sessions['thread-b']?.snapshot?.messages).toEqual([])
  })

  it('buffers standard events that arrive while the initial snapshot request is pending', async () => {
    let resolveSnapshot!: (snapshot: MessagesSnapshotEvent) => void
    const feed = installFeedApi(
      () => new Promise<MessagesSnapshotEvent>((resolve) => (resolveSnapshot = resolve))
    )
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = session('thread-a')

    await store.setActiveSessionId('thread-a')
    feed.emit({
      type: EventType.TEXT_MESSAGE_START,
      messageId: 'assistant-a',
      role: 'assistant'
    })
    feed.emit({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: 'assistant-a',
      delta: 'hello'
    })
    resolveSnapshot(messagesSnapshot([]))

    await vi.waitFor(() => expect(store.activeSessionMessages[0]?.content).toBe('hello'))
  })

  it('closes the main feed when entering a new session page', async () => {
    const feed = installFeedApi(async () => messagesSnapshot([message('active', 'active')]))
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = session('thread-a')

    await store.setActiveSessionId('thread-a')
    store.startNewSession('project-a')

    await vi.waitFor(() => expect(feed.closeSessionMessageFeed).toHaveBeenCalledOnce())
    expect(store.activeSessionMessages).toEqual([])
  })

  it('accepts the main-owned MESSAGES_SNAPSHOT sent after a RAW compaction_end', async () => {
    const open = vi.fn().mockResolvedValueOnce(messagesSnapshot([]))
    const feed = installFeedApi(open)
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = session('thread-a')

    await store.setActiveSessionId('thread-a')
    feed.emit({
      type: EventType.RAW,
      source: 'pi-coding-agent',
      event: {
        type: 'compaction_end',
        threadId: 'thread-a',
        reason: 'overflow',
        result: undefined,
        aborted: false,
        willRetry: false
      }
    })
    feed.emit(messagesSnapshot([message('compacted', 'compressed summary')]))

    await vi.waitFor(() =>
      expect(store.activeSessionMessages[0]?.content).toBe('compressed summary')
    )
    expect(open).toHaveBeenCalledOnce()
  })

  it('applies standard run and step lifecycle without ending the run at STEP_FINISHED', async () => {
    const feed = installFeedApi(async () => messagesSnapshot([]))
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = session('thread-a')
    await store.setActiveSessionId('thread-a')

    feed.emit({ type: EventType.RUN_ERROR, message: 'old failure' })
    expect(store.activeSession?.status).toBe('idle')
    expect(store.activeRuntime?.errorMessage).toBe('old failure')

    feed.emit({
      type: EventType.RUN_STARTED,
      threadId: 'thread-a',
      runId: 'run-a'
    })
    expect(store.activeSession?.status).toBe('running')
    expect(store.activeRuntime?.errorMessage).toBeUndefined()

    feed.emit({ type: EventType.STEP_STARTED, stepName: 'turn' })
    feed.emit({ type: EventType.STEP_FINISHED, stepName: 'turn' })
    expect(store.activeSession?.status).toBe('running')

    feed.emit({
      type: EventType.RUN_FINISHED,
      threadId: 'thread-a',
      runId: 'run-a'
    })
    expect(store.activeSession?.status).toBe('idle')
  })

  it('reconstructs successful and failed tool runtime state from rawEvent.isError', async () => {
    const feed = installFeedApi(async () => messagesSnapshot([]))
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = session('thread-a')
    await store.setActiveSessionId('thread-a')

    const events: AGUIEvent[] = [
      {
        type: EventType.TOOL_CALL_START,
        toolCallId: 'tool-failure',
        toolCallName: 'read'
      },
      {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: 'tool-failure',
        delta: '{"path":"missing.txt"}'
      },
      {
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: 'tool-failure',
        messageId: 'tool-result-failure',
        content: 'not found',
        role: 'tool',
        rawEvent: { isError: true }
      },
      {
        type: EventType.TOOL_CALL_START,
        toolCallId: 'tool-success',
        toolCallName: 'read'
      },
      {
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: 'tool-success',
        messageId: 'tool-result-success',
        content: 'contents',
        role: 'tool',
        rawEvent: { isError: false }
      }
    ]
    expect(events.every((event) => EventSchemas.safeParse(event).success)).toBe(true)
    events.forEach(feed.emit)

    expect(store.activeSnapshot?.toolCalls).toMatchObject([
      { toolCallId: 'tool-failure', status: 'failed' },
      { toolCallId: 'tool-success', status: 'succeeded' }
    ])
    expect(store.activeSessionMessages).toMatchObject([
      { id: 'tool-result-failure', error: 'not found' },
      { id: 'tool-result-success' }
    ])
    expect(store.activeSessionMessages[1]).not.toHaveProperty('error')
  })

  it('keeps live reasoning immediately before its corresponding assistant', async () => {
    const feed = installFeedApi(async () => messagesSnapshot([]))
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = session('thread-a')
    await store.setActiveSessionId('thread-a')

    feed.emit({
      type: EventType.TEXT_MESSAGE_START,
      messageId: 'assistant-a',
      role: 'assistant'
    })
    feed.emit({
      type: EventType.REASONING_MESSAGE_START,
      messageId: 'assistant-a-reasoning',
      role: 'reasoning'
    })
    feed.emit({
      type: EventType.REASONING_MESSAGE_CONTENT,
      messageId: 'assistant-a-reasoning',
      delta: 'inspect files'
    })

    expect(store.activeSessionMessages.map((message) => message.id)).toEqual([
      'assistant-a-reasoning',
      'assistant-a'
    ])
    expect(store.activeSessionMessages[0]).toMatchObject({
      role: 'reasoning',
      content: 'inspect files'
    })
  })

  it('does not let a late A snapshot overwrite the current A generation after A-B-A', async () => {
    const requests: Array<{
      sessionId: string
      resolve: (snapshot: MessagesSnapshotEvent) => void
    }> = []
    installFeedApi(
      ({ sessionId }) =>
        new Promise<MessagesSnapshotEvent>((resolve) => requests.push({ sessionId, resolve }))
    )
    const store = useWorkspaceSessionStore()
    store.sessions['thread-a'] = session('thread-a')
    store.sessions['thread-b'] = session('thread-b')

    await store.setActiveSessionId('thread-a')
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    await store.setActiveSessionId('thread-b')
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    await store.setActiveSessionId('thread-a')
    await vi.waitFor(() => expect(requests).toHaveLength(3))

    requests[2]!.resolve(messagesSnapshot([message('fresh-a', 'fresh')]))
    await vi.waitFor(() => expect(store.activeSessionMessages[0]?.content).toBe('fresh'))
    requests[0]!.resolve(messagesSnapshot([message('stale-a', 'stale')]))
    requests[1]!.resolve(messagesSnapshot([]))
    await Promise.resolve()

    expect(store.activeSessionId).toBe('thread-a')
    expect(store.activeSessionMessages.map((item) => item.content)).toEqual(['fresh'])
    expect(EventSchemas.safeParse(messagesSnapshot(store.activeSessionMessages)).success).toBe(true)
  })
})

function createStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value)
  }
}
